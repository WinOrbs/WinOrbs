'use strict';

const assert = require('assert');
const {
    COLLECTIONS,
    createAuthoritativeMatchAggregate,
    createProgressionRuntime
} = require('../apps/server/platform/progression');
const {
    getLevelForXp,
    PROGRESSION_ERRORS
} = require('../packages/progression/v2');
const { finalizeAfterProgression } = require('../apps/server/game/finalization');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cloneState(state) {
    return Object.fromEntries(Object.entries(state).map(([name, records]) =>
        [name, new Map([...records].map(([id, record]) => [id, clone(record)]))]));
}

function createMemoryPersistence() {
    let state = {
        matches: new Map(),
        progression: new Map(),
        rewards: new Map(),
        idempotency: new Map()
    };
    let queue = Promise.resolve();
    let rewardCreates = 0;

    function records(name, transaction) {
        return (transaction ? transaction.state : state)[name];
    }

    const repositories = {
        MatchRepository: {
            async getById(id, transaction) {
                return clone(records('matches', transaction).get(id) || null);
            },
            async create(id, value, transaction) {
                records('matches', transaction).set(id, clone(value));
            },
            async update(id, value, transaction) {
                records('matches', transaction).set(id, clone(value));
            },
            async claimSettlement() { return { claimed: false, settlement: null }; }
        },
        ProgressionRepository: {
            async getByUserId(id, transaction) {
                return clone(records('progression', transaction).get(id) || null);
            },
            async replaceForUser(id, value, transaction) {
                records('progression', transaction).set(id, clone(value));
            }
        },
        RewardRepository: {
            async getById(id, transaction) {
                return clone(records('rewards', transaction).get(id) || null);
            },
            async create(id, value, transaction) {
                const rewards = records('rewards', transaction);
                if (rewards.has(id)) throw new Error('Duplicate reward');
                rewards.set(id, clone(value));
                rewardCreates += 1;
            },
            async update(id, value, transaction) {
                records('rewards', transaction).set(id, clone(value));
            }
        },
        IdempotencyRepository: {
            async getByKey(scope, key, transaction) {
                return clone(records('idempotency', transaction).get(`${scope}:${key}`) || null);
            },
            async claim(scope, key, value, transaction) {
                const id = `${scope}:${key}`;
                const idempotency = records('idempotency', transaction);
                if (idempotency.has(id)) {
                    return { claimed: false, record: clone(idempotency.get(id)) };
                }
                const record = { ...clone(value), scope, key };
                idempotency.set(id, record);
                return { claimed: true, record: clone(record) };
            }
        }
    };

    return {
        persistence: {
            ...repositories,
            async runInTransaction(work) {
                const previous = queue;
                let release;
                queue = new Promise((resolve) => { release = resolve; });
                await previous;
                const draft = cloneState(state);
                try {
                    const result = await work({
                        ...repositories,
                        transaction: { state: draft }
                    });
                    state = draft;
                    return result;
                } finally {
                    release();
                }
            }
        },
        profile(userId) { return clone(state.progression.get(userId) || null); },
        rewardCount() { return state.rewards.size; },
        rewardCreates() { return rewardCreates; },
        idempotencyCount() { return state.idempotency.size; },
        match(matchId) { return clone(state.matches.get(matchId) || null); }
    };
}

function createMemoryFirestore() {
    const collections = new Map();

    function records(collection) {
        if (!collections.has(collection)) collections.set(collection, new Map());
        return collections.get(collection);
    }

    function snapshot(value) {
        return {
            exists: value !== undefined,
            data: () => value === undefined ? undefined : clone(value)
        };
    }

    function collection(name) {
        return {
            doc(id) {
                return {
                    collection: name,
                    id,
                    async get() { return snapshot(records(name).get(id)); },
                    async create(value) {
                        if (records(name).has(id)) throw new Error('Document already exists');
                        records(name).set(id, clone(value));
                    },
                    async set(value) { records(name).set(id, clone(value)); },
                    async update(value) {
                        if (!records(name).has(id)) throw new Error('Document does not exist');
                        records(name).set(id, { ...records(name).get(id), ...clone(value) });
                    }
                };
            }
        };
    }

    return {
        collection,
        seed(name, id, value) { records(name).set(id, clone(value)); },
        records,
        async runTransaction(work) {
            const writes = [];
            const transaction = {
                async get(ref) { return snapshot(records(ref.collection).get(ref.id)); },
                create(ref, value) { writes.push(['create', ref, value]); },
                set(ref, value) { writes.push(['set', ref, value]); },
                update(ref, value) { writes.push(['update', ref, value]); }
            };
            const result = await work(transaction);
            for (const [method, ref, value] of writes) {
                if (method === 'create') {
                    if (records(ref.collection).has(ref.id)) throw new Error('Document already exists');
                    records(ref.collection).set(ref.id, clone(value));
                } else if (method === 'set') {
                    records(ref.collection).set(ref.id, clone(value));
                } else {
                    if (!records(ref.collection).has(ref.id)) throw new Error('Document does not exist');
                    records(ref.collection).set(ref.id, {
                        ...records(ref.collection).get(ref.id),
                        ...clone(value)
                    });
                }
            }
            return result;
        }
    };
}

