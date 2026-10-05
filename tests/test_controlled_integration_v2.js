'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    CONTROLLED_INTEGRATION_ERRORS,
    SYSTEM_OPERATIONS,
    createControlledIdentity,
    createControlledEnvironment
} = require('../packages/controlled-integration/v2');

const DEFAULT_POLICY = {
    enabled: true,
    rolloutPercentage: 0,
    allowlist: [],
    denylist: [],
    testUsers: [],
    testMatches: [],
    killSwitch: false,
    policyVersion: 'controlled-routing-v1'
};

function controlledFlowOperations() {
    return [
        'controlled.integration.started',
        'controlled.integration.assignment',
        'controlled.integration.adapter-started',
        'controlled.integration.match-start',
        'controlled.integration.match-finish',
        'controlled.integration.result-lock',
        'controlled.integration.recovery',
        'controlled.integration.completed'
    ];
}

function session(principal, matchId) {
    return {
        principal,
        sessionId: principal.sessionId,
        actorId: principal.userId,
        matchId
    };
}

function recoveredCommand(principal, matchId, commandId) {
    return {
        schemaVersion: 1,
        commandId,
        sessionId: principal.sessionId,
        matchId,
        actorId: principal.userId,
        sequence: 1,
        type: 'MovePlayer',
        payload: { direction: { x: 1, y: 0 } }
    };
}

async function testExports() {
    assert.deepStrictEqual([...SYSTEM_OPERATIONS],
        ['startCountdown', 'startMatch', 'finishMatch', 'lockResult']);
    assert.strictEqual(CONTROLLED_INTEGRATION_ERRORS.AUTHORITY_FAILURE, 'AUTHORITY_FAILURE');
    assert.strictEqual(CONTROLLED_INTEGRATION_ERRORS.PERSISTENCE_FAILURE, 'PERSISTENCE_FAILURE');
    assert.deepStrictEqual(Object.keys(CONTROLLED_INTEGRATION_ERRORS).sort(), [
        'ADAPTER_FAILURE',
        'APPLICATION_FAILURE',
        'AUTHORITY_FAILURE',
        'AUTHORITY_MISMATCH',
        'IDENTITY_FAILURE',
        'INVALID_REQUEST',
        'OBSERVABILITY_FAILURE',
        'PERSISTENCE_FAILURE',
        'RECOVERY_FAILURE'
    ]);

    const clock = () => 1700000000000;
    const kit = createControlledIdentity(clock);
    const good = await kit.adapter.authenticate('controlled-player-1');
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.userId, 'controlled-player-1');
    assert.strictEqual((await kit.adapter.authenticate('nope')).ok, false);
    assert.strictEqual((await kit.adapter.verifySystemOperation(
        'controlled-system-credential', 'startMatch')).ok, true);
    assert.strictEqual((await kit.adapter.verifySystemOperation(
        'wrong', 'startMatch')).ok, false);
    assert.strictEqual((await kit.adapter.verifySystemOperation(
        'controlled-system-credential', 'deploy')).ok, false);
    assert.ok((await kit.adapter.resolveAuthorization()).permissions.length > 0);
    assert.strictEqual(await kit.adapter.validateSession(), true);
}

async function testFullFlow() {
    const env = createControlledEnvironment({ matchId: 'controlled-full-flow' });
    const result = await env.runControlledMatchFlow();
    assert.strictEqual(result.ok, true, JSON.stringify(result.error || null));
    assert.strictEqual(result.matchId, 'controlled-full-flow');
    assert.strictEqual(result.stored.status, 'RESULT_LOCKED');
    assert.strictEqual(result.recovery.state, 'RESULT_LOCKED');
    assert.strictEqual(result.assignment.runtime, 'V2');
    assert.strictEqual(result.authority.assignmentId, result.assignment.assignmentId);
    assert.strictEqual(result.resultVersion, 'result-v1');
    assert.strictEqual(result.tickCount, 3);
    assert.strictEqual(result.bootstrapCount, 1);
    assert.deepStrictEqual([...result.principals].sort(),
        ['controlled-player-1', 'controlled-player-2']);
    assert.ok(result.stored.matchPersistence.stateVersion > 1);
    assert.ok(result.stored.matchPersistence.eventSequence >= 4);
    assert.deepStrictEqual([...result.snapshot.memberActorIds].sort(),
        ['controlled-player-1', 'controlled-player-2']);
    assert.strictEqual(result.snapshot.status, 'RUNNING');
    assert.ok(result.events.length >= 4);
    assert.ok(result.result && result.result.matchId === 'controlled-full-flow');
    assert.strictEqual(env.getBootstrapCount(), 1);
    assert.strictEqual(env.adapter.getInstance('controlled-full-flow').status, 'ACTIVE');

    const operations = result.emitted
        .filter((event) => event.eventType === 'controlled.integration')
        .map((event) => event.operation);
    for (const expected of controlledFlowOperations()) {
        assert.ok(operations.includes(expected), `missing observability stage: ${expected}`);
    }
    const allOperations = new Set(result.emitted.map((event) => event.operation));
    for (const expected of [
        'runtime.assignment.created',
        'runtime.adapter.start.accepted'
    ]) {
        assert.ok(allOperations.has(expected), `missing layer observability event: ${expected}`);
    }
    for (const event of result.emitted) {
        if (event.eventType === 'controlled.integration') {
            assert.strictEqual(event.correlationId, env.correlationId);
            assert.strictEqual(event.matchId, 'controlled-full-flow');
        }
    }
    const emittedJson = JSON.stringify(result.emitted);
    assert.doesNotMatch(emittedJson,
        /password|token|secret|credential|privateKey|serviceAccount|authorization|cookie/i);
}

