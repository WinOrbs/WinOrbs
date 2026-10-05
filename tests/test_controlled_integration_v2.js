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
        const result = await env.runControlledMatchFlow();
        assert.strictEqual(result.ok, true, JSON.stringify(result.error || null));
        return result;
    };
    const first = await makeRun('controlled-determinism');
    const second = await makeRun('controlled-determinism');
    assert.deepStrictEqual(first.result, second.result);
    assert.strictEqual(first.result.resultHash, second.result.resultHash);
    assert.deepStrictEqual(first.assignment, second.assignment);
    assert.strictEqual(first.stored.matchPersistence.stateVersion,
        second.stored.matchPersistence.stateVersion);
    assert.strictEqual(first.stored.matchPersistence.eventSequence,
        second.stored.matchPersistence.eventSequence);
    assert.deepStrictEqual(
        first.emitted.map((event) => event.eventId),
        second.emitted.map((event) => event.eventId));
    assert.deepStrictEqual(first.events, second.events);
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
    await testFullFlow();
    await testConcurrency();
    await testClosedRejection();
    await testRecovery();
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
