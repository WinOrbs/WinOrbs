'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
    MATCH_PERSISTENCE_ERRORS,
    createMatchPersistence
} = require('../packages/match-persistence/v2');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function gameState(matchId, status, rulesVersion = 'rules-v2', sequence = 0) {
    return {
        schemaVersion: 1,
        match: { matchId, status, rulesVersion, startedAt: null },
        players: {},
        teams: {},
        projectiles: [],
        loot: [],
        orbs: [],
        zone: { center: { x: 1, y: 1 }, radius: 100, phase: 0 },
        bankZone: { center: { x: 1, y: 1 }, radius: 10 },
        timers: { elapsedMs: 0, remainingMs: null },
        sequence
    };
}

function snapshot(matchId, status, rulesVersion = 'rules-v2', sequence = 0) {
    return {
        schemaVersion: 1,
        matchId,
        status,
        memberActorIds: [],
        members: [],
        readyActorIds: [],
        notReadyActorIds: [],
        gameState: gameState(matchId, status, rulesVersion, sequence)
    };
}

function result(matchId = 'match-1') {
    const value = {
        schemaVersion: 1,
        resultId: `result-${matchId}`,
        matchId,
        rulesVersion: 'rules-v2',
        startedAt: 10,
        finishedAt: 20,
        finishReason: 'TIME_LIMIT',
        participants: [{
            actorId: 'player-a',
            teamId: null,
            status: 'COMPLETED',
            statistics: { score: 10, kills: 1, deaths: 0 }
        }],
        rankings: [{ rank: 1, actorIds: ['player-a'], teamId: null }],
        teams: [],
        statistics: { durationMs: 10 },
        resultHash: ''
    };
    value.resultHash = crypto.createHash('sha256')
        .update(canonical(value))
        .digest('hex');
    return value;
}

function makePersistence() {
    const matches = new Map();
    let transactionQueue = Promise.resolve();
    let walletCalls = 0;
    let ledgerCalls = 0;
    let settlementCalls = 0;
    const noOp = async () => null;
    const repository = {
        UserRepository: { getById: noOp, create: noOp, update: noOp },
        WalletRepository: {
            getByUserId: async () => {
                walletCalls += 1;
                return null;
            },
            create: noOp,
            update: async () => { walletCalls += 1; }
        },
        LedgerRepository: {
            getById: noOp,
            listByMatch: async () => [],
            append: async () => { ledgerCalls += 1; }
        },
        MatchRepository: {
            getById: async (id) => clone(matches.get(id) || null),
            create: async (id, value) => {
                if (matches.has(id)) throw new Error('duplicate match');
                matches.set(id, clone(value));
            },
            update: async (id, patch) => {
                if (!matches.has(id)) throw new Error('missing match');
                matches.set(id, { ...matches.get(id), ...clone(patch) });
            },
            claimSettlement: async () => {
                settlementCalls += 1;
                return { claimed: true, settlement: null };
            }
        },
        InventoryRepository: { getByUserId: noOp, replaceForUser: noOp },
        ProgressionRepository: { getByUserId: noOp, replaceForUser: noOp },
        RewardRepository: { getById: noOp, create: noOp, update: noOp },
        PaymentRepository: { getById: noOp, create: noOp, update: noOp },
        AuditRepository: { append: noOp, listByAggregate: async () => [] },
        IdempotencyRepository: { getByKey: noOp, claim: noOp },
        OutboxRepository: {
            getById: noOp,
            enqueue: noOp,
            listPending: async () => [],
            markPublished: noOp
        },
        async runInTransaction(work) {
            const previous = transactionQueue;
            let release;
            transactionQueue = new Promise((resolve) => { release = resolve; });
            await previous;
            const staged = new Map([...matches].map(([id, value]) => [id, clone(value)]));
            const tx = {
                ...repository,
                MatchRepository: {
                    getById: async (id) => clone(staged.get(id) || null),
                    create: async (id, value) => {
                        if (staged.has(id)) throw new Error('duplicate match');
                        staged.set(id, clone(value));
                    },
                    update: async (id, patch) => {
                        if (!staged.has(id)) throw new Error('missing match');
                        staged.set(id, { ...staged.get(id), ...clone(patch) });
                    },
                    claimSettlement: repository.MatchRepository.claimSettlement
                },
                transaction: {}
            };
            try {
                const response = await work(tx);
                matches.clear();
                for (const [id, value] of staged) matches.set(id, value);
                return response;
            } finally {
                release();
            }
        }
    };
    return {
        persistence: repository,
        get(id) { return clone(matches.get(id) || null); },
        set(id, value) { matches.set(id, clone(value)); },
        sideEffects() { return { walletCalls, ledgerCalls, settlementCalls }; }
    };
}