async function testAssignmentPrecedesBootstrap() {
    const matchId = 'controlled-authority-order';
    const env = createControlledEnvironment({ matchId });
    assert.strictEqual(env.root.matchCoordinator.getSnapshot().ok, false);
    assert.strictEqual(env.getBootstrapCount(), 0);

    const seeded = await env.root.matchPersistence.createMatch({
        matchId,
        rulesVersion: 'v2'
    });
    assert.strictEqual(seeded.ok, true);
    const resolved = await env.resolveControlledAssignment();
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(resolved.assignment.runtime, 'V2');
    assert.strictEqual(env.getBootstrapCount(), 0);
    assert.strictEqual(env.root.matchCoordinator.getSnapshot().ok, false);

    const started = await env.startControlledInstance(resolved.assignment);
    assert.strictEqual(started.ok, true);
    assert.strictEqual(env.getBootstrapCount(), 1);
    assert.strictEqual(env.root.matchCoordinator.getSnapshot().ok, true);
    const persisted = await env.root.matchPersistence.loadSnapshot(matchId);
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.snapshot.value.matchId, matchId);
}

async function testConcurrency() {
    const [first, second] = await Promise.all([
        createControlledEnvironment({ matchId: 'controlled-concurrent-a' })
            .runControlledMatchFlow(),
        createControlledEnvironment({ matchId: 'controlled-concurrent-b' })
            .runControlledMatchFlow()
    ]);
    assert.strictEqual(first.ok, true, JSON.stringify(first.error || null));
    assert.strictEqual(second.ok, true, JSON.stringify(second.error || null));

    const env = createControlledEnvironment({ matchId: 'controlled-idem' });
    const seeded = await env.root.matchPersistence.createMatch({
        matchId: 'controlled-idem',
        rulesVersion: 'v2'
    });
    assert.strictEqual(seeded.ok, true);
    const [one, two] = await Promise.all([
        env.resolveControlledAssignment(),
        env.resolveControlledAssignment()
    ]);
    assert.strictEqual(one.ok, true);
    assert.strictEqual(two.ok, true);
    assert.strictEqual(one.assignment.assignmentId, two.assignment.assignmentId);
    assert.deepStrictEqual(one.assignment, two.assignment);

    const startMatchId = 'controlled-concurrent-start';
    const startEnv = createControlledEnvironment({ matchId: startMatchId });
    assert.strictEqual((await startEnv.root.matchPersistence.createMatch({
        matchId: startMatchId,
        rulesVersion: 'v2'
    })).ok, true);
    const startAssignment = await startEnv.resolveControlledAssignment();
    assert.strictEqual(startAssignment.assignment.runtime, 'V2');
    const [startA, startB] = await Promise.all([
        startEnv.startControlledInstance(startAssignment.assignment),
        startEnv.startControlledInstance(startAssignment.assignment)
    ]);
    assert.strictEqual(startA.ok, true);
    assert.strictEqual(startB.ok, true);
    assert.strictEqual(startA.instance, startB.instance);
    assert.strictEqual(startEnv.getBootstrapCount(), 1);
    assert.strictEqual(startEnv.adapter.getInstance(startMatchId), startA.instance);
    const startAuthority = await startEnv.integrationBoundary.getRuntimeAssignment(startMatchId);
    assert.deepStrictEqual(startAuthority.data.assignment, startAssignment.assignment);
}

async function testClosedRejection() {
    const env = createControlledEnvironment({ matchId: 'controlled-closed' });
    const flow = await env.runControlledMatchFlow();
    assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
    const closed = await env.adapter.closeInstance('controlled-closed');
    assert.strictEqual(closed.ok, true);
    assert.strictEqual(closed.instance.status, 'CLOSED');
    const restarted = await env.adapter.startAssignedMatch(flow.assignment, {
        correlationId: env.correlationId
    });
    assert.strictEqual(restarted.ok, false);
    assert.strictEqual(restarted.error.code, 'CLOSED_INSTANCE');
    assert.strictEqual(env.adapter.getInstance('controlled-closed').status, 'CLOSED');
    assert.strictEqual(env.getBootstrapCount(), 1);
    const authority = await env.adapter.getRuntimeAssignment('controlled-closed',
        env.correlationId);
    assert.strictEqual(authority.ok, true);
    assert.strictEqual(authority.data.assignment.assignmentId, flow.assignment.assignmentId);
}

