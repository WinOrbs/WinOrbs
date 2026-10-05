'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    SCHEMA_VERSION
} = require('../packages/contracts/v2');
const {
    PROGRESSION_ERRORS,
    createProgressionService,
    getLevelForXp,
    getXpRequiredForLevel
} = require('../packages/progression/v2');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function hashResult(result) {
    return require('crypto').createHash('sha256')
        .update(canonical({ ...result, resultHash: '' }))
        .digest('hex');
}

function validResult(matchId, resultId, overrides = {}) {
    const value = {
        schemaVersion: SCHEMA_VERSION,
        resultId,
        matchId,
        rulesVersion: 'rules-v2',
        startedAt: 10,
        finishedAt: 20,
        finishReason: 'LAST_PLAYER',
        participants: [
            {
                actorId: 'player-1',
                teamId: null,
                status: 'COMPLETED',
                statistics: { score: 12, kills: 1, deaths: 0 }
            },
            {
                actorId: 'player-2',
                teamId: null,
                status: 'COMPLETED',
                statistics: { score: 3, kills: 0, deaths: 1 }
            }
        ],
        rankings: [
            { rank: 1, actorIds: ['player-1'], teamId: null },
            { rank: 2, actorIds: ['player-2'], teamId: null }
        ],
        teams: [],
        statistics: { durationMs: 10 },
        resultHash: ''
    };
    Object.assign(value, overrides);
    value.resultHash = hashResult(value);
    return value;
}

function gameEvent({
    matchId = 'match-1',
    eventId = 'event-1',
    sequence = 1,
    type = 'PlayerKilled',
    actorId = 'player-1',
    payload = { actorId: 'player-2', killerId: 'player-1' }
} = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        eventId,
        matchId,
        sequence,
        timestamp: 1000 + sequence,
        type,
        actorId,
        payload
    };
}

function makeLockedMatch(matchId, result, events = []) {
    return {
        matchId,
        status: 'RESULT_LOCKED',
        rulesVersion: result.rulesVersion,
        resultVersion: 'result-v1',
        result: { locked: true, value: clone(result) },
        matchPersistence: {
            schemaVersion: SCHEMA_VERSION,
            stateVersion: 10,
            eventSequence: events.length,
            resultVersion: 'result-v1',
            resultLockedAt: 5000,
            snapshot: {
                stateVersion: 9,
                eventSequence: events.length,
                value: {
                    schemaVersion: SCHEMA_VERSION,
                    matchId,
                    status: 'RESULT_LOCKED',
                    memberActorIds: ['player-1', 'player-2'],
                    members: [
                        { actorId: 'player-1', ready: true },
                        { actorId: 'player-2', ready: true }
                    ],
                    readyActorIds: ['player-1', 'player-2'],
                    notReadyActorIds: [],
                    gameState: {
                        match: {
                            matchId,
                            status: 'RESULT_LOCKED',
                            rulesVersion: result.rulesVersion
                        }
                    }
                }
            },
            events: clone(events)
        }
    };
}

