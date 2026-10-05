'use strict';

const assert = require('assert');
const { createWinOrbsV2 } = require('../../bootstrap/v2');
const { validateMatchResult } = require('../../contracts/v2/validation');

const SYSTEM_OPERATIONS = Object.freeze([
    'startCountdown',
    'startMatch',
    'finishMatch',
    'lockResult'
]);

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createControlledClock(start = 1_700_000_000_000) {
    if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('Clock start must be a non-negative safe integer');
    }
    let current = start;
    const clock = () => current;
    clock.advance = (milliseconds = 1) => {
        if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
            throw new TypeError('Clock advancement must be a non-negative integer');
        }
        current += milliseconds;
        return current;
    };
    return clock;
}

function createInMemoryPersistence() {
    const matches = new Map();
    const wallets = new Map();
    const ledger = [];
    const settlements = new Map();
    const outbox = new Map();
    const users = new Map();
    const inventories = new Map();
    const progressions = new Map();
    const rewards = new Map();
    const payments = new Map();
    const idempotency = new Map();
    const audits = [];
    const transactionLog = [];
    let queue = Promise.resolve();
    const counters = {
        walletMutations: 0,
        ledgerMutations: 0,
        settlementMutations: 0,
        outboxMutations: 0
    };
    const noop = async () => null;
    const repositories = {
        UserRepository: {
            getById: async (id) => clone(users.get(id) || null),
            create: async (id, value) => {
                if (users.has(id)) throw new Error('duplicate user');
                users.set(id, clone(value));
                return clone(value);
            },
            update: async (id, value) => {
                if (!users.has(id)) throw new Error('missing user');
                users.set(id, clone(value));
                return clone(value);
            }
        },
        WalletRepository: {
            getByUserId: async (id) => clone(wallets.get(id) || null),
            create: async (id, value) => {
                counters.walletMutations += 1;
                if (wallets.has(id)) throw new Error('duplicate wallet');
                wallets.set(id, clone(value));
                return clone(value);
            },
            update: async (id, value) => {
                counters.walletMutations += 1;
                if (!wallets.has(id)) throw new Error('missing wallet');
                wallets.set(id, clone(value));
                return clone(value);
            }
        },
        LedgerRepository: {
            getById: async (id) => clone(ledger.find((entry) => entry.id === id) || null),
            listByMatch: async (matchId) =>
                clone(ledger.filter((entry) => entry.matchId === matchId)),
            append: async (entry) => {
                counters.ledgerMutations += 1;
                ledger.push(clone(entry));
                return clone(entry);
            }
        },
        MatchRepository: {
            getById: async (id) => clone(matches.get(id) || null),
            create: async (id, value) => {
                if (matches.has(id)) throw new Error('duplicate match');
                matches.set(id, clone(value));
                return clone(value);
            },
            update: async (id, patch) => {
                if (!matches.has(id)) throw new Error('missing match');
                matches.set(id, { ...matches.get(id), ...clone(patch) });
                return clone(matches.get(id));
            },
            claimSettlement: async (id, value) => {
                counters.settlementMutations += 1;
                if (settlements.has(id)) return { claimed: false, settlement: clone(settlements.get(id)) };
                settlements.set(id, clone(value));
                return { claimed: true, settlement: clone(value) };
            }
        },
        InventoryRepository: {
            getByUserId: async (id) => clone(inventories.get(id) || null),
            replaceForUser: async (id, value) => {
                inventories.set(id, clone(value));
                return clone(value);
            }
        },
        ProgressionRepository: {
            getByUserId: async (id) => clone(progressions.get(id) || null),
            replaceForUser: async (id, value) => {
                progressions.set(id, clone(value));
                return clone(value);
            }
        },
        RewardRepository: {
            getById: async (id) => clone(rewards.get(id) || null),
            create: async (id, value) => {
                rewards.set(id, clone(value));
                return clone(value);
            },
            update: async (id, value) => {
                rewards.set(id, clone(value));
                return clone(value);
            }
        },
        PaymentRepository: {
            getById: async (id) => clone(payments.get(id) || null),
            create: async (id, value) => {
                payments.set(id, clone(value));
                return clone(value);
            },
            update: async (id, value) => {
                payments.set(id, clone(value));
                return clone(value);
            }
        },
        AuditRepository: {
            append: async (entry) => {
                audits.push(clone(entry));
                return clone(entry);
            },
            listByAggregate: async () => clone(audits)
        },
        IdempotencyRepository: {
            getByKey: async (key) => clone(idempotency.get(key) || null),
            claim: async (key, value) => {
                if (idempotency.has(key)) return { claimed: false, value: clone(idempotency.get(key)) };
                idempotency.set(key, clone(value));
                return { claimed: true, value: clone(value) };
            }
        },
        OutboxRepository: {
            getById: async (id) => clone(outbox.get(id) || null),
            enqueue: async (id, value) => {
                counters.outboxMutations += 1;
                outbox.set(id, clone(value));
                return clone(value);
            },
            listPending: async () => clone([...outbox.values()]),
            markPublished: async (id) => {
                counters.outboxMutations += 1;
                const value = outbox.get(id);
                if (!value) return null;
                value.published = true;
                return clone(value);
            }
        },
        async runInTransaction(work) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            await previous;
            const stagedMatches = new Map(
                [...matches].map(([id, value]) => [id, clone(value)])
            );
            const updates = [];
            const matchRepository = {
                getById: async (id) => clone(stagedMatches.get(id) || null),
                create: async (id, value) => {
                    if (stagedMatches.has(id)) throw new Error('duplicate match');
                    stagedMatches.set(id, clone(value));
                    return clone(value);
                },
                update: async (id, patch) => {
                    if (!stagedMatches.has(id)) throw new Error('missing match');
                    updates.push({ matchId: id, keys: Object.keys(patch).sort() });
                    stagedMatches.set(id, { ...stagedMatches.get(id), ...clone(patch) });
                    return clone(stagedMatches.get(id));
                },
                claimSettlement: repositories.MatchRepository.claimSettlement
            };
            try {
                const response = await work({
                    ...repositories,
                    MatchRepository: matchRepository,
                    transaction: Object.freeze({})
                });
                matches.clear();
                for (const [id, value] of stagedMatches) matches.set(id, value);
                transactionLog.push({ updates });
                return response;
            } finally {
                release();
            }
        }
    };

    function snapshot() {
        return {
            matches: clone([...matches.entries()]),
            wallets: clone([...wallets.entries()]),
            ledger: clone(ledger),
            settlements: clone([...settlements.entries()]),
            outbox: clone([...outbox.entries()]),
            counters: clone(counters)
        };
    }

    return Object.freeze({
        repositories,
        snapshot,
        getMatch: (matchId) => clone(matches.get(matchId) || null),
        replaceMatchForTest: (matchId, value) => matches.set(matchId, clone(value)),
        transactions: () => clone(transactionLog)
    });
}