async function testRecovery() {
    // Mid-flow: recovery reads the persisted authoritative snapshot.
    const matchId = 'controlled-recovery-mid';
    const env = createControlledEnvironment({ matchId });
    const created = await env.root.matchPersistence.createMatch({ matchId, rulesVersion: 'v2' });
    assert.strictEqual(created.ok, true);
    assert.strictEqual(env.root.matchCoordinator.createMatch().ok, true);
    const player1 = await env.authenticatePlayer('controlled-player-1');
    const player2 = await env.authenticatePlayer('controlled-player-2');
    assert.strictEqual(player1.ok, true);
    assert.strictEqual(player2.ok, true);
    assert.strictEqual((await env.root.application.joinMatch(
        session(player1.principal, matchId))).ok, true);
    assert.strictEqual((await env.root.application.joinMatch(
        session(player2.principal, matchId))).ok, true);
    assert.strictEqual((await env.root.application.markReady(
        session(player1.principal, matchId))).ok, true);
    assert.strictEqual((await env.root.application.markReady(
        session(player2.principal, matchId))).ok, true);
    const snapshot = env.root.matchCoordinator.getSnapshot();
    assert.strictEqual(snapshot.ok, true);
    const loaded = (await env.root.matchPersistence.loadMatch(matchId)).match;
    const transitioned = await env.root.matchPersistence.transitionLifecycle({
        matchId,
        expectedStateVersion: loaded.matchPersistence.stateVersion,
        to: snapshot.snapshot.status
    });
    assert.strictEqual(transitioned.ok, true, JSON.stringify(transitioned.error || null));
    const reloaded = (await env.root.matchPersistence.loadMatch(matchId)).match;
    const saved = await env.root.matchPersistence.saveSnapshot({
        matchId,
        expectedStateVersion: reloaded.matchPersistence.stateVersion,
        snapshotVersion: 1,
        snapshotEventSequence: reloaded.matchPersistence.eventSequence,
        snapshot: snapshot.snapshot
    });
    assert.strictEqual(saved.ok, true, JSON.stringify(saved.error || null));
    const mid = await env.root.applicationRecovery.recoverMatch(player1.principal, matchId);
    assert.strictEqual(mid.ok, true, JSON.stringify(mid.error || null));
    assert.strictEqual(mid.data.state, 'RECOVERABLE');
    assert.strictEqual(mid.data.actionRequired, 'CONTINUE_FROM_PERSISTED_SNAPSHOT');
    assert.strictEqual(mid.data.replayRequired, false);
    const missing = await env.root.applicationRecovery.recoverMatch(
        player1.principal, 'never-seeded');
    assert.strictEqual(missing.ok, true);
    assert.strictEqual(missing.data.state, 'NOT_FOUND');

    // End-of-flow: recovery reports the locked result.
    const flowEnv = createControlledEnvironment({ matchId: 'controlled-recovery-end' });
    const flow = await flowEnv.runControlledMatchFlow();
    assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
    assert.strictEqual(flow.recovery.state, 'RESULT_LOCKED');
}