let now = 1000;

function makeService(memory) {
    return createMatchPersistence({
        persistence: memory.persistence,
        clock: () => now
    });
}

async function createAt(service, matchId = 'match-1') {
    const created = await service.createMatch({
        matchId,
        rulesVersion: 'rules-v2',
        metadata: { map: 'arena-1', mode: 'ranked' }
    });
    assert.strictEqual(created.ok, true);
    return created.match;
}

async function moveTo(service, matchId, fromVersion, states) {
    let version = fromVersion;
    for (const to of states) {
        const moved = await service.transitionLifecycle({
            matchId,
            expectedStateVersion: version,
            to
        });
        assert.strictEqual(moved.ok, true, JSON.stringify(moved));
        version = moved.stateVersion;
    }
    return version;
}

async function run() {
    now = 1000;
    const memory = makePersistence();
    const service = makeService(memory);

    // Create, filtered metadata and initial version state.
    const created = await createAt(service);
    assert.strictEqual(created.status, 'WAITING');
    assert.strictEqual(created.matchPersistence.schemaVersion, 1);
    assert.strictEqual(created.matchPersistence.stateVersion, 1);
    assert.strictEqual(created.matchPersistence.eventSequence, 0);
    assert.strictEqual((await service.createMatch({
        matchId: 'match-1',
        rulesVersion: 'rules-v2'
    })).error.code, MATCH_PERSISTENCE_ERRORS.MATCH_ALREADY_EXISTS);
    assert.strictEqual((await service.createMatch({
        matchId: 'unsafe',
        rulesVersion: 'rules-v2',
        metadata: { accessToken: 'do-not-store' }
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_METADATA);

    // Snapshot save/load, stale write rejection, and forbidden state rejection.
    let currentVersion = created.matchPersistence.stateVersion;
    const waitingSnapshot = snapshot('match-1', 'WAITING');
    const saved = await service.saveSnapshot({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        snapshotVersion: 10,
        snapshotEventSequence: 0,
        snapshot: waitingSnapshot
    });
    assert.strictEqual(saved.ok, true);
    currentVersion = saved.stateVersion;
    assert.deepStrictEqual((await service.loadSnapshot('match-1')).snapshot.value,
        waitingSnapshot);
    assert.strictEqual((await service.saveSnapshot({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        snapshotVersion: 9,
        snapshotEventSequence: 0,
        snapshot: waitingSnapshot
    })).error.code, MATCH_PERSISTENCE_ERRORS.STALE_VERSION);
    assert.strictEqual((await service.saveSnapshot({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        snapshotVersion: 11,
        snapshotEventSequence: 0,
        snapshot: { ...waitingSnapshot, wallet: { balance: 1 } }
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
    const publicMatch = await service.loadMatch('match-1');
    assert.strictEqual(Object.hasOwn(publicMatch.match, 'economy'), false);
    assert.strictEqual(memory.sideEffects().walletCalls, 0);

    // Lifecycle transitions are explicit, versioned and stale writers lose.
    const ready = await service.transitionLifecycle({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        to: 'READY'
    });
    assert.strictEqual(ready.ok, true);
    currentVersion = ready.stateVersion;
    assert.strictEqual((await service.transitionLifecycle({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        to: 'RUNNING'
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION);
    const race = await Promise.all([
        service.transitionLifecycle({
            matchId: 'match-1',
            expectedStateVersion: currentVersion,
            to: 'WAITING'
        }),
        service.transitionLifecycle({
            matchId: 'match-1',
            expectedStateVersion: currentVersion,
            to: 'WAITING'
        })
    ]);
    assert.strictEqual(race.filter((item) => item.ok).length, 1);
    assert.strictEqual(race.filter((item) =>
        item.error?.code === MATCH_PERSISTENCE_ERRORS.STALE_VERSION).length, 1);

    // Event timestamp is server supplied; sequence, IDs and contracts are checked.
    currentVersion = memory.get('match-1').matchPersistence.stateVersion;
    const countdown = await service.transitionLifecycle({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        to: 'READY'
    });
    currentVersion = countdown.stateVersion;
    const toCountdown = await service.transitionLifecycle({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        to: 'COUNTDOWN'
    });
    currentVersion = toCountdown.stateVersion;
    const running = await service.transitionLifecycle({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        to: 'RUNNING'
    });
    currentVersion = running.stateVersion;
    const appended = await service.appendEvents({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        events: [{
            eventId: 'event-1',
            matchId: 'match-1',
            sequence: 1,
            timestamp: -500,
            type: 'MatchStarted',
            payload: { startedAt: 1000, rulesVersion: 'rules-v2' }
        }]
    });
    assert.strictEqual(appended.ok, false);
    assert.strictEqual(appended.error.code, MATCH_PERSISTENCE_ERRORS.INVALID_EVENT);
    const appendedWithoutClientTime = await service.appendEvents({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        events: [{
            eventId: 'event-1',
            matchId: 'match-1',
            sequence: 1,
            type: 'MatchStarted',
            payload: { startedAt: 1000, rulesVersion: 'rules-v2' }
        }]
    });
    assert.strictEqual(appendedWithoutClientTime.ok, true);
    assert.strictEqual(appendedWithoutClientTime.events[0].timestamp, now);
    currentVersion = appendedWithoutClientTime.stateVersion;
    assert.strictEqual((await service.appendEvents({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        events: [{
            eventId: 'event-1',
            matchId: 'match-1',
            sequence: 2,
            type: 'MatchStarted',
            payload: { startedAt: 1000, rulesVersion: 'rules-v2' }
        }]
    })).error.code, MATCH_PERSISTENCE_ERRORS.DUPLICATE_EVENT_ID);
    assert.strictEqual((await service.appendEvents({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        events: [{
            eventId: 'event-2',
            matchId: 'match-1',
            sequence: 3,
            type: 'MatchStarted',
            payload: { startedAt: 1000, rulesVersion: 'rules-v2' }
        }]
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_EVENT_SEQUENCE);

    // Save a snapshot at cursor 0; event history after it is recoverable but not replayed here.
    const runningSnapshot = snapshot('match-1', 'RUNNING', 'rules-v2', 1);
    const savedRunning = await service.saveSnapshot({
        matchId: 'match-1',
        expectedStateVersion: currentVersion,
        snapshotVersion: 11,
        snapshotEventSequence: 0,
        snapshot: runningSnapshot
    });
    assert.strictEqual(savedRunning.ok, true);
    const loadedEvents = await service.loadEvents('match-1', 1);
    assert.strictEqual(loadedEvents.events.length, 1);
    const runningRecovery = await service.recoverMatch('match-1');
    assert.strictEqual(runningRecovery.state, 'RECOVERABLE');
    assert.strictEqual(runningRecovery.replayRequired, true);
    assert.strictEqual(runningRecovery.actionRequired,
        'REPLAY_AUTHORITATIVE_EVENTS_WITH_GAME_ENGINE');

    // Detect gaps and event log corruption instead of filling or reordering history.
    const corruptedEvents = memory.get('match-1');
    corruptedEvents.matchPersistence.events[0].sequence = 2;
    memory.set('match-1', corruptedEvents);
    const gap = await service.recoverMatch('match-1');
    assert.strictEqual(gap.ok, false);
    assert.strictEqual(gap.error.code, MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE);
    assert.strictEqual(gap.error.diagnostic.type, 'EVENT_SEQUENCE_GAP');

    // Fresh match: RUNNING without a snapshot after events-only crash requires explicit abort.
    const eventCrashMemory = makePersistence();
    const eventCrash = makeService(eventCrashMemory);
    let version = (await createAt(eventCrash, 'event-crash')).matchPersistence.stateVersion;
    version = await moveTo(eventCrash, 'event-crash', version, ['READY', 'COUNTDOWN', 'RUNNING']);
    await eventCrash.appendEvents({
        matchId: 'event-crash',
        expectedStateVersion: version,
        events: [{
            eventId: 'crash-event-1',
            matchId: 'event-crash',
            sequence: 1,
            type: 'MatchStarted',
            payload: { startedAt: 1000, rulesVersion: 'rules-v2' }
        }]
    });
    assert.strictEqual((await eventCrash.recoverMatch('event-crash')).state, 'ABORT_REQUIRED');

    // Snapshot persisted ahead of event log is an explicit inconsistency.
    const aheadMemory = makePersistence();
    const ahead = makeService(aheadMemory);
    let aheadVersion = (await createAt(ahead, 'ahead')).matchPersistence.stateVersion;
    aheadVersion = await moveTo(ahead, 'ahead', aheadVersion,
        ['READY', 'COUNTDOWN', 'RUNNING']);
    await ahead.saveSnapshot({
        matchId: 'ahead',
        expectedStateVersion: aheadVersion,
        snapshotVersion: 1,
        snapshotEventSequence: 1,
        snapshot: snapshot('ahead', 'RUNNING')
    });
    const aheadRecovery = await ahead.recoverMatch('ahead');
    assert.strictEqual(aheadRecovery.ok, false);
    assert.strictEqual(aheadRecovery.error.diagnostic.type, 'SNAPSHOT_AHEAD_OF_EVENT_LOG');

    // FINISHING result save, result hash verification, immutable lock and recovery.
    const resultMemory = makePersistence();
    const resultService = makeService(resultMemory);
    let resultVersion = (await createAt(resultService, 'result-match'))
        .matchPersistence.stateVersion;
    resultVersion = await moveTo(resultService, 'result-match', resultVersion,
        ['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING']);
    const finalEvent = await resultService.appendEvents({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        events: [{
            eventId: 'result-match-finished',
            matchId: 'result-match',
            sequence: 1,
            type: 'MatchFinished',
            payload: { resultId: 'result-result-match', finishReason: 'TIME_LIMIT' }
        }]
    });
    assert.strictEqual(finalEvent.ok, true);
    assert.strictEqual(finalEvent.eventSequence, 1);
    resultVersion = finalEvent.stateVersion;
    const savedPreLockSnapshot = await resultService.saveSnapshot({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        snapshotVersion: 10,
        snapshotEventSequence: 1,
        snapshot: snapshot('result-match', 'FINISHING')
    });
    assert.strictEqual(savedPreLockSnapshot.ok, true);
    resultVersion = savedPreLockSnapshot.stateVersion;
    const matchResult = result('result-match');
    const savedResult = await resultService.saveResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v1',
        result: matchResult
    });
    assert.strictEqual(savedResult.ok, true);
    resultVersion = savedResult.stateVersion;
    assert.strictEqual((await resultService.loadResult('result-match')).locked, false);
    assert.strictEqual((await resultService.recoverMatch('result-match')).actionRequired,
        'LOCK_VALID_PERSISTED_RESULT');
    assert.strictEqual((await resultService.saveResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v1',
        result: { ...matchResult, resultHash: 'b'.repeat(64) }
    })).error.code, MATCH_PERSISTENCE_ERRORS.RESULT_HASH_MISMATCH);
    assert.strictEqual((await resultService.saveResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v1',
        result: { ...matchResult, resultId: 'different' }
    })).error.code, MATCH_PERSISTENCE_ERRORS.RESULT_HASH_MISMATCH);
    const finalSnapshot = snapshot('result-match', 'RESULT_LOCKED');
    const staleFinalization = await resultService.finalizeResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion - 1,
        resultVersion: 'result-v1',
        snapshotVersion: 11,
        snapshotEventSequence: 1,
        snapshot: finalSnapshot,
        result: matchResult
    });
    assert.strictEqual(staleFinalization.error.code, MATCH_PERSISTENCE_ERRORS.STALE_VERSION);
    const locked = await resultService.finalizeResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v1',
        snapshotVersion: 11,
        snapshotEventSequence: 1,
        snapshot: finalSnapshot,
        result: matchResult
    });
    assert.strictEqual(locked.ok, true);
    assert.strictEqual(locked.status, 'RESULT_LOCKED');
    const lockedAggregate = resultMemory.get('result-match');
    assert.strictEqual(lockedAggregate.status, 'RESULT_LOCKED');
    assert.strictEqual(lockedAggregate.matchPersistence.snapshot.value.status, 'RESULT_LOCKED');
    assert.strictEqual(lockedAggregate.result.locked, true);
    assert.deepStrictEqual(lockedAggregate.result.value, matchResult);
    resultVersion = locked.stateVersion;
    const loadedFinalSnapshot = await resultService.loadSnapshot('result-match');
    assert.strictEqual(loadedFinalSnapshot.lifecycle, 'RESULT_LOCKED');
    assert.strictEqual(loadedFinalSnapshot.snapshot.value.status, 'RESULT_LOCKED');
    assert.strictEqual(loadedFinalSnapshot.snapshot.eventSequence, 1);
    const loadedFinalEvents = await resultService.loadEvents('result-match');
    assert.strictEqual(loadedFinalEvents.eventSequence, 1);
    assert.deepStrictEqual(loadedFinalEvents.events.map((event) => event.sequence), [1]);
    const recoveredResultMatch = await resultService.recoverMatch('result-match');
    assert.strictEqual(recoveredResultMatch.state, 'RESULT_LOCKED');
    assert.strictEqual(recoveredResultMatch.match.status, 'RESULT_LOCKED');
    assert.strictEqual(recoveredResultMatch.match.matchPersistence.snapshot.value.status,
        'RESULT_LOCKED');
    assert.deepStrictEqual(recoveredResultMatch.match.result, matchResult);
    const repeatedFinalization = await resultService.finalizeResult({
        matchId: 'result-match',
        expectedStateVersion: savedResult.stateVersion,
        resultVersion: 'result-v1',
        snapshotVersion: 11,
        snapshotEventSequence: 1,
        snapshot: finalSnapshot,
        result: matchResult
    });
    assert.strictEqual(repeatedFinalization.ok, true);
    assert.strictEqual(repeatedFinalization.stateVersion, resultVersion);
    assert.deepStrictEqual(resultMemory.get('result-match').result.value, matchResult);
    const incompatibleResult = result('result-match');
    incompatibleResult.resultId = 'other-result';
    incompatibleResult.resultHash = '';
    incompatibleResult.resultHash = crypto.createHash('sha256')
        .update(canonical(incompatibleResult))
        .digest('hex');
    const incompatibleFinalization = await resultService.finalizeResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v2',
        snapshotVersion: 12,
        snapshotEventSequence: 1,
        snapshot: finalSnapshot,
        result: incompatibleResult
    });
    assert.strictEqual(incompatibleFinalization.error.code,
        MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
    assert.strictEqual((await resultService.loadResult('result-match')).locked, true);
    assert.strictEqual((await resultService.appendEvents({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        events: [{
            eventId: 'late-event',
            matchId: 'result-match',
            sequence: 1,
            type: 'MatchFinished',
            payload: { resultId: matchResult.resultId, finishReason: 'TIME_LIMIT' }
        }]
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_EVENT);
    assert.strictEqual((await resultService.lockResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v1',
        resultId: matchResult.resultId,
        resultHash: 'c'.repeat(64)
    })).error.code, MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
    const changedResult = result('result-match');
    changedResult.resultId = 'replacement-result';
    changedResult.resultHash = '';
    changedResult.resultHash = crypto.createHash('sha256')
        .update(canonical(changedResult))
        .digest('hex');
    const rejectedReplacement = await resultService.saveResult({
        matchId: 'result-match',
        expectedStateVersion: resultVersion,
        resultVersion: 'result-v2',
        result: changedResult
    });
    assert.strictEqual(rejectedReplacement.error.code,
        MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
    assert.ok(resultMemory.get('result-match').matchPersistence.diagnostics
        .some((item) => item.type === 'RESULT_REPLACEMENT_AFTER_LOCK'));
    resultVersion = resultMemory.get('result-match').matchPersistence.stateVersion;
    const rawLocked = resultMemory.get('result-match');
    rawLocked.result.value.resultHash = 'c'.repeat(64);
    resultMemory.set('result-match', rawLocked);
    assert.strictEqual((await resultService.recoverMatch('result-match')).error.diagnostic.type,
        'RESULT_HASH_OR_VERSION_INCONSISTENT');

    // A locked lifecycle with an old snapshot is an inconsistency, never repaired.
    const inconsistentLocked = resultMemory.get('result-match');
    inconsistentLocked.result.value = matchResult;
    inconsistentLocked.matchPersistence.snapshot.value.status = 'RUNNING';
    inconsistentLocked.matchPersistence.snapshot.value.gameState.match.status = 'RUNNING';
    resultMemory.set('result-match', inconsistentLocked);
    const inconsistentRecovery = await resultService.recoverMatch('result-match');
    assert.strictEqual(inconsistentRecovery.ok, false);
    assert.strictEqual(inconsistentRecovery.error.code,
        MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE);
    assert.strictEqual(inconsistentRecovery.error.diagnostic.type,
        'SNAPSHOT_INVALID_OR_LIFECYCLE_MISMATCH');
    assert.strictEqual(resultMemory.get('result-match').matchPersistence.snapshot.value.status,
        'RUNNING');

    // Two concurrent finalizations can commit only one authoritative result.
    const raceMemory = makePersistence();
    const raceService = makeService(raceMemory);
    let raceVersion = (await createAt(raceService, 'finalize-race'))
        .matchPersistence.stateVersion;
    raceVersion = await moveTo(raceService, 'finalize-race', raceVersion,
        ['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING']);
    const raceResultA = result('finalize-race');
    const raceResultB = result('finalize-race');
    raceResultB.resultId = 'other-race-result';
    raceResultB.resultHash = '';
    raceResultB.resultHash = crypto.createHash('sha256')
        .update(canonical(raceResultB))
        .digest('hex');
    const raceFinalization = (candidate, resultVersionId, snapshotVersion) =>
        raceService.finalizeResult({
            matchId: 'finalize-race',
            expectedStateVersion: raceVersion,
            resultVersion: resultVersionId,
            snapshotVersion,
            snapshotEventSequence: 0,
            snapshot: snapshot('finalize-race', 'RESULT_LOCKED'),
            result: candidate
        });
    const raceResults = await Promise.all([
        raceFinalization(raceResultA, 'race-result-a', 1),
        raceFinalization(raceResultB, 'race-result-b', 2)
    ]);
    assert.strictEqual(raceResults.filter((response) => response.ok).length, 1);
    assert.strictEqual(raceResults.filter((response) =>
        response.error?.code === MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE).length, 1);
    const raceAggregate = raceMemory.get('finalize-race');
    assert.strictEqual(raceAggregate.status, 'RESULT_LOCKED');
    assert.strictEqual(raceAggregate.matchPersistence.snapshot.value.status, 'RESULT_LOCKED');
    assert.strictEqual(raceAggregate.result.locked, true);
    assert.ok([raceResultA.resultId, raceResultB.resultId]
        .includes(raceAggregate.result.value.resultId));
    assert.strictEqual((await raceService.recoverMatch('finalize-race')).state,
        'RESULT_LOCKED');

    // Lifecycle recovery for settling and settled states; invalid transitions stay rejected.
    const settleMemory = makePersistence();
    const settleService = makeService(settleMemory);
    let settleVersion = (await createAt(settleService, 'settle-match'))
        .matchPersistence.stateVersion;
    settleVersion = await moveTo(settleService, 'settle-match', settleVersion,
        ['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING']);
    const settleResult = result('settle-match');
    const stored = await settleService.saveResult({
        matchId: 'settle-match',
        expectedStateVersion: settleVersion,
        resultVersion: 'result-v1',
        result: settleResult
    });
    const resultLocked = await settleService.lockResult({
        matchId: 'settle-match',
        expectedStateVersion: stored.stateVersion,
        resultVersion: 'result-v1',
        snapshotVersion: 1,
        snapshotEventSequence: 0,
        snapshot: snapshot('settle-match', 'RESULT_LOCKED'),
        resultId: settleResult.resultId,
        resultHash: settleResult.resultHash
    });
    const settling = await settleService.transitionLifecycle({
        matchId: 'settle-match',
        expectedStateVersion: resultLocked.stateVersion,
        to: 'SETTLING'
    });
    assert.strictEqual(settling.ok, true);
    assert.strictEqual((await settleService.recoverMatch('settle-match')).state, 'SETTLING');
    assert.strictEqual((await settleService.transitionLifecycle({
        matchId: 'settle-match',
        expectedStateVersion: settling.stateVersion,
        to: 'RUNNING'
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION);
    const settled = await settleService.transitionLifecycle({
        matchId: 'settle-match',
        expectedStateVersion: settling.stateVersion,
        to: 'SETTLED',
        settlementVersion: 'result-v1'
    });
    assert.strictEqual(settled.ok, true);
    assert.strictEqual((await settleService.recoverMatch('settle-match')).state, 'SETTLED');
    assert.strictEqual((await settleService.transitionLifecycle({
        matchId: 'settle-match',
        expectedStateVersion: settled.stateVersion,
        to: 'FINISHING'
    })).error.code, MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION);
    assert.strictEqual((await settleService.recoverMatch('not-found')).state, 'NOT_FOUND');

    // Dependency boundary: no Economy/Settlement/Wallet/Ledger calls are made.
    for (const instance of [
        memory, eventCrashMemory, aheadMemory, resultMemory, raceMemory, settleMemory
    ]) {
        assert.deepStrictEqual(instance.sideEffects(), {
            walletCalls: 0,
            ledgerCalls: 0,
            settlementCalls: 0
        });
    }

    console.log('OK match persistence v2: validated snapshots/events/results, versioned transitions and fail-closed recovery.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
