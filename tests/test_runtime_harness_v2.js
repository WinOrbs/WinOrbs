'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    MATCH_PERMISSIONS
} = require('../packages/identity/v2');
const {
    createControlledClock,
    createRuntimeHarness
} = require('../packages/runtime-harness/v2');

const SYSTEM_OPERATIONS = new Set([
    'startCountdown',
    'startMatch',
    'finishMatch',
    'lockResult'
]);

function createFakeIdentity(clock) {
    const issuedPrincipals = new WeakSet();
    const capabilities = new WeakMap();

    return Object.freeze({
        async authenticate({ credential } = {}) {
            const identity = {
                'fake-player-1': { userId: 'player-1', sessionId: 'session-1' },
                'fake-player-2': { userId: 'player-2', sessionId: 'session-2' }
            }[credential];
            if (!identity) return { ok: false, error: { code: 'AUTHENTICATION_REQUIRED' } };
            const now = clock();
            const principal = Object.freeze({
                schemaVersion: 1,
                ...identity,
                provider: 'harness',
                authenticatedAt: now,
                expiresAt: now + 60_000,
                roles: ['player'],
                permissions: [...MATCH_PERMISSIONS]
            });
            issuedPrincipals.add(principal);
            return { ok: true, principal };
        },
        async requirePermission(principal, permission) {
            if (!principal || !issuedPrincipals.has(principal) ||
                principal.expiresAt <= clock()) {
                return { ok: false, error: { code: 'AUTHENTICATION_REQUIRED' } };
            }
            if (!principal.permissions.includes(permission)) {
                return { ok: false, error: { code: 'AUTHORIZATION_DENIED' } };
            }
            return { ok: true, principal };
        },
        async authorizeSystemOperation(credential, operation) {
            if (credential !== 'harness-system-credential' ||
                !SYSTEM_OPERATIONS.has(operation)) {
                return { ok: false, error: { code: 'AUTHORIZATION_DENIED' } };
            }
            const capability = Object.freeze({});
            capabilities.set(capability, operation);
            return { ok: true, capability };
        },
        consumeSystemOperation(capability, operation) {
            if (!capability || capabilities.get(capability) !== operation) {
                return { ok: false, error: { code: 'AUTHORIZATION_DENIED' } };
            }
            capabilities.delete(capability);
            return { ok: true };
        }
    });
}

function createRandomSource() {
    let value = 0;
    return () => {
        value = (value + 0.25) % 1;
        return value;
    };
}

function staticIsolationCheck() {
    const files = [
        path.join(__dirname, '../packages/runtime-harness/v2/index.js'),
        __filename
    ];
    const prohibitedRequire = /\brequire\s*\(\s*['"](?:[^'"]*\/)?(?:server(?:\.js)?|firebase(?:-admin)?|firestore|express|socket\.io|render|cloudflare)(?:\/[^'"]*)?['"]\s*\)/i;
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, prohibitedRequire, `${path.basename(file)} imports a prohibited runtime`);
    }
}

async function runScenario() {
    const clock = createControlledClock();
    const randomSource = createRandomSource();
    const identity = createFakeIdentity(clock);
    const harness = createRuntimeHarness({
        identity,
        controlledClock: clock,
        controlledRandomSource: randomSource,
        matchId: 'integration-test-match'
    });
    assert.ok(harness.root.application);
    assert.ok(harness.root.matchCoordinator);
    assert.ok(harness.root.matchPersistence);
    assert.ok(harness.root.applicationRecovery);
    assert.ok(harness.root.economy);
    assert.ok(harness.root.settlement);
    assert.equal(harness.root.transport, undefined);

    const result = await harness.runScenario();
    assert.equal(result.lifecycle, 'RESULT_LOCKED');
    assert.equal(result.playerIds.length, 2);
    assert.notEqual(result.sessions[0], result.sessions[1]);
    assert.equal(result.snapshot.status, 'RESULT_LOCKED');
    assert.equal(result.snapshot.gameState.match.status, 'RESULT_LOCKED');
    assert.equal(result.result.matchId, result.matchId);
    assert.equal(result.recovery.state, 'RESULT_LOCKED');
    assert.equal(result.recovery.replayRequired, false);
    assert.equal(result.tickCount, 3);
    assert.equal(result.atomicWrite, true);

    const crashStages = new Map(result.crashRecovery.map((entry) => [entry.stage, entry]));
    assert.equal(crashStages.get('not-found').state, 'NOT_FOUND');
    assert.equal(crashStages.get('created').state, 'RECOVERABLE');
    assert.equal(crashStages.get('ready').state, 'RECOVERABLE');
    assert.equal(crashStages.get('running').state, 'RECOVERABLE');
    assert.equal(crashStages.get('events-persisted').state, 'RECOVERABLE');
    assert.equal(crashStages.get('events-persisted').replayRequired, true);
    assert.equal(crashStages.get('finishing').error, 'RECOVERY_INTEGRITY_ERROR');
    assert.equal(crashStages.get('finishing').state, null);
    assert.equal(crashStages.get('result-locked').state, 'RESULT_LOCKED');
    assert.equal(crashStages.get('settling-fixture').state, 'SETTLING');
    assert.equal(crashStages.get('settled-fixture').state, 'SETTLED');
    assert.equal(crashStages.get('abort-required-fixture').state, 'ABORT_REQUIRED');

    const second = await runSecondScenario();
    assert.deepStrictEqual(second, {
        snapshot: result.snapshot,
        events: result.events,
        result: result.result,
        stateVersion: result.stateVersion,
        eventSequence: result.eventSequence,
        resultVersion: result.resultVersion,
        observability: result.observability,
        recovery: result.recovery,
        crashRecovery: result.crashRecovery
    });
    staticIsolationCheck();
    console.log('OK runtime harness v2: composed, authenticated, simulated, finalized and recovered deterministically without runtime services or economic writes.');
}

async function runSecondScenario() {
    const clock = createControlledClock();
    const harness = createRuntimeHarness({
        identity: createFakeIdentity(clock),
        controlledClock: clock,
        controlledRandomSource: createRandomSource(),
        matchId: 'integration-test-match'
    });
    const result = await harness.runScenario();
    return {
        snapshot: result.snapshot,
        events: result.events,
        result: result.result,
        stateVersion: result.stateVersion,
        eventSequence: result.eventSequence,
        resultVersion: result.resultVersion,
        observability: result.observability,
        recovery: result.recovery,
        crashRecovery: result.crashRecovery
    };
}

runScenario().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