function createRuntimeHarness({
    identity,
    controlledClock,
    controlledRandomSource,
    matchId = 'harness-match-1'
} = {}) {
    if (!identity ||
        typeof identity.authenticate !== 'function' ||
        typeof identity.requirePermission !== 'function' ||
        typeof identity.authorizeSystemOperation !== 'function' ||
        typeof identity.consumeSystemOperation !== 'function') {
        throw new TypeError('An injected Identity service is required');
    }
    if (typeof controlledClock !== 'function' ||
        typeof controlledRandomSource !== 'function') {
        throw new TypeError('Controlled clock and random source are required');
    }
    if (typeof matchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(matchId)) {
        throw new TypeError('A valid deterministic matchId is required');
    }

    const memory = createInMemoryPersistence();
    const emitted = [];
    const observabilitySink = {
        async write(event) {
            emitted.push(clone(event));
        }
    };
    const root = createWinOrbsV2({
        clock: controlledClock,
        randomSource: controlledRandomSource,
        matchId,
        rulesVersion: 'rules-v2',
        coordinatorOptions: {
            rules: { matchDurationMs: null },
            durationMs: 60_000
        },
        persistence: memory.repositories,
        identity,
        observabilitySink,
        authorizeSystem: async (credential) => credential === 'harness-system-credential',
        idFactory: () => `${matchId}:economy-id`
    });
    const correlation = root.observability.createCorrelationContext({
        correlationId: `correlation-${matchId}`,
        requestId: `request-${matchId}`,
        matchId
    });
    if (!correlation.ok) throw new TypeError('Could not create the harness correlation context');

    async function log(eventType, operation, outcome, principal) {
        const result = await root.observability.logEvent({
            eventId: `${matchId}:observation:${emitted.length + 1}`,
            eventType,
            category: eventType.startsWith('recovery.') ? 'RECOVERY' : 'MATCH',
            ...correlation.data,
            ...(principal ? {
                actorId: principal.userId,
                sessionId: principal.sessionId
            } : {}),
            operation,
            outcome,
            metadata: { harness: true }
        });
        if (!result.ok) throw new Error(`Observability failed: ${result.error.code}`);
        return result.data;
    }

    async function issueSystemCapability(operation) {
        const authorized = await root.identity.authorizeSystemOperation(
            'harness-system-credential',
            operation
        );
        if (!authorized.ok) throw new Error(`System operation denied: ${operation}`);
        return authorized.capability;
    }

    return Object.freeze({
        root,
        memory,
        emitted,
        matchId,
        correlation: correlation.data,
        log,
        issueSystemCapability,
        runScenario: async ({ player1Credential = 'fake-player-1', player2Credential = 'fake-player-2' } = {}) =>
            runScenario({
                root,
                memory,
                emitted,
                matchId,
                correlation: correlation.data,
                controlledClock,
                controlledRandomSource,
                log,
                issueSystemCapability,
                player1Credential,
                player2Credential
            })
    });
}