async function testRunningSessionReassociationAfterRestart() {
    const matchId = 'controlled-running-session-recovery';
    const env = createControlledEnvironment({ matchId });
    const flow = await env.runControlledMatchFlow({ stopAtRunning: true });
    assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
    assert.strictEqual(flow.stored.status, 'RUNNING');
    assert.strictEqual(flow.stored.matchPersistence.snapshot.value.status, 'RUNNING');
    assert.doesNotMatch(JSON.stringify(flow.stored), /sessionId/i);

    const recoveryEnv = createControlledEnvironment({
        matchId,
        persistence: env.persistence,
        clock: env.clock
    });
    assert.strictEqual(recoveryEnv.adapter.getInstance(matchId), null);
    assert.strictEqual(recoveryEnv.root.matchCoordinator.getSnapshot().ok, false);
    const readPrincipal = (await recoveryEnv.authenticatePlayer('controlled-player-1')).principal;
    const previousSessionPrincipal = (await recoveryEnv.authenticatePlayer('controlled-player-2')).principal;
    const restarted = await recoveryEnv.restartFromPersistedState(readPrincipal);
    assert.strictEqual(restarted.ok, true, JSON.stringify(restarted.error || null));
    assert.strictEqual(restarted.adapter.getInstance(matchId).runtime, 'V2');
    assert.strictEqual(restarted.bootstrapCount, 1);
    assert.strictEqual(restarted.recoveryAttempts.length, 2);
    assert.strictEqual(restarted.recoveryAttempts[0].ok, true);
    assert.strictEqual(restarted.recoveryAttempts[1].ok, true);
    assert.strictEqual(restarted.recoveryAttempts[0].instance,
        restarted.recoveryAttempts[1].instance);
    const recoveredRoot = restarted.root;
    const recoveredSnapshot = recoveredRoot.matchCoordinator.getSnapshot().snapshot;
    assert.strictEqual(recoveredSnapshot.matchId, flow.matchId);
    assert.strictEqual(recoveredSnapshot.status, 'RUNNING');
    assert.deepStrictEqual(recoveredSnapshot, flow.snapshot);
    assert.deepStrictEqual(flow.stored.matchPersistence.snapshot.value, flow.snapshot);
    assert.deepStrictEqual(recoveredSnapshot.members, flow.snapshot.members);
    assert.strictEqual(restarted.recoveryState.stateVersion,
        flow.stored.matchPersistence.stateVersion);
    assert.strictEqual(restarted.recoveryState.eventSequence,
        flow.stored.matchPersistence.eventSequence);
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getEvents().events,
        flow.stored.matchPersistence.events);
    assert.deepStrictEqual(restarted.authority, flow.authority);
    assert.strictEqual(restarted.authority.assignmentId, flow.assignment.assignmentId);
    assert.strictEqual(recoveryEnv.getBootstrapCount(), 0);
    assert.strictEqual(env.getBootstrapCount(), 1);

    const beforeReassociation = recoveredRoot.matchCoordinator.getSnapshot().snapshot;
    const beforeEvents = recoveredRoot.matchCoordinator.getEvents().events;
    const player1 = (await recoveredRoot.identity.authenticate({
        credential: 'controlled-player-1'
    })).principal;
    const player2 = (await recoveredRoot.identity.authenticate({
        credential: 'controlled-player-2'
    })).principal;
    const rebound1 = await restarted.reassociatePlayerSession(player1);
    const rebound2 = await restarted.reassociatePlayerSession(player2);
    assert.strictEqual(rebound1.ok, true, JSON.stringify(rebound1.error || null));
    assert.strictEqual(rebound2.ok, true, JSON.stringify(rebound2.error || null));
    assert.deepStrictEqual(rebound2.snapshot.members, beforeReassociation.members);
    assert.strictEqual(rebound2.snapshot.status, beforeReassociation.status);
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getEvents().events, beforeEvents);

    const oldPrincipal = readPrincipal;
    const oldSessionAttempt = await recoveredRoot.application.submitGameCommand({
        ...session(oldPrincipal, matchId),
        command: {
            ...recoveredCommand(oldPrincipal, matchId, 'old-session-after-recovery'),
            sequence: 4
        }
    });
    assert.strictEqual(oldSessionAttempt.ok, false);
    assert.strictEqual(oldSessionAttempt.error.code, 'SESSION_MISMATCH');
    const oldPlayer2Attempt = await recoveredRoot.application.submitGameCommand({
        ...session(previousSessionPrincipal, matchId),
        command: recoveredCommand(previousSessionPrincipal, matchId, 'old-player-2-session')
    });
    assert.strictEqual(oldPlayer2Attempt.ok, false);
    assert.strictEqual(oldPlayer2Attempt.error.code, 'SESSION_MISMATCH');
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getSnapshot().snapshot,
        beforeReassociation);
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getEvents().events, beforeEvents);

    const concurrentA = (await recoveredRoot.identity.authenticate({
        credential: 'controlled-player-1'
    })).principal;
    const concurrentB = (await recoveredRoot.identity.authenticate({
        credential: 'controlled-player-1'
    })).principal;
    const concurrentRebindings = await Promise.all([
        restarted.reassociatePlayerSession(concurrentA),
        restarted.reassociatePlayerSession(concurrentB)
    ]);
    assert.strictEqual(concurrentRebindings.every((response) => response.ok), true);
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getSnapshot().snapshot.members,
        beforeReassociation.members);
    assert.deepStrictEqual(recoveredRoot.matchCoordinator.getEvents().events, beforeEvents);

    const commandA = await recoveredRoot.application.submitGameCommand({
        ...session(concurrentA, matchId),
        command: recoveredCommand(concurrentA, matchId, 'concurrent-recovery-a')
    });
    const commandB = await recoveredRoot.application.submitGameCommand({
        ...session(concurrentB, matchId),
        command: recoveredCommand(concurrentB, matchId, 'concurrent-recovery-b')
    });
    assert.strictEqual(Number(commandA.ok) + Number(commandB.ok), 1);
    assert.strictEqual(
        [commandA, commandB].find((response) => !response.ok).error.code,
        'SESSION_MISMATCH'
    );
    const cursorBeforeTick = beforeReassociation.gameState.sequence;
    assert.strictEqual(cursorBeforeTick, restarted.recoveryState.eventSequence);
    const tick = recoveredRoot.matchCoordinator.advanceTick();
    assert.strictEqual(tick.ok, true, JSON.stringify(tick.error || null));
    assert.ok(tick.events.length > 0);
    tick.events.forEach((event, index) => {
        assert.strictEqual(event.sequence, cursorBeforeTick + index + 1);
    });
    assert.ok(tick.snapshot.gameState.sequence > cursorBeforeTick);
    assert.notDeepStrictEqual(tick.snapshot.gameState, beforeReassociation.gameState);
    const recoveredEvents = recoveredRoot.matchCoordinator.getEvents().events;
    assert.strictEqual(new Set(recoveredEvents.map((event) => event.eventId)).size,
        recoveredEvents.length);
    assert.deepStrictEqual(recoveredEvents.slice(0, beforeEvents.length), beforeEvents);

    const persistedAfter = await env.root.matchPersistence.loadMatch(matchId);
    assert.strictEqual(persistedAfter.match.matchPersistence.stateVersion,
        flow.stored.matchPersistence.stateVersion);
    assert.strictEqual(persistedAfter.match.matchPersistence.eventSequence,
        flow.stored.matchPersistence.eventSequence);
    assert.doesNotMatch(JSON.stringify(persistedAfter.match), /sessionId/i);
    const authorityAfter = await recoveryEnv.integrationBoundary.getRuntimeAssignment(matchId);
    assert.deepStrictEqual(authorityAfter.data.assignment, flow.authority);
    const recoveryObservations = recoveryEnv.emitted.filter((event) =>
        event.operation === 'controlled.integration.restart-recovery' ||
        event.operation === 'controlled.integration.session-reassociated');
    assert.ok(recoveryObservations.some((event) =>
        event.operation === 'controlled.integration.restart-recovery'));
    assert.ok(recoveryObservations.some((event) =>
        event.operation === 'controlled.integration.session-reassociated'));
    assert.ok(recoveryObservations.every((event) => event.correlationId === env.correlationId));
    assert.doesNotMatch(JSON.stringify(recoveryObservations),
        /password|token|secret|credential|privateKey|authorization|cookie|sessionId/i);
}

