'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const {
    MATCH_PERMISSIONS,
    SYSTEM_OPERATIONS,
    createIdentityService
} = require('../packages/identity/v2');
const {
    APPLICATION_ERRORS,
    createApplicationBoundary
} = require('../packages/application/v2');
const { createMatchCoordinator } = require('../packages/match-coordinator/v2');

const MATCH_ID = 'application-test-match';
let now = 1000;
const permissionSets = new Map([
    ['user-1', [...MATCH_PERMISSIONS]],
    ['user-2', [...MATCH_PERMISSIONS]],
    ['no-join', MATCH_PERMISSIONS.filter((permission) => permission !== 'match.join')],
    ['read-only', ['match.view']]
]);

const identity = createIdentityService({
    authenticate: async (credential) => {
        const userId = ({
            token1: 'user-1',
            token4: 'user-2',
            token2: 'no-join',
            token3: 'read-only'
        })[credential];
        if (!userId) return null;
        return {
            userId,
            provider: 'test',
            sessionId: `session-${userId}`,
            expiresAt: now + 60000
        };
    },
    resolveAuthorization: async ({ userId }) => ({
        roles: userId === 'user-1' ? ['player', 'admin'] : ['player'],
        permissions: permissionSets.get(userId) || []
    }),
    validateSession: async () => true,
    verifySystemOperation: async (credential, operation) =>
        credential === 'internal-system-key' && SYSTEM_OPERATIONS.includes(operation),
    clock: () => now
});

const coordinator = createMatchCoordinator({
    matchId: MATCH_ID,
    rules: { matchDurationMs: null },
    clock: () => now
});
assert.strictEqual(coordinator.createMatch().ok, true);
const app = createApplicationBoundary({ identity, coordinator, matchId: MATCH_ID });

async function principal(credential) {
    const authenticated = await identity.authenticate({ credential });
    assert.strictEqual(authenticated.ok, true);
    return authenticated.principal;
}

function session(principalValue) {
    return {
        principal: principalValue,
        sessionId: principalValue.sessionId,
        matchId: MATCH_ID
    };
}

function command(principalValue, overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        commandId: 'cmd-1',
        sessionId: principalValue.sessionId,
        matchId: MATCH_ID,
        actorId: principalValue.userId,
        sequence: 1,
        type: 'MovePlayer',
        payload: { direction: { x: 1, y: 0 } },
        ...overrides
    };
}

async function run() {
// Player operations derive identity from an Identity-minted principal and delegate.
{
    const player = await principal('token1');
    const joined = await app.joinMatch({
        ...session(player),
        userId: 'SYSTEM',
        roles: ['system', 'admin'],
        permissions: ['match.finish', 'match.result.lock']
    });
    assert.strictEqual(joined.ok, true);
    assert.deepStrictEqual(joined.snapshot.memberActorIds, ['user-1']);
    assert.strictEqual((await app.joinMatch({
        ...session(player),
        actorId: 'someone-else'
    })).error.code, APPLICATION_ERRORS.ACTOR_MISMATCH);

    const readyA = await app.markReady(session(player));
    assert.strictEqual(readyA.ok, true);
    assert.strictEqual(readyA.snapshot.status, 'WAITING');
    assert.deepStrictEqual(readyA.snapshot.readyActorIds, ['user-1']);
    assert.deepStrictEqual(readyA.snapshot.notReadyActorIds, []);
    assert.strictEqual((await app.markReady({
        ...session(player),
        actorId: 'user-2'
    })).error.code, APPLICATION_ERRORS.ACTOR_MISMATCH);
    assert.strictEqual((await app.markReady({
        ...session(player),
        sessionId: 'other-session'
    })).error.code, APPLICATION_ERRORS.SESSION_MISMATCH);
    const secondPlayer = await principal('token4');
    const secondJoin = await app.joinMatch(session(secondPlayer));
    assert.strictEqual(secondJoin.ok, true);
    assert.deepStrictEqual(secondJoin.snapshot.notReadyActorIds, ['user-2']);
    assert.strictEqual((await app.markReady(session(secondPlayer))).snapshot.status, 'READY');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot.readyActorIds,
        ['user-1', 'user-2']);
    const authority = await identity.authorizeSystemOperation(
        'internal-system-key', 'startCountdown'
    );
    const countdown = await app.startCountdown({
        authority: authority.capability
    });
    assert.strictEqual(countdown.ok, true, JSON.stringify(countdown));
    const startAuthority = await identity.authorizeSystemOperation(
        'internal-system-key', 'startMatch'
    );
    assert.strictEqual((await app.startMatch({
        authority: startAuthority.capability
    })).ok, true);

    const submitted = await app.submitGameCommand({
        ...session(player),
        command: command(player)
    });
    assert.strictEqual(submitted.ok, true);
    assert.ok(submitted.snapshot.gameState.players['user-1']);
    assert.strictEqual((await app.getMatchSnapshot(session(player))).ok, true);
    assert.strictEqual((await app.getMatchEvents(session(player))).ok, true);

    assert.strictEqual((await app.submitGameCommand({
        ...session(player),
        command: command(player, { actorId: 'forged-user' })
    })).error.code, APPLICATION_ERRORS.ACTOR_MISMATCH);
    assert.strictEqual((await app.submitGameCommand({
        ...session(player),
        command: command(player, { sessionId: 'forged-session' })
    })).error.code, APPLICATION_ERRORS.SESSION_MISMATCH);
}