async function run() {
    const successEvents = ['matchResultLocked'];
    let progressionPersisted = false;
    let resolveProgression;
    const pendingProgression = new Promise((resolve) => { resolveProgression = resolve; });
    const successFinalization = finalizeAfterProgression(
        pendingProgression,
        (error) => { throw new Error(`Unexpected progression failure: ${error}`); },
        () => {
            assert.strictEqual(progressionPersisted, true);
            successEvents.push('gameOver');
        }
    );
    await Promise.resolve();
    assert.deepStrictEqual(successEvents, ['matchResultLocked']);
    progressionPersisted = true;
    resolveProgression({ ok: true });
    await successFinalization;
    assert.deepStrictEqual(successEvents, ['matchResultLocked', 'gameOver']);

    const failureEvents = ['matchResultLocked'];
    const settlementState = {
        status: 'SETTLED',
        winnerId: 'player-1',
        balances: { 'player-1': 80, 'player-2': -100 }
    };
    const originalSettlementState = clone(settlementState);
    let matchStatus = 'RESULT_LOCKED';
    let progressionFailureLogged = false;
    await finalizeAfterProgression(
        Promise.resolve({ ok: false, error: 'PERSISTENCE_ERROR' }),
        (error) => {
            progressionFailureLogged = error === 'PERSISTENCE_ERROR';
        },
        () => failureEvents.push('gameOver')
    );
    assert.strictEqual(progressionFailureLogged, true);
    assert.strictEqual(matchStatus, 'RESULT_LOCKED');
    assert.deepStrictEqual(settlementState, originalSettlementState);
    assert.deepStrictEqual(failureEvents, ['matchResultLocked', 'gameOver']);

    const memory = createMemoryPersistence();
    const runtime = createProgressionRuntime({
        persistence: memory.persistence,
        clock: () => 5000
    });
    const aggregate = createAuthoritativeMatchAggregate({
        matchId: 'runtime-match-1',
        resultId: 'runtime-result-1',
        startedAt: 1000,
        finishedAt: 4000,
        finishReason: 'LAST_PLAYER',
        players: [
            {
                uid: 'player-1', score: 100, eliminations: 1, position: 1,
                xp: 999999,
                level: 100,
                missionCompleted: true,
                reward: 'any-reward',
                missionProgress: { 'win-one@v1': 1 }
            },
            { uid: 'player-2', score: 50, eliminations: 0, position: 2 }
        ],
        events: [
            {
                type: 'PlayerKilled',
                actorId: 'player-1',
                timestamp: 2000,
                payload: { actorId: 'player-2', killerId: 'player-1' }
            },
            {
                type: 'OrbCollected',
                actorId: 'player-1',
                timestamp: 2500,
                payload: { actorId: 'player-1', orbId: 'orb-1', amount: 4 }
            },
            {
                type: 'OrbCollected',
                actorId: 'player-1',
                timestamp: 3000,
                payload: { actorId: 'player-1', orbId: 'orb-2', amount: 3 }
            }
        ]
    });

    assert.deepStrictEqual(
        Object.keys(aggregate.result.value.participants[0].statistics).sort(),
        ['deaths', 'kills', 'score']
    );
    assert.strictEqual(aggregate.matchPersistence.events.at(-1).type, 'MatchFinished');
    const firstRun = await runtime.processAuthoritativeMatch(aggregate);
    assert.strictEqual(firstRun.ok, true);
    assert.strictEqual(memory.match('runtime-match-1').result.locked, true);

    const winner = memory.profile('player-1');
    const runnerUp = memory.profile('player-2');
    assert.strictEqual(winner.totalXp, 134);
    assert.strictEqual(winner.level, getLevelForXp(winner.totalXp));
    assert.strictEqual(winner.level, 2);
    assert.strictEqual(runnerUp.totalXp, 35);
    assert.strictEqual(runnerUp.level, getLevelForXp(runnerUp.totalXp));
    assert.strictEqual(winner.missionProgress['elimination-one@v1'].completed, true);
    assert.strictEqual(winner.missionProgress['collect-orbs@v1'].progress, 2);
    assert.strictEqual(winner.missionProgress['play-one@v1'].completed, true);
    assert.strictEqual(winner.missionProgress['win-one@v1'].completed, true);
    assert.strictEqual(winner.missionProgress['win-one@v1'].progress, 1);
    assert.strictEqual(winner.missionProgress['elimination-one@v1'].progress, 1);
    assert.strictEqual(winner.missionProgress['collect-orbs@v1'].completed, true);
    assert.strictEqual(runnerUp.missionProgress['play-one@v1'].completed, true);
    assert.strictEqual(runnerUp.missionProgress['elimination-one@v1'], undefined);
    assert.strictEqual(runnerUp.missionProgress['win-one@v1'], undefined);
    assert.strictEqual(runnerUp.missionProgress['collect-orbs@v1'], undefined);
    assert.strictEqual(memory.rewardCount(), 4);

    const duplicateRun = await runtime.processAuthoritativeMatch(aggregate);
    assert.strictEqual(duplicateRun.ok, true);
    assert.strictEqual(memory.profile('player-1').totalXp, 134);
    assert.strictEqual(memory.profile('player-2').totalXp, 35);
    assert.strictEqual(memory.rewardCount(), 4);
    assert.strictEqual(memory.rewardCreates(), 4);
    assert.strictEqual(memory.idempotencyCount(), 5);

    const profileBeforeForgery = memory.profile('player-1');
    const rewardsBeforeForgery = memory.rewardCount();
    const idempotencyBeforeForgery = memory.idempotencyCount();
    const forgedFields = [
        { xp: 999999 },
        { level: 100 },
        { missionCompleted: true },
        { reward: 'any-reward' },
        { missionProgress: { 'win-one@v1': 1 } }
    ];
    for (const forgedField of forgedFields) {
        const forgedResultRequest = await runtime.service.processMatchResult({
            matchId: 'runtime-match-1',
            resultId: 'runtime-result-1',
            ...forgedField
        });
        assert.deepStrictEqual(forgedResultRequest, {
            ok: false,
            error: { code: PROGRESSION_ERRORS.INVALID_REQUEST }
        });
        const forgedEventRequest = await runtime.service.processGameEvent({
            matchId: 'runtime-match-1',
            eventId: aggregate.matchPersistence.events[0].eventId,
            ...forgedField
        });
        assert.deepStrictEqual(forgedEventRequest, {
            ok: false,
            error: { code: PROGRESSION_ERRORS.INVALID_REQUEST }
        });
    }
    assert.strictEqual(memory.profile('player-1').totalXp, 134);
    assert.deepStrictEqual(memory.profile('player-1'), profileBeforeForgery);
    assert.strictEqual(memory.rewardCount(), rewardsBeforeForgery);
    assert.strictEqual(memory.idempotencyCount(), idempotencyBeforeForgery);

    const tamperedAggregate = clone(aggregate);
    tamperedAggregate.result.value.participants[0].statistics.kills = 999;
    assert.deepStrictEqual(
        await runtime.processAuthoritativeMatch(tamperedAggregate),
        { ok: false, error: 'INVALID_AUTHORITATIVE_RESULT' }
    );

    const firestore = createMemoryFirestore();
    const settlementSentinel = {
        settlementId: 'already-settled-match',
        status: 'SETTLED',
        winnerId: 'player-1',
        balanceChanges: { 'player-1': 80, 'player-2': -100 }
    };
    firestore.seed(COLLECTIONS.settlements, 'existing-settlement', settlementSentinel);
    const firestoreRuntime = createProgressionRuntime({ firestore, clock: () => 5000 });
    const persistedRun = await firestoreRuntime.processAuthoritativeMatch(aggregate);
    assert.strictEqual(persistedRun.ok, true);
    const persistedProfiles = [...firestore.records(COLLECTIONS.progression).values()];
    const persistedWinner = persistedProfiles.find((profile) => profile.userId === 'player-1');
    const persistedRunnerUp = persistedProfiles.find((profile) => profile.userId === 'player-2');
    assert.strictEqual(persistedWinner.totalXp, 134);
    assert.strictEqual(persistedWinner.level, getLevelForXp(persistedWinner.totalXp));
    assert.strictEqual(persistedRunnerUp.totalXp, 35);
    assert.strictEqual(persistedRunnerUp.level, getLevelForXp(persistedRunnerUp.totalXp));
    assert.strictEqual(firestore.records(COLLECTIONS.progression).size, 2);
    assert.strictEqual(firestore.records(COLLECTIONS.rewards).size, 4);
    assert.strictEqual(firestore.records(COLLECTIONS.idempotency).size, 5);
    assert.strictEqual(firestore.records(COLLECTIONS.matches).size, 1);
    const persistedRewards = [...firestore.records(COLLECTIONS.rewards).values()];
    assert.ok(persistedRewards.some((reward) =>
        reward.userId === 'player-1' && reward.missionId === 'elimination-one'));
    assert.ok(persistedRewards.some((reward) =>
        reward.userId === 'player-1' && reward.missionId === 'play-one'));
    assert.ok(persistedRewards.some((reward) =>
        reward.userId === 'player-1' && reward.missionId === 'win-one'));
    assert.strictEqual(persistedRewards.some((reward) => reward.sourceType === 'LEVEL'), false);
    assert.ok(persistedRewards.some((reward) =>
        reward.userId === 'player-2' && reward.missionId === 'play-one'));
    const persistedMatch = [...firestore.records(COLLECTIONS.matches).values()][0];
    assert.strictEqual(persistedMatch.status, 'RESULT_LOCKED');
    assert.strictEqual(persistedMatch.result.locked, true);
    assert.strictEqual(persistedMatch.result.value.resultHash, aggregate.result.value.resultHash);
    assert.strictEqual(firestore.records(COLLECTIONS.settlements).size, 1);
    assert.deepStrictEqual(
        firestore.records(COLLECTIONS.settlements).get('existing-settlement'),
        settlementSentinel
    );
    assert.strictEqual(
        [...firestore.records(COLLECTIONS.progression).keys()]
            .find((id) => firestore.records(COLLECTIONS.progression).get(id).userId === 'player-1'),
        Buffer.from(JSON.stringify(['player-1'])).toString('base64url')
    );

    const persistedDuplicate = await firestoreRuntime.processAuthoritativeMatch(aggregate);
    assert.strictEqual(persistedDuplicate.ok, true);
    assert.strictEqual(
        [...firestore.records(COLLECTIONS.progression).values()]
            .find((profile) => profile.userId === 'player-1').totalXp,
        134
    );
    assert.strictEqual(firestore.records(COLLECTIONS.rewards).size, 4);
    assert.strictEqual(firestore.records(COLLECTIONS.idempotency).size, 5);
    assert.deepStrictEqual(
        firestore.records(COLLECTIONS.settlements).get('existing-settlement'),
        settlementSentinel
    );

    const legacyFirestore = createMemoryFirestore();
    legacyFirestore.seed('progresion', 'legacy-player', {
        xp: 5000,
        level: 16,
        equippedAura: 'level-aura-10'
    });
    const legacyRuntime = createProgressionRuntime({ firestore: legacyFirestore, clock: () => 6000 });
    const imported = await legacyRuntime.ensureLegacyProfile('legacy-player');
    assert.strictEqual(imported.totalXp, 5000);
    assert.strictEqual(imported.level, getLevelForXp(5000));
    assert.strictEqual(imported.equippedReward, 'level-aura-10');
    const legacyAggregate = createAuthoritativeMatchAggregate({
        matchId: 'firestore-match',
        resultId: 'firestore-result',
        startedAt: 1000,
        finishedAt: 4000,
        finishReason: 'LAST_PLAYER',
        players: [{
            uid: 'legacy-player',
            score: 20,
            eliminations: 0,
            position: 1
        }]
    });
    const firestoreResult = await legacyRuntime.processAuthoritativeMatch(legacyAggregate);
    assert.strictEqual(firestoreResult.ok, true);
    const migratedProfiles = [...legacyFirestore.records(COLLECTIONS.progression).values()];
    assert.strictEqual(migratedProfiles.length, 1);
    assert.strictEqual(migratedProfiles[0].totalXp, 5090);
    assert.strictEqual(legacyFirestore.records(COLLECTIONS.rewards).size, 3);
    assert.ok([...legacyFirestore.records(COLLECTIONS.rewards).values()]
        .some((reward) => reward.sourceType === 'LEVEL' && reward.level === 10));
    assert.strictEqual(legacyFirestore.records(COLLECTIONS.idempotency).size, 2);
    assert.strictEqual(legacyFirestore.records(COLLECTIONS.matches).size, 1);
    assert.strictEqual(legacyFirestore.records('progresion').get('legacy-player').xp, 5000);
    assert.strictEqual((await legacyRuntime.processAuthoritativeMatch(legacyAggregate)).ok, true);
    assert.strictEqual(legacyFirestore.records(COLLECTIONS.progression).values().next().value.totalXp, 5090);
    assert.strictEqual(legacyFirestore.records(COLLECTIONS.rewards).size, 3);

    console.log('OK runtime progression integration: validated result/events, v2 profiles/rewards, and durable idempotency.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