async function testTerminalSessionReassociation() {
    const matchId = 'controlled-terminal-session-recovery';
    const env = createControlledEnvironment({ matchId });
    const flow = await env.runControlledMatchFlow();
    assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
    const initialAggregate = await env.root.matchPersistence.loadMatch(matchId);
    const initialEvents = initialAggregate.match.matchPersistence.events;
    const initialResult = initialAggregate.match.result;
    assert.strictEqual(initialAggregate.match.status, 'RESULT_LOCKED');
    assert.doesNotMatch(JSON.stringify(initialAggregate.match), /sessionId/i);

    const recoveryEnv = createControlledEnvironment({
        matchId,
        persistence: env.persistence,
        clock: env.clock
    });
    assert.strictEqual(recoveryEnv.adapter.getInstance(matchId), null);
    assert.strictEqual(recoveryEnv.root.matchCoordinator.getSnapshot().ok, false);
    const recoveryPrincipal = (await recoveryEnv.authenticatePlayer('controlled-player-1')).principal;
    const restarted = await recoveryEnv.restartFromPersistedState(recoveryPrincipal);
    assert.strictEqual(restarted.ok, true, JSON.stringify(restarted.error || null));
    assert.strictEqual(restarted.bootstrapCount, 1);
    assert.strictEqual(restarted.recoveryState.lifecycle, 'RESULT_LOCKED');
    assert.strictEqual(restarted.recoveryState.stateVersion,
        initialAggregate.match.matchPersistence.stateVersion);
    assert.strictEqual(restarted.recoveryState.eventSequence,
        initialAggregate.match.matchPersistence.eventSequence);
    assert.strictEqual(restarted.recoveryState.resultVersion,
        initialAggregate.match.resultVersion);
    assert.strictEqual(restarted.recoveryState.result.resultId, initialResult.resultId);
    assert.strictEqual(restarted.recoveryState.result.resultHash, initialResult.resultHash);
    assert.deepStrictEqual(restarted.recoveryState.result, initialResult);
    assert.deepStrictEqual(restarted.authority, flow.authority);
    const lockedRoot = restarted.root;
    const lockedSnapshotBefore = lockedRoot.matchCoordinator.getSnapshot().snapshot;
    assert.strictEqual(lockedSnapshotBefore.status, 'RESULT_LOCKED');
    assert.strictEqual(lockedSnapshotBefore.matchId, matchId);
    assert.deepStrictEqual(lockedRoot.matchCoordinator.getResult().result, initialResult);

    const reboundPrincipal = (await lockedRoot.identity.authenticate({
        credential: 'controlled-player-1'
    })).principal;
    const reassociated = await restarted.reassociatePlayerSession(reboundPrincipal);
    assert.strictEqual(reassociated.ok, true);
    assert.strictEqual(reassociated.snapshot.status, 'RESULT_LOCKED');
    assert.deepStrictEqual(reassociated.snapshot.members, lockedSnapshotBefore.members);
    assert.deepStrictEqual(reassociated.snapshot.readyActorIds, lockedSnapshotBefore.readyActorIds);
    assert.deepStrictEqual(reassociated.snapshot.gameState, lockedSnapshotBefore.gameState);
    assert.deepStrictEqual(lockedRoot.matchCoordinator.getEvents().events, initialEvents);
    const lockedCommand = await lockedRoot.application.submitGameCommand({
        ...session(reboundPrincipal, matchId),
        command: recoveredCommand(reboundPrincipal, matchId, 'locked-command')
    });
    assert.strictEqual(lockedCommand.ok, false);
    assert.strictEqual(lockedCommand.error.code, 'MATCH_RESULT_LOCKED');
    const finishAuthority = await lockedRoot.identity.authorizeSystemOperation(
        'controlled-system-credential', 'finishMatch'
    );
    const secondFinish = await lockedRoot.application.finishMatch({
        authority: finishAuthority.capability,
        finishReason: 'ABANDONED'
    });
    assert.strictEqual(secondFinish.ok, false);
    assert.strictEqual(secondFinish.error.code, 'MATCH_RESULT_LOCKED');
    assert.deepStrictEqual(lockedRoot.matchCoordinator.getResult().result, initialResult);
    assert.strictEqual(lockedRoot.matchCoordinator.getSnapshot().snapshot.status,
        'RESULT_LOCKED');
    assert.deepStrictEqual(await env.root.matchPersistence.loadMatch(matchId), initialAggregate);
    const allObservations = [...env.emitted, ...recoveryEnv.emitted];
    const observableOperations = new Set(allObservations.map((event) => event.operation));
    for (const expected of [
        'runtime.assignment.created',
        'runtime.adapter.start.accepted',
        'runtime.adapter.recovery',
        'controlled.integration.match-start',
        'controlled.integration.match-finish',
        'controlled.integration.result-lock',
        'controlled.integration.recovery',
        'controlled.integration.restart-recovery',
        'controlled.integration.session-reassociated',
        'controlled.integration.completed'
    ]) {
        assert.ok(observableOperations.has(expected), `missing observability event: ${expected}`);
    }
    assert.ok(allObservations.every((event) => event.correlationId === env.correlationId));
    assert.ok(allObservations.every((event) => event.matchId === matchId));
    for (const observations of [env.emitted, recoveryEnv.emitted]) {
        assert.strictEqual(new Set(observations.map((event) => event.eventId)).size,
            observations.length);
    }
    assert.doesNotMatch(JSON.stringify(allObservations),
        /password|token|secret|credential|privateKey|authorization|cookie|sessionId/i);

    let current = await env.root.matchPersistence.loadMatch(matchId);
    const settlingTransition = await env.root.matchPersistence.transitionLifecycle({
        matchId,
        expectedStateVersion: current.match.matchPersistence.stateVersion,
        to: 'SETTLING'
    });
    assert.strictEqual(settlingTransition.ok, true);
    const settlingEnv = createControlledEnvironment({
        matchId,
        persistence: env.persistence,
        clock: env.clock
    });
    const settlingPrincipal = (await settlingEnv.authenticatePlayer('controlled-player-1')).principal;
    const settlingRestart = await settlingEnv.restartFromPersistedState(settlingPrincipal);
    assert.strictEqual(settlingRestart.ok, true, JSON.stringify(settlingRestart.error || null));
    assert.strictEqual(settlingRestart.root.matchCoordinator.getSnapshot().snapshot.status,
        'SETTLING');
    const settlingBefore = await env.root.matchPersistence.loadMatch(matchId);
    const settlingEvents = settlingRestart.root.matchCoordinator.getEvents().events;
    const settlingRebound = (await settlingRestart.root.identity.authenticate({
        credential: 'controlled-player-2'
    })).principal;
    assert.strictEqual((await settlingRestart.reassociatePlayerSession(settlingRebound)).ok, true);
    assert.deepStrictEqual(settlingRestart.root.matchCoordinator.getEvents().events, settlingEvents);
    assert.deepStrictEqual(await env.root.matchPersistence.loadMatch(matchId), settlingBefore);

    current = await env.root.matchPersistence.loadMatch(matchId);
    const settledTransition = await env.root.matchPersistence.transitionLifecycle({
        matchId,
        expectedStateVersion: current.match.matchPersistence.stateVersion,
        to: 'SETTLED',
        settlementVersion: 'controlled-settlement-fixture'
    });
    assert.strictEqual(settledTransition.ok, true);
    const settledEnv = createControlledEnvironment({
        matchId,
        persistence: env.persistence,
        clock: env.clock
    });
    const settledPrincipal = (await settledEnv.authenticatePlayer('controlled-player-1')).principal;
    const settledRestart = await settledEnv.restartFromPersistedState(settledPrincipal);
    assert.strictEqual(settledRestart.ok, true, JSON.stringify(settledRestart.error || null));
    assert.strictEqual(settledRestart.root.matchCoordinator.getSnapshot().snapshot.status,
        'SETTLED');
    const settledBefore = await env.root.matchPersistence.loadMatch(matchId);
    const settledEvents = settledRestart.root.matchCoordinator.getEvents().events;
    const settledRebound = (await settledRestart.root.identity.authenticate({
        credential: 'controlled-player-2'
    })).principal;
    assert.strictEqual((await settledRestart.reassociatePlayerSession(settledRebound)).ok, true);
    assert.deepStrictEqual(settledRestart.root.matchCoordinator.getEvents().events, settledEvents);
    assert.deepStrictEqual(await env.root.matchPersistence.loadMatch(matchId), settledBefore);
    assert.deepStrictEqual(settledRestart.root.matchCoordinator.getResult().result, initialResult);
}