function makeMemoryPersistence(seedMatches = []) {
    let state = {
        users: new Map(),
        wallets: new Map(),
        ledger: new Map(),
        matches: new Map(seedMatches.map((match) => [match.matchId, clone(match)])),
        inventories: new Map(),
        progression: new Map(),
        rewards: new Map(),
        payments: new Map(),
        audit: new Map(),
        idempotency: new Map(),
        outbox: new Map()
    };
    let queue = Promise.resolve();
    let rewardCreates = 0;

    function select(transaction) {
        return transaction ? transaction.state : state;
    }

    function map(transaction, collection) {
        return select(transaction)[collection];
    }

    function cloneState(source) {
        return Object.fromEntries(Object.entries(source).map(([key, records]) =>
            [key, new Map([...records].map(([id, value]) => [id, clone(value)]))]));
    }

    const repositories = {
        UserRepository: {
            async getById(id, tx) { return clone(map(tx, 'users').get(id) || null); },
            async create(id, value, tx) { map(tx, 'users').set(id, clone(value)); },
            async update(id, patch, tx) {
                map(tx, 'users').set(id, {
                    ...map(tx, 'users').get(id),
                    ...clone(patch)
                });
            }
        },
        WalletRepository: {
            async getByUserId(id, tx) { return clone(map(tx, 'wallets').get(id) || null); },
            async create(id, value, tx) { map(tx, 'wallets').set(id, clone(value)); },
            async update(id, patch, tx) {
                map(tx, 'wallets').set(id, {
                    ...map(tx, 'wallets').get(id),
                    ...clone(patch)
                });
            }
        },
        LedgerRepository: {
            async getById(id, tx) { return clone(map(tx, 'ledger').get(id) || null); },
            async listByMatch(matchId, tx) {
                return [...map(tx, 'ledger').values()]
                    .filter((item) => item.matchId === matchId).map(clone);
            },
            async append(entry, tx) { map(tx, 'ledger').set(entry.entryId, clone(entry)); }
        },
        MatchRepository: {
            async getById(id, tx) { return clone(map(tx, 'matches').get(id) || null); },
            async create(id, value, tx) { map(tx, 'matches').set(id, clone(value)); },
            async update(id, patch, tx) {
                map(tx, 'matches').set(id, {
                    ...map(tx, 'matches').get(id),
                    ...clone(patch)
                });
            },
            async claimSettlement() { return { claimed: false, settlement: null }; }
        },
        InventoryRepository: {
            async getByUserId(id, tx) { return clone(map(tx, 'inventories').get(id) || null); },
            async replaceForUser(id, value, tx) { map(tx, 'inventories').set(id, clone(value)); }
        },
        ProgressionRepository: {
            async getByUserId(id, tx) {
                return clone(map(tx, 'progression').get(id) || null);
            },
            async replaceForUser(id, value, tx) {
                map(tx, 'progression').set(id, clone(value));
            }
        },
        RewardRepository: {
            async getById(id, tx) { return clone(map(tx, 'rewards').get(id) || null); },
            async create(id, value, tx) {
                const records = map(tx, 'rewards');
                if (records.has(id)) throw new Error('duplicate progression reward');
                records.set(id, clone(value));
                rewardCreates += 1;
            },
            async update(id, patch, tx) {
                map(tx, 'rewards').set(id, {
                    ...map(tx, 'rewards').get(id),
                    ...clone(patch)
                });
            }
        },
        PaymentRepository: {
            async getById(id, tx) { return clone(map(tx, 'payments').get(id) || null); },
            async create(id, value, tx) { map(tx, 'payments').set(id, clone(value)); },
            async update(id, patch, tx) {
                map(tx, 'payments').set(id, {
                    ...map(tx, 'payments').get(id),
                    ...clone(patch)
                });
            }
        },
        AuditRepository: {
            async append(entry, tx) { map(tx, 'audit').set(entry.entryId, clone(entry)); },
            async listByAggregate(id, tx) {
                return [...map(tx, 'audit').values()]
                    .filter((entry) => entry.aggregateId === id).map(clone);
            }
        },
        IdempotencyRepository: {
            async getByKey(scope, key, tx) {
                return clone(map(tx, 'idempotency').get(`${scope}\u0000${key}`) || null);
            },
            async claim(scope, key, value, tx) {
                const records = map(tx, 'idempotency');
                const id = `${scope}\u0000${key}`;
                if (records.has(id)) {
                    return { claimed: false, record: clone(records.get(id)) };
                }
                const record = { ...clone(value), scope, key };
                records.set(id, record);
                return { claimed: true, record: clone(record) };
            }
        },
        OutboxRepository: {
            async getById(id, tx) { return clone(map(tx, 'outbox').get(id) || null); },
            async enqueue(event, tx) { map(tx, 'outbox').set(event.eventId, clone(event)); },
            async listPending(now, tx) {
                return [...map(tx, 'outbox').values()]
                    .filter((item) => item.availableAt <= now).map(clone);
            },
            async markPublished(id, publishedAt, tx) {
                map(tx, 'outbox').set(id, {
                    ...map(tx, 'outbox').get(id),
                    publishedAt
                });
            }
        },
        async runInTransaction(work) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            await previous;
            const staged = cloneState(state);
            try {
                const response = await work({
                    ...repositories,
                    transaction: { state: staged }
                });
                state = staged;
                return response;
            } finally {
                release();
            }
        }
    };

    return {
        persistence: repositories,
        profile(userId) { return clone(state.progression.get(userId) || null); },
        reward(id) { return clone(state.rewards.get(id) || null); },
        rewardCount() { return rewardCreates; },
        idempotencyCount() { return state.idempotency.size; },
        match(matchId) { return clone(state.matches.get(matchId) || null); },
        setMatch(matchId, value) { state.matches.set(matchId, clone(value)); },
        snapshot() {
            return clone({
                progression: [...state.progression.entries()],
                rewards: [...state.rewards.entries()],
                idempotency: [...state.idempotency.entries()]
            });
        }
    };
}