// Authentication, permissions, membership, sessions, and resource scope fail closed.
{
    const player = await principal('token1');
    assert.strictEqual((await app.joinMatch({
        sessionId: player.sessionId
    })).error.code, APPLICATION_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await app.getMatchSnapshot({
        ...session(player),
        sessionId: 'other-session'
    })).error.code, APPLICATION_ERRORS.SESSION_MISMATCH);
    assert.strictEqual((await app.getMatchSnapshot({
        ...session(player),
        matchId: 'different-match'
    })).error.code, APPLICATION_ERRORS.RESOURCE_NOT_FOUND);

    const noJoin = await principal('token2');
    assert.strictEqual((await app.joinMatch(session(noJoin))).error.code,
        APPLICATION_ERRORS.AUTHORIZATION_DENIED);
    const readOnly = await principal('token3');
    assert.strictEqual((await app.getMatchSnapshot(session(readOnly))).error.code,
        APPLICATION_ERRORS.MATCH_ACCESS_DENIED);

    const spoofed = {
        ...player,
        userId: 'SYSTEM',
        roles: ['system', 'admin'],
        permissions: [...MATCH_PERMISSIONS, 'match.result.lock']
    };
    assert.strictEqual((await app.joinMatch(session(spoofed))).error.code,
        APPLICATION_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await app.getMatchSnapshot(session({
        userId: 'SYSTEM',
        sessionId: 'forged',
        permissions: [...MATCH_PERMISSIONS],
        roles: ['system']
    }))).error.code, APPLICATION_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await app.startMatch({
        authority: { userId: 'SYSTEM', permissions: ['match.start'] }
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
    assert.strictEqual((await app.startCountdown({
        principal: player,
        sessionId: player.sessionId,
        permissions: [...MATCH_PERMISSIONS]
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
    assert.strictEqual((await app.finishMatch({
        principal: player,
        finishReason: 'ABANDONED'
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
    assert.strictEqual((await app.lockResult({
        principal: player,
        permissions: ['match.result.lock']
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
}

// Leave delegates to membership; each privileged lifecycle action requires
// an operation-scoped capability rather than player roles or permissions.
{
    const coordinator2 = createMatchCoordinator({
        matchId: 'leave-test-match',
        clock: () => now
    });
    coordinator2.createMatch();
    const app2 = createApplicationBoundary({
        identity,
        coordinator: coordinator2,
        matchId: 'leave-test-match'
    });
    const player = await principal('token1');
    const leaveContext = { ...session(player), matchId: 'leave-test-match' };
    assert.strictEqual((await app2.joinMatch(leaveContext)).ok, true);
    assert.strictEqual((await app2.leaveMatch(leaveContext)).ok, true);
    assert.strictEqual((await app2.leaveMatch(leaveContext)).error.code,
        APPLICATION_ERRORS.MATCH_ACCESS_DENIED);
    assert.strictEqual((await app2.finishMatch({
        finishReason: 'ABANDONED'
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
    assert.strictEqual((await app2.lockResult({})).error.code,
        APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
}

// finishMatch locks atomically in the Coordinator; lockResult is a separately
// authorized read/confirmation of that already locked result.
{
    const player = await principal('token1');
    const finishedAuthority = await identity.authorizeSystemOperation(
        'internal-system-key', 'finishMatch'
    );
    const finished = await app.finishMatch({
        authority: finishedAuthority.capability,
        finishReason: 'ABANDONED'
    });
    assert.strictEqual(finished.ok, true);
    assert.strictEqual(finished.snapshot.status, 'RESULT_LOCKED');

    const resultAuthority = await identity.authorizeSystemOperation(
        'internal-system-key', 'lockResult'
    );
    const locked = await app.lockResult({ authority: resultAuthority.capability });
    assert.strictEqual(locked.ok, true);
    assert.strictEqual(locked.result.matchId, MATCH_ID);
    assert.strictEqual((await app.submitGameCommand({
        ...session(player),
        command: command(player, { sequence: 2, commandId: 'cmd-after-lock' })
    })).error.code, APPLICATION_ERRORS.MATCH_RESULT_LOCKED);
    assert.strictEqual((await app.startCountdown({
        authority: resultAuthority.capability
    })).error.code, APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
}

// Application imports only contracts, identity, and the Match Coordinator.
{
    const source = fs.readFileSync(path.join(__dirname,
        '../packages/application/v2/index.js'), 'utf8');
    const imports = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
        .map((match) => match[1]);
    assert.deepStrictEqual(imports, [
        '../../contracts/v2/validation',
        '../../identity/v2'
    ]);
    assert.doesNotMatch(source, /firebase|firestore|express|socket\.io|economy|admin|server\.js/i);
    assert.doesNotMatch(source, /movement|damage|collision|shoot|score|zone|respawn|loot/i);
    assert.ok(coordinator);
}

console.log('OK application v2: authenticated player operations and capability-gated system boundary.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