async function testAbortRequiredFailClosed() {
    const matchId = 'controlled-abort-required';
    const env = createControlledEnvironment({ matchId });
    assert.strictEqual((await env.root.matchPersistence.createMatch({
        matchId,
        rulesVersion: 'v2'
    })).ok, true);
    const assigned = await env.resolveControlledAssignment();
    assert.strictEqual(assigned.ok, true);
    assert.strictEqual(assigned.assignment.runtime, 'V2');
    let stored = await env.root.matchPersistence.loadMatch(matchId);
    let expectedStateVersion = stored.match.matchPersistence.stateVersion;
    for (const lifecycle of ['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING']) {
        const transitioned = await env.root.matchPersistence.transitionLifecycle({
            matchId,
            expectedStateVersion,
            to: lifecycle
        });
        assert.strictEqual(transitioned.ok, true);
        expectedStateVersion = transitioned.stateVersion;
    }
    const abortRequired = await env.root.matchPersistence.recoverMatch(matchId);
    assert.strictEqual(abortRequired.ok, true);
    assert.strictEqual(abortRequired.state, 'ABORT_REQUIRED');
    const before = await env.root.matchPersistence.loadMatch(matchId);
    const player = (await env.authenticatePlayer('controlled-player-1')).principal;
    const recovery = await env.restartFromPersistedState(player);
    assert.strictEqual(recovery.ok, false);
    assert.strictEqual(recovery.error.code, CONTROLLED_INTEGRATION_ERRORS.RECOVERY_FAILURE);
    assert.strictEqual(env.getBootstrapCount(), 0);
    assert.strictEqual(env.adapter.getInstance(matchId), null);
    assert.deepStrictEqual(await env.root.matchPersistence.loadMatch(matchId), before);
    const authority = await env.integrationBoundary.getRuntimeAssignment(matchId);
    assert.deepStrictEqual(authority.data.assignment, assigned.assignment);
    assert.strictEqual(authority.data.assignment.runtime, 'V2');
    const persistedRecord = await env.persistence.MatchRepository.getById(matchId);
    assert.strictEqual(persistedRecord.runtimeAssignments, undefined);
}