const missionsV1 = [
    {
        missionId: 'elimination-one',
        version: 'v1',
        title: 'First elimination',
        description: 'Record one authoritative elimination.',
        category: 'combat',
        objective: 'ELIMINATIONS',
        target: 1,
        xpReward: 30,
        rewardDefinition: { type: 'badge', definitionId: 'first-elimination' },
        active: true
    },
    {
        missionId: 'collect-orbs',
        version: 'v1',
        title: 'Orb collector',
        description: 'Collect two authoritative Orbs.',
        category: 'gameplay',
        objective: 'ORBS_COLLECTED',
        target: 2,
        xpReward: 0,
        rewardDefinition: null,
        active: true
    },
    {
        missionId: 'play-one',
        version: 'v1',
        title: 'Play a match',
        description: 'Complete one match.',
        category: 'match',
        objective: 'MATCHES_PLAYED',
        target: 1,
        xpReward: 10,
        rewardDefinition: { type: 'cosmetic', definitionId: 'player-banner' },
        active: true
    },
    {
        missionId: 'win-one',
        version: 'v1',
        title: 'Win a match',
        description: 'Win one match.',
        category: 'match',
        objective: 'MATCHES_WON',
        target: 1,
        xpReward: 5,
        rewardDefinition: { type: 'badge', definitionId: 'match-winner' },
        active: true
    }
];

function makeService(memory, options = {}) {
    return createProgressionService({
        persistence: memory.persistence,
        clock: () => 5000,
        ...options
    });
}