async function runScenario(context) {
    const {
        root,
        memory,
        matchId,
        controlledClock,
        controlledRandomSource,
        log,
        issueSystemCapability,
        player1Credential,
        player2Credential
    } = context;
    void controlledRandomSource;
    const app = root.application;
    const coordinator = root.matchCoordinator;
    const persistence = root.matchPersistence;
    const recoveryBoundary = root.applicationRecovery;
    const player1Auth = await root.identity.authenticate({ credential: player1Credential });
    const player2Auth = await root.identity.authenticate({ credential: player2Credential });
    if (!player1Auth.ok || !player2Auth.ok) throw new Error('Harness players could not authenticate');
    const player1 = player1Auth.principal;
    const player2 = player2Auth.principal;
    if (player1.userId === player2.userId || player1.sessionId === player2.sessionId) {
        throw new Error('Harness players must have different actors and sessions');
    }
    const notFound = await recoveryBoundary.recoverMatch(player1, matchId);
    if (!notFound.ok || notFound.data.state !== 'NOT_FOUND') {
        throw new Error('Application Recovery did not preserve NOT_FOUND');
    }
    const crashRecovery = [{
        stage: 'not-found',
        recovery: notFound
    }];

    const persisted = await persistence.createMatch({
        matchId,
        rulesVersion: 'rules-v2',
        metadata: { mode: 'integration-test' }
    });
    if (!persisted.ok) throw new Error(`Match persistence create failed: ${persisted.error.code}`);

    const created = coordinator.createMatch();
    if (!created.ok) throw new Error(`Coordinator create failed: ${created.error.code}`);
    await saveSnapshot(created.snapshot, 1, 0);
    await log('match.created', 'match.create', 'SUCCESS');
    crashRecovery.push({
        stage: 'created',
        recovery: await persistence.recoverMatch(matchId)
    });

    const requestFor = (principal) => ({
        principal,
        sessionId: principal.sessionId,
        matchId
    });
    const joined1 = await app.joinMatch(requestFor(player1));
    const joined2 = await app.joinMatch(requestFor(player2));
    ensureSuccess(joined1, 'player 1 join');
    ensureSuccess(joined2, 'player 2 join');
    assertRoster(coordinator.getSnapshot().snapshot, [player1.userId, player2.userId]);

    const ready1 = await app.markReady(requestFor(player1));
    ensureSuccess(ready1, 'player 1 ready');
    assert.equal(ready1.snapshot.status, 'WAITING');
    const ready2 = await app.markReady(requestFor(player2));
    ensureSuccess(ready2, 'player 2 ready');
    assert.equal(ready2.snapshot.status, 'READY');
    await persistCoordinatorState(player1, 2);
    crashRecovery.push({
        stage: 'ready',
        recovery: await recoveryBoundary.recoverMatch(player1, matchId)
    });

    const deniedSystemStart = await app.startCountdown({
        principal: player1,
        sessionId: player1.sessionId
    });
    assert.equal(deniedSystemStart.error.code, 'SYSTEM_OPERATION_REQUIRED');
    const countdown = await app.startCountdown({
        authority: await issueSystemCapability('startCountdown')
    });
    ensureSuccess(countdown, 'start countdown');
    assert.equal(countdown.snapshot.status, 'COUNTDOWN');
    await persistCoordinatorState(player1, 3);

    const started = await app.startMatch({
        authority: await issueSystemCapability('startMatch')
    });
    ensureSuccess(started, 'start match');
    assert.equal(started.snapshot.status, 'RUNNING');
    await persistCoordinatorState(player1, 4);
    crashRecovery.push({
        stage: 'running',
        recovery: await recoveryBoundary.recoverMatch(player1, matchId)
    });
    await log('match.started', 'match.start', 'SUCCESS', player1);

    function command(principal, sequence, commandId, overrides = {}) {
        return {
            schemaVersion: root.contracts.SCHEMA_VERSION,
            commandId,
            sessionId: principal.sessionId,
            matchId,
            actorId: principal.userId,
            sequence,
            type: 'MovePlayer',
            payload: { direction: { x: 1, y: 0 } },
            ...overrides
        };
    }

    const firstCommand = command(player1, 1, `${matchId}:p1:1`);
    ensureSuccess(await app.submitGameCommand({
        ...requestFor(player1),
        command: firstCommand
    }), 'first player 1 command');
    const afterFirstCommand = coordinator.getSnapshot().snapshot;
    const duplicate = await app.submitGameCommand({
        ...requestFor(player1),
        command: firstCommand
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error.cause, 'COMMAND_DUPLICATE');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot, afterFirstCommand);

    const actorMismatch = await app.submitGameCommand({
        ...requestFor(player1),
        command: command(player1, 2, `${matchId}:actor-mismatch`, {
            actorId: player2.userId
        })
    });
    assert.equal(actorMismatch.error.code, 'ACTOR_MISMATCH');
    const sessionMismatch = await app.submitGameCommand({
        ...requestFor(player1),
        command: command(player1, 2, `${matchId}:session-mismatch`, {
            sessionId: player2.sessionId
        })
    });
    assert.equal(sessionMismatch.error.code, 'SESSION_MISMATCH');
    const invalidSequence = await app.submitGameCommand({
        ...requestFor(player1),
        command: command(player1, 999, `${matchId}:invalid-sequence`)
    });
    assert.equal(invalidSequence.ok, false);
    assert.equal(invalidSequence.error.cause, 'INVALID_SEQUENCE');
    const forgedPrincipal = { ...player1, userId: player2.userId };
    assert.equal((await app.submitGameCommand({
        principal: forgedPrincipal,
        sessionId: player1.sessionId,
        matchId,
        command: command(player1, 2, `${matchId}:forged-principal`)
    })).error.code, 'AUTHENTICATION_REQUIRED');

    ensureSuccess(await app.submitGameCommand({
        ...requestFor(player1),
        command: command(player1, 2, `${matchId}:p1:2`, {
            payload: { direction: { x: 0, y: 1 } }
        })
    }), 'second player 1 command');
    ensureSuccess(await app.submitGameCommand({
        ...requestFor(player2),
        command: command(player2, 1, `${matchId}:p2:1`, {
            payload: { direction: { x: -1, y: 0 } }
        })
    }), 'first player 2 command');

    const beforeTicks = coordinator.getSnapshot().snapshot;
    controlledClock.advance(100);
    const tickResults = [];
    for (let index = 0; index < 3; index += 1) {
        const tick = coordinator.advanceTick();
        ensureSuccess(tick, `game tick ${index + 1}`);
        tickResults.push(tick);
        if (index === 0) {
            await persistEventsOnly();
            const crash = await recoveryBoundary.recoverMatch(player1, matchId);
            assert.equal(crash.ok, true);
            assert.equal(crash.data.state, 'RECOVERABLE');
            assert.equal(crash.data.replayRequired, true);
            crashRecovery.push({ stage: 'events-persisted', recovery: crash });
            await saveCurrentSnapshot();
        } else {
            await persistCoordinatorState(player1, 5 + index);
        }
        controlledClock.advance(17);
    }

    const finalLiveSnapshot = coordinator.getSnapshot().snapshot;
    assert.notDeepStrictEqual(finalLiveSnapshot.gameState, beforeTicks.gameState);
    assert.equal(finalLiveSnapshot.matchId, matchId);
    assert.equal(finalLiveSnapshot.schemaVersion, root.contracts.SCHEMA_VERSION);
    assert.equal(finalLiveSnapshot.status, 'RUNNING');
    assert.deepStrictEqual([...finalLiveSnapshot.memberActorIds].sort(),
        [player1.userId, player2.userId].sort());
    const liveEvents = (await app.getMatchEvents(requestFor(player1))).events;
    assert.ok(liveEvents.length > 0);
    assertMonotonicEvents(liveEvents, matchId);
    const applicationSnapshot = await app.getMatchSnapshot(requestFor(player1));
    ensureSuccess(applicationSnapshot, 'read live Application snapshot');
    assert.deepStrictEqual(applicationSnapshot.snapshot, finalLiveSnapshot);
    await persistCoordinatorState(player1, 8);

    const finishing = await app.finishMatch({
        authority: await issueSystemCapability('finishMatch'),
        finishReason: 'ABANDONED'
    });
    ensureSuccess(finishing, 'finish match');
    assert.equal(finishing.snapshot.status, 'RESULT_LOCKED');
    await persistEventsOnly();
    const finishingState = await persistence.transitionLifecycle({
        matchId,
        expectedStateVersion: (await persistence.loadMatch(matchId)).match
            .matchPersistence.stateVersion,
        to: 'FINISHING'
    });
    ensureSuccess(finishingState, 'persist FINISHING lifecycle');
    const finishingCrash = await recoveryBoundary.recoverMatch(player1, matchId);
    assert.equal(finishingCrash.ok, false);
    assert.equal(finishingCrash.error.code, 'RECOVERY_INTEGRITY_ERROR');
    crashRecovery.push({ stage: 'finishing', recovery: finishingCrash });

    const resultAccess = await app.lockResult({
        authority: await issueSystemCapability('lockResult')
    });
    ensureSuccess(resultAccess, 'read coordinator MatchResult');
    const matchResult = resultAccess.result;
    assert.equal(matchResult.matchId, matchId);
    assert.equal(matchResult.schemaVersion, root.contracts.SCHEMA_VERSION);
    assert.equal(matchResult.rulesVersion, 'rules-v2');
    assert.ok(matchResult.resultId);
    assert.match(matchResult.resultHash, /^[a-f0-9]{64}$/i);
    if (!validateMatchResult(matchResult).ok) {
        throw new Error('Coordinator returned a MatchResult that violates Contracts v2');
    }

    const finishingAggregate = (await persistence.loadMatch(matchId)).match;
    const priorSnapshotVersion =
        finishingAggregate.matchPersistence.snapshot?.stateVersion || 0;
    const transactionsBeforeFinalization = memory.transactions().length;
    const finalization = await persistence.finalizeResult({
        matchId,
        expectedStateVersion: finishingAggregate.matchPersistence.stateVersion,
        resultVersion: 'result-v1',
        snapshotVersion: priorSnapshotVersion + 1,
        snapshotEventSequence: finishingAggregate.matchPersistence.eventSequence,
        snapshot: finishing.snapshot,
        result: matchResult
    });
    ensureSuccess(finalization, 'atomic result finalization');
    assert.equal(finalization.status, 'RESULT_LOCKED');
    const finalizationTransactions = memory.transactions().slice(transactionsBeforeFinalization);
    assert.equal(finalizationTransactions.length, 1);
    assert.equal(finalizationTransactions[0].updates.length, 1);
    assert.deepStrictEqual(finalizationTransactions[0].updates[0].keys, [
        'matchPersistence',
        'result',
        'resultVersion',
        'status'
    ]);
    await log('match.finished', 'match.finish', 'SUCCESS', player1);
    await log('match.result_locked', 'match.result.lock', 'SUCCESS');

    const finalMetadata = await recoveryBoundary.getMatchMetadata(player1, matchId);
    const finalSnapshot = await recoveryBoundary.getMatchSnapshot(player1, matchId);
    const finalEvents = await recoveryBoundary.getMatchEvents(player1, matchId);
    const finalResult = await recoveryBoundary.getMatchResult(player1, matchId);
    ensureSuccess(finalMetadata, 'read final metadata');
    ensureSuccess(finalSnapshot, 'read final snapshot');
    ensureSuccess(finalEvents, 'read final events');
    ensureSuccess(finalResult, 'read final result');
    assert.equal(finalMetadata.data.lifecycle, 'RESULT_LOCKED');
    assert.equal(finalSnapshot.data.lifecycle, 'RESULT_LOCKED');
    assert.equal(finalSnapshot.data.snapshot.value.status, 'RESULT_LOCKED');
    assert.equal(finalSnapshot.data.snapshot.value.gameState.match.status, 'RESULT_LOCKED');
    assert.equal(finalResult.data.locked, true);
    assert.deepStrictEqual(finalResult.data.result, matchResult);
    assertMonotonicEvents(finalEvents.data.events, matchId);

    const storedBeforeRecovery = await persistence.loadMatch(matchId);
    const recoverySnapshot = clone(finalSnapshot.data.snapshot.value);
    const recoveryEvents = clone(finalEvents.data.events);
    const recoveryResult = clone(finalResult.data.result);
    const recoveryVersions = {
        stateVersion: finalMetadata.data.stateVersion,
        eventSequence: finalMetadata.data.eventSequence,
        resultVersion: finalMetadata.data.resultVersion,
        lifecycle: finalMetadata.data.lifecycle
    };
    const economyBefore = memory.snapshot();
    const liveBeforeRecovery = coordinator.getSnapshot();
    await log('recovery.attempted', 'match.recovery', 'STARTED', player1);
    const recovered = await recoveryBoundary.recoverMatch(player1, matchId);
    ensureSuccess(recovered, 'recover locked match');
    await log('recovery.completed', 'match.recovery', 'SUCCESS', player1);
    assert.equal(recovered.data.state, 'RESULT_LOCKED');
    assert.equal(recovered.data.replayRequired, false);
    assert.deepStrictEqual((await recoveryBoundary.getMatchSnapshot(player1, matchId))
        .data.snapshot.value, recoverySnapshot);
    assert.deepStrictEqual((await recoveryBoundary.getMatchEvents(player1, matchId))
        .data.events, recoveryEvents);
    assert.deepStrictEqual((await recoveryBoundary.getMatchResult(player1, matchId))
        .data.result, recoveryResult);
    assert.deepStrictEqual({
        stateVersion: (await recoveryBoundary.getMatchMetadata(player1, matchId)).data.stateVersion,
        eventSequence: (await recoveryBoundary.getMatchMetadata(player1, matchId)).data.eventSequence,
        resultVersion: (await recoveryBoundary.getMatchMetadata(player1, matchId)).data.resultVersion,
        lifecycle: (await recoveryBoundary.getMatchMetadata(player1, matchId)).data.lifecycle
    }, recoveryVersions);
    assert.deepStrictEqual(coordinator.getSnapshot(), liveBeforeRecovery);
    assert.deepStrictEqual(memory.snapshot(), economyBefore);
    crashRecovery.push({ stage: 'result-locked', recovery: recovered });

    const sameFinalization = await persistence.finalizeResult({
        matchId,
        expectedStateVersion: finishingAggregate.matchPersistence.stateVersion,
        resultVersion: 'result-v1',
        snapshotVersion: priorSnapshotVersion + 1,
        snapshotEventSequence: finishingAggregate.matchPersistence.eventSequence,
        snapshot: finishing.snapshot,
        result: matchResult
    });
    ensureSuccess(sameFinalization, 'idempotent finalization retry');
    assert.equal(sameFinalization.stateVersion, finalization.stateVersion);
    const changedResult = clone(matchResult);
    changedResult.resultId = `${matchId}:replacement`;
    const invalidReplacement = await persistence.finalizeResult({
        matchId,
        expectedStateVersion: finalization.stateVersion,
        resultVersion: 'result-v2',
        snapshotVersion: priorSnapshotVersion + 2,
        snapshotEventSequence: finishingAggregate.matchPersistence.eventSequence,
        snapshot: finishing.snapshot,
        result: changedResult
    });
    assert.equal(invalidReplacement.ok, false);
    assert.ok(['INVALID_RESULT', 'RESULT_HASH_MISMATCH'].includes(
        invalidReplacement.error.code
    ));
    assert.equal((await persistence.finalizeResult({
        matchId,
        expectedStateVersion: finalization.stateVersion,
        resultVersion: 'result-v2',
        snapshotVersion: priorSnapshotVersion + 2,
        snapshotEventSequence: finishingAggregate.matchPersistence.eventSequence,
        snapshot: finishing.snapshot,
        result: matchResult
    })).error.code, 'RESULT_IMMUTABLE');
    const lateCommand = await app.submitGameCommand({
        ...requestFor(player1),
        command: command(player1, 3, `${matchId}:after-lock`)
    });
    assert.equal(lateCommand.ok, false);
    assert.equal(lateCommand.error.code, 'MATCH_RESULT_LOCKED');

    const finalLockedAggregate = memory.getMatch(matchId);
    const settlingFixture = clone(finalLockedAggregate);
    settlingFixture.status = 'SETTLING';
    settlingFixture.matchPersistence.stateVersion += 1;
    settlingFixture.matchPersistence.transitions.push({
        from: 'RESULT_LOCKED',
        to: 'SETTLING',
        version: settlingFixture.matchPersistence.stateVersion,
        timestamp: controlledClock()
    });
    memory.replaceMatchForTest(matchId, settlingFixture);
    const settlingRecovery = await recoveryBoundary.recoverMatch(player1, matchId);
    assert.equal(settlingRecovery.ok, true);
    assert.equal(settlingRecovery.data.state, 'SETTLING');
    crashRecovery.push({ stage: 'settling-fixture', recovery: settlingRecovery });
    const settledFixture = clone(settlingFixture);
    settledFixture.status = 'SETTLED';
    settledFixture.matchPersistence.stateVersion += 1;
    settledFixture.matchPersistence.transitions.push({
        from: 'SETTLING',
        to: 'SETTLED',
        version: settledFixture.matchPersistence.stateVersion,
        timestamp: controlledClock(),
        settlementVersion: 'fixture-settlement-v1'
    });
    memory.replaceMatchForTest(matchId, settledFixture);
    const settledRecovery = await recoveryBoundary.recoverMatch(player1, matchId);
    assert.equal(settledRecovery.ok, true);
    assert.equal(settledRecovery.data.state, 'SETTLED');
    crashRecovery.push({ stage: 'settled-fixture', recovery: settledRecovery });
    memory.replaceMatchForTest(matchId, finalLockedAggregate);

    const abortMatchId = `${matchId}-abort`;
    const abortCreated = await persistence.createMatch({
        matchId: abortMatchId,
        rulesVersion: 'rules-v2',
        metadata: { mode: 'crash-fixture' }
    });
    ensureSuccess(abortCreated, 'create abort recovery fixture');
    let abortVersion = abortCreated.match.matchPersistence.stateVersion;
    for (const to of ['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING']) {
        const transition = await persistence.transitionLifecycle({
            matchId: abortMatchId,
            expectedStateVersion: abortVersion,
            to
        });
        ensureSuccess(transition, `advance abort fixture to ${to}`);
        abortVersion = transition.stateVersion;
    }
    const abortRequired = await persistence.recoverMatch(abortMatchId);
    assert.equal(abortRequired.ok, true);
    assert.equal(abortRequired.state, 'ABORT_REQUIRED');
    crashRecovery.push({ stage: 'abort-required-fixture', recovery: abortRequired });

    const inconsistent = memory.getMatch(matchId);
    inconsistent.matchPersistence.snapshot.value.status = 'RUNNING';
    inconsistent.matchPersistence.snapshot.value.gameState.match.status = 'RUNNING';
    memory.replaceMatchForTest(matchId, inconsistent);
    const inconsistentBefore = memory.getMatch(matchId);
    const inconsistentRecovery = await recoveryBoundary.recoverMatch(player1, matchId);
    assert.equal(inconsistentRecovery.ok, false);
    assert.equal(inconsistentRecovery.error.code, 'RECOVERY_INTEGRITY_ERROR');
    assert.deepStrictEqual(memory.getMatch(matchId), inconsistentBefore);

    const financialSnapshot = memory.snapshot();
    assert.equal(financialSnapshot.counters.walletMutations, 0);
    assert.equal(financialSnapshot.counters.ledgerMutations, 0);
    assert.equal(financialSnapshot.counters.settlementMutations, 0);
    assert.equal(financialSnapshot.counters.outboxMutations, 0);
    assert.deepStrictEqual(financialSnapshot.wallets, []);
    assert.deepStrictEqual(financialSnapshot.ledger, []);
    assert.deepStrictEqual(financialSnapshot.settlements, []);
    assert.deepStrictEqual(financialSnapshot.outbox, []);

    const requiredObservations = [
        'match.created',
        'match.started',
        'match.finished',
        'match.result_locked',
        'recovery.attempted',
        'recovery.completed'
    ];
    for (const eventType of requiredObservations) {
        assert.ok(context.emitted.some((event) => event.eventType === eventType), eventType);
    }
    for (const event of context.emitted) {
        assert.equal(event.correlationId, context.correlation.correlationId);
        assert.equal(event.matchId, matchId);
        assert.equal(event.schemaVersion, 1);
        assert.ok(event.eventId && event.category && event.timestamp &&
            event.operation && event.outcome && event.metadata);
    }
    assert.doesNotMatch(JSON.stringify(context.emitted),
        /password|token|secret|credential|privateKey|serviceAccount|authorization|cookie/i);

    const finalStored = (await persistence.loadMatch(matchId)).match;
    const finalPersistedEvents = await persistence.loadEvents(matchId);

    async function persistCoordinatorState(principal, snapshotVersion) {
        const current = coordinator.getSnapshot();
        ensureSuccess(current, 'coordinator snapshot');
        const persistedMatch = (await persistence.loadMatch(matchId)).match;
        if (persistedMatch.status !== current.snapshot.status) {
            const transition = await persistence.transitionLifecycle({
                matchId,
                expectedStateVersion: persistedMatch.matchPersistence.stateVersion,
                to: current.snapshot.status
            });
            ensureSuccess(transition, 'persist lifecycle');
        }
        await persistEventsOnly(principal);
        await saveCurrentSnapshot(snapshotVersion);
    }

    async function persistEventsOnly(principal = player1) {
        const current = await persistence.loadMatch(matchId);
        ensureSuccess(current, 'load before event append');
        const coordinatorEvents = coordinator.getEvents();
        ensureSuccess(coordinatorEvents, 'load coordinator events');
        const additions = coordinatorEvents.events.filter((event) =>
            event.sequence > current.match.matchPersistence.eventSequence);
        if (additions.length === 0) return current.match.matchPersistence.stateVersion;
        const appended = await persistence.appendEvents({
            matchId,
            expectedStateVersion: current.match.matchPersistence.stateVersion,
            events: additions.map((event) => ({
                eventId: event.eventId,
                matchId: event.matchId,
                sequence: event.sequence,
                type: event.type,
                payload: clone(event.payload),
                ...(event.actorId === undefined ? {} : { actorId: event.actorId })
            }))
        });
        ensureSuccess(appended, 'persist coordinator events');
        if (principal) {
            const authorizedEvents = await app.getMatchEvents({
                principal,
                sessionId: principal.sessionId,
                matchId
            });
            ensureSuccess(authorizedEvents, 'read application events');
            assert.equal(authorizedEvents.events.length, coordinatorEvents.events.length);
        }
        return appended.stateVersion;
    }

    async function saveCurrentSnapshot(snapshotVersion) {
        const current = coordinator.getSnapshot();
        ensureSuccess(current, 'snapshot for persistence');
        const aggregate = (await persistence.loadMatch(matchId)).match;
        const nextSnapshotVersion = snapshotVersion === undefined
            ? (aggregate.matchPersistence.snapshot?.stateVersion || 0) + 1
            : Math.max(snapshotVersion, (aggregate.matchPersistence.snapshot?.stateVersion || 0) + 1);
        const saved = await persistence.saveSnapshot({
            matchId,
            expectedStateVersion: aggregate.matchPersistence.stateVersion,
            snapshotVersion: nextSnapshotVersion,
            snapshotEventSequence: aggregate.matchPersistence.eventSequence,
            snapshot: current.snapshot
        });
        ensureSuccess(saved, 'persist coordinator snapshot');
        return saved;
    }

    async function saveSnapshot(snapshot, snapshotVersion, eventSequence) {
        const saved = await persistence.saveSnapshot({
            matchId,
            expectedStateVersion: persisted.match.matchPersistence.stateVersion,
            snapshotVersion,
            snapshotEventSequence: eventSequence,
            snapshot
        });
        ensureSuccess(saved, 'persist initial snapshot');
        return saved;
    }

    function ensureSuccess(response, operation) {
        if (!response?.ok) {
            throw new Error(`${operation} failed: ${response?.error?.code || 'INVALID_RESPONSE'}`);
        }
        return response;
    }

    function assertRoster(snapshot, expected) {
        assert.equal(snapshot.memberActorIds.length, 2);
        assert.deepStrictEqual([...snapshot.memberActorIds].sort(), [...expected].sort());
    }

    return {
        matchId,
        lifecycle: finalStored.status,
        snapshot: recoverySnapshot,
        events: finalPersistedEvents.events,
        result: finalStored.result,
        stateVersion: finalStored.matchPersistence.stateVersion,
        eventSequence: finalStored.matchPersistence.eventSequence,
        resultVersion: finalStored.resultVersion,
        recovery: recovered.data,
        crashRecovery: crashRecovery.map(({ stage, recovery }) => ({
            stage,
            ok: recovery.ok,
            state: recovery.data?.state || recovery.state || null,
            error: recovery.error?.code || null,
            replayRequired: recovery.data?.replayRequired ?? recovery.replayRequired ?? false
        })),
        playerIds: [player1.userId, player2.userId],
        sessions: [player1.sessionId, player2.sessionId],
        tickCount: tickResults.length,
        observability: clone(context.emitted),
        atomicSnapshot: clone(finalization.snapshot),
        atomicWrite: finalizationTransactions.length === 1 &&
            finalizationTransactions[0].updates.length === 1,
        integrityDiagnostic: inconsistentRecovery.error.code,
        unchangedAggregateBeforeFinalRecovery: storedBeforeRecovery.ok
    };
}

function assertMonotonicEvents(events, matchId) {
    let previous = 0;
    for (const event of events) {
        assert.ok(event.eventId);
        assert.equal(event.matchId, matchId);
        assert.ok(event.sequence > previous);
        assert.ok(event.timestamp >= 0);
        assert.ok(event.type);
        assert.equal(event.schemaVersion, 1);
        previous = event.sequence;
    }
}

module.exports = Object.freeze({
    createControlledClock,
    createInMemoryPersistence,
    createRuntimeHarness
});