async function testKillSwitchPreservesActiveV2() {
    const matchId = 'controlled-kill-active';
    const newMatchId = 'controlled-kill-new-match';
    const activeEnv = createControlledEnvironment({ matchId });
    assert.strictEqual((await activeEnv.root.matchPersistence.createMatch({
        matchId,
        rulesVersion: 'v2'
    })).ok, true);
    const assigned = await activeEnv.resolveControlledAssignment();
    const started = await activeEnv.startControlledInstance(assigned.assignment);
    assert.strictEqual(started.ok, true);
    const activated = await activeEnv.integrationBoundary.activateMatch(matchId);
    assert.strictEqual(activated.ok, true);
    assert.strictEqual(activated.data.assignment.status, 'ACTIVE');
    const authorityBefore = activated.data.assignment;
    const instanceBefore = activeEnv.adapter.getInstance(matchId);

    const killPolicy = {
        ...DEFAULT_POLICY,
        allowlist: [matchId, newMatchId],
        killSwitch: true
    };
    const switchedEnv = createControlledEnvironment({
        matchId: newMatchId,
        persistence: activeEnv.persistence,
        routingPolicy: killPolicy
    });
    assert.strictEqual((await switchedEnv.root.matchPersistence.createMatch({
        matchId: newMatchId,
        rulesVersion: 'v2'
    })).ok, true);
    const rejectedV2 = await switchedEnv.resolveControlledAssignment({ requestedMode: 'V2' });
    assert.strictEqual(rejectedV2.ok, false);
    const newAssignment = await switchedEnv.resolveControlledAssignment();
    assert.strictEqual(newAssignment.ok, true);
    assert.strictEqual(newAssignment.assignment.runtime, 'LEGACY');
    assert.strictEqual(switchedEnv.getBootstrapCount(), 0);
    assert.strictEqual(switchedEnv.adapter.getInstance(newMatchId), null);
    assert.ok(switchedEnv.emitted.some((event) =>
        event.metadata?.eventName === 'runtime.kill_switch'));

    const stillAuthoritative = await switchedEnv.integrationBoundary.getRuntimeAssignment(matchId);
    assert.deepStrictEqual(stillAuthoritative.data.assignment, authorityBefore);
    assert.strictEqual(activeEnv.adapter.getInstance(matchId), instanceBefore);
    assert.strictEqual(activeEnv.adapter.getInstance(matchId).status, 'ACTIVE');
    assert.strictEqual(activeEnv.adapter.getInstance(matchId).runtime, 'V2');

    const switchOffEnv = createControlledEnvironment({
        matchId,
        persistence: activeEnv.persistence,
        routingPolicy: { ...killPolicy, killSwitch: false }
    });
    const keptV2 = await switchOffEnv.resolveControlledAssignment();
    assert.strictEqual(keptV2.ok, true);
    assert.strictEqual(keptV2.assignment.runtime, 'V2');
    assert.strictEqual(keptV2.assignment.status, 'ACTIVE');
    assert.strictEqual(keptV2.assignment.assignmentId, authorityBefore.assignmentId);
    assert.strictEqual(activeEnv.adapter.getInstance(matchId).status, 'ACTIVE');
}



async function testKillSwitch() {
    const env = createControlledEnvironment({
        matchId: 'controlled-kill',
        routingPolicy: { ...DEFAULT_POLICY, allowlist: ['controlled-kill'], killSwitch: true }
    });
    const result = await env.runControlledMatchFlow();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, CONTROLLED_INTEGRATION_ERRORS.AUTHORITY_FAILURE);
    assert.strictEqual(result.error.runtime, 'LEGACY');
    assert.strictEqual(env.getBootstrapCount(), 0);
    assert.strictEqual(env.adapter.getInstance('controlled-kill'), null);
    assert.ok(env.emitted.some((event) =>
        event.metadata && event.metadata.eventName === 'runtime.kill_switch'));
    const resolved = await env.resolveControlledAssignment();
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(resolved.assignment.runtime, 'LEGACY');
}

async function testLegacyPassthrough() {
    const env = createControlledEnvironment({
        matchId: 'controlled-legacy',
        routingPolicy: { ...DEFAULT_POLICY, denylist: ['controlled-legacy'] }
    });
    const result = await env.runControlledMatchFlow();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, CONTROLLED_INTEGRATION_ERRORS.AUTHORITY_FAILURE);
    assert.strictEqual(result.error.runtime, 'LEGACY');
    assert.strictEqual(env.getBootstrapCount(), 0);
    assert.strictEqual(env.adapter.getInstance('controlled-legacy'), null);
    assert.strictEqual(env.emitted.some((event) =>
        event.metadata && event.metadata.eventName === 'runtime.kill_switch'), false);
    const assignment = await env.resolveControlledAssignment();
    assert.strictEqual(assignment.ok, true);
    assert.strictEqual(assignment.assignment.runtime, 'LEGACY');
    const legacyHandled = await env.adapter.startAssignedMatch(assignment.assignment, {
        correlationId: env.correlationId
    });
    assert.strictEqual(legacyHandled.ok, true);
    assert.strictEqual(legacyHandled.handled, false);
    assert.strictEqual(legacyHandled.runtime, 'LEGACY');
    assert.strictEqual(env.getBootstrapCount(), 0);
    assert.strictEqual(env.adapter.getInstance('controlled-legacy'), null);
    const authority = await env.integrationBoundary.getRuntimeAssignment('controlled-legacy');
    assert.deepStrictEqual(authority.data.assignment, assignment.assignment);
    const persisted = await env.persistence.MatchRepository.getById('controlled-legacy');
    assert.strictEqual(persisted.runtimeAssignments, undefined);
    assert.deepStrictEqual(persisted.runtimeAssignment, assignment.assignment);
}