async function run() {
    const levelCurve = { baseXpPerLevel: 100 };
    assert.equal(getXpRequiredForLevel(1), 0);
    assert.equal(getXpRequiredForLevel(2), 100);
    assert.equal(getXpRequiredForLevel(3), 300);
    assert.equal(getLevelForXp(0), 1);
    assert.equal(getLevelForXp(99), 1);
    assert.equal(getLevelForXp(100), 2);
    assert.equal(getLevelForXp(299), 2);
    assert.equal(getLevelForXp(300), 3);
    assert.throws(() => getLevelForXp(-1), RangeError);
    assert.equal(getXpRequiredForLevel(4, { baseXpPerLevel: 20 }), 120);
    assert.equal(getLevelForXp(120, { baseXpPerLevel: 20 }), 4);
    const maximumSupportedXp = Number.MAX_SAFE_INTEGER;
    const maximumSupportedLevel = getLevelForXp(maximumSupportedXp);
    assert.ok(getXpRequiredForLevel(maximumSupportedLevel) <= maximumSupportedXp);
    assert.throws(() => getXpRequiredForLevel(
        maximumSupportedLevel + 1
    ), RangeError);

    const eventOne = gameEvent();
    const orbOne = gameEvent({
        eventId: 'event-orb-1',
        sequence: 2,
        type: 'OrbCollected',
        payload: { actorId: 'player-1', orbId: 'orb-1', amount: 5 }
    });
    const orbTwo = gameEvent({
        eventId: 'event-orb-2',
        sequence: 3,
        type: 'OrbCollected',
        payload: { actorId: 'player-1', orbId: 'orb-2', amount: 5 }
    });
    const environmentalDeath = gameEvent({
        eventId: 'event-environmental-death',
        sequence: 4,
        type: 'PlayerKilled',
        actorId: 'player-2',
        payload: { actorId: 'player-2', killerId: null }
    });
    const result = validResult('match-1', 'result-1');
    const lockedMatch = makeLockedMatch('match-1', result, [
        eventOne, orbOne, orbTwo, environmentalDeath
    ]);
    const memory = makeMemoryPersistence([lockedMatch]);
    const service = makeService(memory, { missions: missionsV1 });

    const initialResult = await service.processGameEvent({
        matchId: 'match-1',
        eventId: eventOne.eventId
    });
    assert.equal(initialResult.ok, true);
    const newProfile = memory.profile('player-1');
    assert.equal(newProfile.level, 1);
    assert.equal(newProfile.totalXp, 10);
    assert.equal(newProfile.schemaVersion, SCHEMA_VERSION);
    assert.equal(newProfile.version, 2);
    assert.equal(newProfile.progressionVersion, 'progression-v1');
    assert.equal(newProfile.xpRulesVersion, 'xp-rules-v1');
    assert.equal(newProfile.levelCurveVersion, 'level-curve-v1');
    assert.equal(newProfile.updatedAt, 5000);

    const eventRetryBefore = memory.snapshot();
    const eventRetry = await service.processGameEvent({
        matchId: 'match-1',
        eventId: eventOne.eventId
    });
    assert.deepStrictEqual(eventRetry, initialResult);
    assert.deepStrictEqual(memory.snapshot(), eventRetryBefore);

    const concurrentEventRetry = await Promise.all([
        service.processGameEvent({ matchId: 'match-1', eventId: orbOne.eventId }),
        service.processGameEvent({ matchId: 'match-1', eventId: orbOne.eventId })
    ]);
    assert.equal(concurrentEventRetry.filter((response) => response.ok).length, 2);
    assert.deepStrictEqual(memory.profile('player-1').missionProgress['collect-orbs@v1'], {
        userId: 'player-1',
        missionId: 'collect-orbs',
        missionVersion: 'v1',
        progress: 1,
        target: 2,
        completed: false,
        completedAt: null,
        rewardClaimed: true,
        version: 2,
        updatedAt: 5000
    });
    await service.processGameEvent({ matchId: 'match-1', eventId: orbTwo.eventId });
    const afterOrbs = memory.profile('player-1');
    assert.equal(afterOrbs.missionProgress['collect-orbs@v1'].progress, 2);
    assert.equal(afterOrbs.missionProgress['collect-orbs@v1'].completed, true);
    assert.equal(afterOrbs.totalXp, 14);
    assert.equal((await service.processGameEvent({
        matchId: 'match-1',
        eventId: environmentalDeath.eventId
    })).data.actorId, null);
    assert.equal(memory.profile('player-2'), null);

    const concurrentResult = await Promise.all([
        service.processMatchResult({ matchId: 'match-1', resultId: 'result-1' }),
        service.processMatchResult({ matchId: 'match-1', resultId: 'result-1' })
    ]);
    assert.equal(concurrentResult.filter((response) => response.ok).length, 2);
    const profile1 = memory.profile('player-1');
    const profile2 = memory.profile('player-2');
    assert.equal(profile1.totalXp, 134);
    assert.equal(profile1.level, 2);
    assert.equal(profile2.totalXp, 35);
    assert.equal(profile2.level, 1);
    assert.equal(profile1.missionProgress['play-one@v1'].completed, true);
    assert.equal(profile1.missionProgress['win-one@v1'].completed, true);
    assert.equal(profile2.missionProgress['play-one@v1'].completed, true);
    assert.equal(profile2.missionProgress['win-one@v1'], undefined);
    assert.equal(memory.rewardCount(), 4);
    assert.equal((await service.getMissionReward(
        'player-1', 'elimination-one', 'v1'
    )).data.definition.definitionId, 'first-elimination');
    assert.equal((await service.getMissionReward(
        'player-1', 'play-one', 'v1'
    )).data.definition.definitionId, 'player-banner');
    assert.equal((await service.getMissionReward(
        'player-1', 'win-one', 'v1'
    )).data.definition.definitionId, 'match-winner');
    assert.equal((await service.getProfile('player-1')).data.level, 2);

    const beforeDuplicateResult = memory.snapshot();
    const duplicateResult = await service.processMatchResult({
        matchId: 'match-1',
        resultId: 'result-1'
    });
    assert.deepStrictEqual(duplicateResult, concurrentResult[0]);
    assert.deepStrictEqual(memory.snapshot(), beforeDuplicateResult);

    // A new mission version gets a separate progress key without erasing history.
    const matchTwoResult = validResult('match-2', 'result-2');
    const matchTwoEvent = gameEvent({
        matchId: 'match-2',
        eventId: 'match-2-kill',
        type: 'PlayerKilled'
    });
    memory.setMatch('match-2', makeLockedMatch('match-2', matchTwoResult, [matchTwoEvent]));
    const missionV2 = missionsV1
        .filter((mission) => mission.missionId !== 'elimination-one')
        .concat({
            ...missionsV1[0],
            version: 'v2',
            target: 2,
            xpReward: 40
        });
    const serviceV2 = makeService(memory, {
        missions: missionV2,
        policy: {
            progressionVersion: 'progression-v2',
            xpRulesVersion: 'xp-rules-v2',
            levelCurveVersion: 'level-curve-v2',
            eventXp: { OrbCollected: 3, PlayerKilled: 7 },
            matchXp: { participation: 10, winnerBonus: 20, drawBonus: 5 }
        },
        levelCurves: {
            'level-curve-v1': { baseXpPerLevel: 100 },
            'level-curve-v2': { baseXpPerLevel: 20 }
        }
    });
    await serviceV2.processGameEvent({ matchId: 'match-2', eventId: 'match-2-kill' });
    const versionedProfile = memory.profile('player-1');
    assert.equal(versionedProfile.levelCurveVersion, 'level-curve-v1');
    assert.equal(versionedProfile.level, getLevelForXp(versionedProfile.totalXp));
    assert.equal(versionedProfile.missionProgress['elimination-one@v1'].completed, true);
    assert.equal(versionedProfile.missionProgress['elimination-one@v2'], undefined);
    assert.equal(versionedProfile.progressionVersion, 'progression-v2');
    assert.equal(versionedProfile.xpRulesVersion, 'xp-rules-v2');
    await serviceV2.processMatchResult({ matchId: 'match-2', resultId: 'result-2' });
    assert.equal(memory.profile('player-1').missionProgress['elimination-one@v1'].progress, 1);
    assert.equal(memory.profile('player-1').missionProgress['elimination-one@v2'].progress, 1);
    assert.equal(memory.rewardCount(), 4);

    // Persisted authority is mandatory; caller-supplied business values are rejected.
    assert.equal((await service.processGameEvent({
        matchId: 'match-1',
        eventId: 'event-1',
        xp: 999
    })).error.code, PROGRESSION_ERRORS.INVALID_REQUEST);
    assert.equal((await service.processMatchResult({
        matchId: 'match-1',
        resultId: 'result-1',
        winner: 'player-2',
        xp: 999,
        reward: { type: 'badge', definitionId: 'forged' }
    })).error.code, PROGRESSION_ERRORS.INVALID_REQUEST);
    assert.equal((await service.processMatchResult({
        matchId: 'match-1',
        resultId: 'result-1',
        result
    })).error.code, PROGRESSION_ERRORS.INVALID_REQUEST);
    assert.equal((await service.processGameEvent({
        matchId: 'match-1',
        eventId: 'event-1',
        missionCompleted: true,
        progress: 100,
        level: 99,
        userId: 'player-2'
    })).error.code, PROGRESSION_ERRORS.INVALID_REQUEST);
    assert.equal((await service.getProfile('client-chosen-user')).error.code,
        PROGRESSION_ERRORS.PROFILE_NOT_FOUND);

    const unlocked = clone(lockedMatch);
    unlocked.status = 'FINISHING';
    unlocked.matchPersistence.resultLockedAt = null;
    unlocked.result.locked = false;
    memory.setMatch('unlocked-match', unlocked);
    assert.equal((await service.processMatchResult({
        matchId: 'unlocked-match',
        resultId: result.resultId
    })).error.code, PROGRESSION_ERRORS.RESULT_NOT_LOCKED);

    const zeroTimeMatch = clone(lockedMatch);
    zeroTimeMatch.matchPersistence.resultLockedAt = 0;
    const zeroTimeMemory = makeMemoryPersistence([zeroTimeMatch]);
    assert.equal((await makeService(zeroTimeMemory, {
        missions: missionsV1
    }).processMatchResult({
        matchId: 'match-1',
        resultId: 'result-1'
    })).ok, true);

    const malformedResult = validResult('invalid-result-match', 'bad-result', {
        participants: []
    });
    memory.setMatch('invalid-result-match', makeLockedMatch(
        'invalid-result-match',
        malformedResult
    ));
    assert.equal((await service.processMatchResult({
        matchId: 'invalid-result-match',
        resultId: malformedResult.resultId
    })).error.code, PROGRESSION_ERRORS.INVALID_RESULT);

    const invalidConfigMemory = makeMemoryPersistence();
    assert.throws(() => makeService(invalidConfigMemory, {
        policy: {
            ...require('../packages/progression/v2').DEFAULT_POLICY,
            eventXp: { OrbCollected: -1 },
            matchXp: { participation: 1, winnerBonus: 1, drawBonus: 1 }
        }
    }), new RegExp(PROGRESSION_ERRORS.INVALID_POLICY));
    assert.throws(() => makeService(invalidConfigMemory, {
        policy: {
            ...require('../packages/progression/v2').DEFAULT_POLICY,
            eventXp: { PlayerKilled: -1 }
        }
    }), new RegExp(PROGRESSION_ERRORS.INVALID_POLICY));
    assert.throws(() => createProgressionService({
        persistence: invalidConfigMemory.persistence,
        clock: () => 1,
        missions: [{ ...missionsV1[0], target: 0 }]
    }), new RegExp(PROGRESSION_ERRORS.INVALID_MISSION));

    // A lost response/retry is handled by durable idempotency, not process memory.
    const crashRetryMemory = makeMemoryPersistence([lockedMatch]);
    const crashRetryService = makeService(crashRetryMemory, { missions: missionsV1 });
    const firstAttempt = await crashRetryService.processMatchResult({
        matchId: 'match-1',
        resultId: 'result-1'
    });
    const beforeRetry = crashRetryMemory.snapshot();
    const retriedAfterCrash = await makeService(crashRetryMemory, {
        missions: missionsV1
    }).processMatchResult({ matchId: 'match-1', resultId: 'result-1' });
    assert.deepStrictEqual(retriedAfterCrash, firstAttempt);
    assert.deepStrictEqual(crashRetryMemory.snapshot(), beforeRetry);
    assert.ok(crashRetryMemory.idempotencyCount() > 0);

    // Reprocessing a locked result does not reopen completed mission progress.
    const completedBefore = clone(profile1.missionProgress);
    await service.processMatchResult({ matchId: 'match-1', resultId: 'result-1' });
    assert.deepStrictEqual(memory.profile('player-1').missionProgress['play-one@v1'],
        completedBefore['play-one@v1']);

    const source = fs.readFileSync(path.join(
        __dirname,
        '../packages/progression/v2/index.js'
    ), 'utf8');
    for (const forbidden of [
        /firebase/i,
        /firestore/i,
        /express/i,
        /socket\.io/i,
        /server\.js/i,
        /economy/i,
        /settlement/i,
        /game-engine/i,
        /public\//
    ]) {
        assert.doesNotMatch(source, forbidden);
    }
    assert.doesNotMatch(source, /\brequire\s*\(\s*['"][^'"]*(?:firebase|firestore|express|socket\.io|server\.js|economy|settlement|game-engine|public\/)[^'"]*['"]\s*\)/i);
    assert.doesNotMatch(fs.readFileSync(__filename, 'utf8'),
        /\brequire\s*\(\s*['"][^'"]*(?:firebase|firestore|express|socket\.io|server\.js|economy|settlement|game-engine|public\/)[^'"]*['"]\s*\)/i);

    console.log('OK progression v2: authoritative XP, versioned levels/missions, atomic rewards and durable idempotency.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