async function testIsolation() {
    const source = fs.readFileSync(
        path.join(__dirname, '../packages/controlled-integration/v2/index.js'), 'utf8');
    const lowered = source.toLowerCase();
    for (const forbidden of ['server.js', 'express', 'socket.io', 'firebase',
        'firestore', 'cloudflare', 'render', 'admin sdk']) {
        assert.strictEqual(lowered.includes(forbidden), false,
            `Forbidden dependency: ${forbidden}`);
    }
    assert.strictEqual(source.includes('console.log'), false);
    const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
    assert.ok(requires.length > 0);
    for (const request of requires) {
        assert.ok(request.startsWith('../..') && request.includes('/v2'),
            `Unexpected dependency: ${request}`);
    }

    // Environments do not share state, even with the same match ID.
    const first = createControlledEnvironment({ matchId: 'controlled-shared' });
    const second = createControlledEnvironment({ matchId: 'controlled-shared' });
    const flow = await first.runControlledMatchFlow();
    assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
    assert.notStrictEqual(first.persistence, second.persistence);
    const foreign = await second.root.matchPersistence.loadMatch('controlled-shared');
    assert.strictEqual(foreign.ok, false);
    assert.strictEqual(foreign.error.code, 'MATCH_NOT_FOUND');
    assert.strictEqual(second.getBootstrapCount(), 0);
    assert.strictEqual(second.emitted.length, 0);
}



async function testDeterminism() {
    const makeRun = async (matchId) => {
        const env = createControlledEnvironment({ matchId });
        const flow = await env.runControlledMatchFlow();
        assert.strictEqual(flow.ok, true, JSON.stringify(flow.error || null));
        const recoveryEnv = createControlledEnvironment({
            matchId,
            persistence: env.persistence,
            clock: env.clock
        });
        const recoveryPrincipal = (await recoveryEnv.authenticatePlayer('controlled-player-1')).principal;
        const restarted = await recoveryEnv.restartFromPersistedState(recoveryPrincipal);
        assert.strictEqual(restarted.ok, true, JSON.stringify(restarted.error || null));
        const rebound = (await restarted.root.identity.authenticate({
            credential: 'controlled-player-1'
        })).principal;
        assert.strictEqual((await restarted.reassociatePlayerSession(rebound)).ok, true);
        const stored = await env.root.matchPersistence.loadMatch(matchId);
        const authority = await recoveryEnv.integrationBoundary.getRuntimeAssignment(matchId);
        const recoveredSnapshot = restarted.root.matchCoordinator.getSnapshot().snapshot;
        return {
            assignment: flow.assignment,
            authority: authority.data.assignment,
            lifecycle: recoveredSnapshot.status,
            snapshot: recoveredSnapshot,
            stateVersion: stored.match.matchPersistence.stateVersion,
            eventSequence: stored.match.matchPersistence.eventSequence,
            roster: recoveredSnapshot.members,
            readyActorIds: recoveredSnapshot.readyActorIds,
            events: restarted.root.matchCoordinator.getEvents().events,
            result: restarted.root.matchCoordinator.getResult().result,
            bootstrapCounts: [env.getBootstrapCount(), recoveryEnv.getBootstrapCount(),
                restarted.bootstrapCount],
            initialObservability: env.emitted,
            recoveryObservability: recoveryEnv.emitted
        };
    };
    const first = await makeRun('controlled-determinism');
    const second = await makeRun('controlled-determinism');
    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first.result, second.result);
    assert.strictEqual(first.result.resultHash, second.result.resultHash);
    assert.deepStrictEqual(first.assignment, second.assignment);
    assert.deepStrictEqual(first.events, second.events);
    assert.deepStrictEqual(first.bootstrapCounts, [1, 0, 1]);
    assert.strictEqual(first.authority.assignmentId, first.assignment.assignmentId);
    assert.strictEqual(first.authority.runtime, 'V2');
}

async function testNoProductionSurface() {
    const env = createControlledEnvironment({ matchId: 'controlled-surface' });
    assert.deepStrictEqual(Object.keys(env).sort(), [
        'adapter',
        'authenticatePlayer',
        'checkAuthority',
        'clock',
        'correlationId',
        'emit',
        'emitted',
        'getBootstrapCount',
        'idempotencyKey',
        'integrationBoundary',
        'matchId',
        'persistence',
        'randomSource',
        'resolveControlledAssignment',
        'restartFromPersistedState',
        'root',
        'runControlledMatchFlow',
        'startControlledInstance'
    ]);
    assert.strictEqual(Object.isFrozen(env), true);
    const json = JSON.stringify(env.root);
    for (const forbidden of ['secret', 'token', 'serviceAccount', 'privateKey']) {
        assert.strictEqual(json.toLowerCase().includes(forbidden.toLowerCase()), false,
            `Sensitive material exposed: ${forbidden}`);
    }
    const moduleSource = fs.readFileSync(
        path.join(__dirname, '../packages/controlled-integration/v2/index.js'), 'utf8');
    assert.strictEqual(/require\(['"][^'.]/.test(moduleSource), false,
        'Only relative package dependencies are allowed');
    assert.strictEqual(moduleSource.includes('listen('), false);
    assert.strictEqual(moduleSource.includes('deploy'), false);
}

async function run() {
    await testExports();
    await testAssignmentPrecedesBootstrap();
    await testFullFlow();
    await testConcurrency();
    await testClosedRejection();
    await testRecovery();
    await testRunningSessionReassociationAfterRestart();
    await testTerminalSessionReassociation();
    await testAbortRequiredFailClosed();
    await testKillSwitchPreservesActiveV2();
    await testKillSwitch();
    await testLegacyPassthrough();
    await testIsolation();
    await testDeterminism();
    await testNoProductionSurface();
    console.log('OK controlled integration v2: lifecycle, authority, recovery, kill switch, isolation and determinism hold.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
