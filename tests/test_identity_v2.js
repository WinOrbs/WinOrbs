'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const { validateAuthenticatedPrincipal } = require('../packages/contracts/v2/validation');
const {
    IDENTITY_ERRORS,
    MATCH_PERMISSIONS,
    SYSTEM_OPERATIONS,
    createIdentityService
} = require('../packages/identity/v2');

let now = 1000;
const sessions = new Map();
const authorization = new Map([
    ['user-1', {
        roles: ['player'],
        permissions: [...MATCH_PERMISSIONS]
    }],
    ['role-only', { roles: ['admin'], permissions: [] }]
]);

function createIdentity(overrides = {}) {
    return createIdentityService({
        authenticate: async (credential) => {
            if (credential === 'expired') {
                return {
                    userId: 'user-1',
                    provider: 'test',
                    sessionId: 'session-expired',
                    expiresAt: now
                };
            }
            if (!['credential-user-1', 'credential-role-only'].includes(credential)) {
                return null;
            }
            const userId = credential === 'credential-user-1' ? 'user-1' : 'role-only';
            return {
                userId,
                provider: 'test',
                sessionId: `session-${userId}`,
                expiresAt: now + 10000
            };
        },
        resolveAuthorization: async ({ userId }) =>
            authorization.get(userId) || { roles: [], permissions: [] },
        validateSession: async ({ sessionId }) => sessions.get(sessionId) !== false,
        verifySystemOperation: async (credential, operation) =>
            credential === 'trusted-system-key' && SYSTEM_OPERATIONS.includes(operation),
        clock: () => now,
        ...overrides
    });
}

async function run() {
// Authentication mints a contract-valid principal from verified adapter output only.
{
    now = 1000;
    const identity = createIdentity();
    assert.strictEqual((await identity.authenticate({})).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await identity.authenticate({ credential: 'invalid' })).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await identity.authenticate({ credential: 'expired' })).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_EXPIRED);
    const authenticated = await identity.authenticate({
        credential: 'credential-user-1',
        userId: 'SYSTEM',
        roles: ['admin'],
        permissions: ['match.finish']
    });
    assert.strictEqual(authenticated.ok, true);
    assert.strictEqual(validateAuthenticatedPrincipal(authenticated.principal).ok, true);
    assert.strictEqual(authenticated.principal.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(authenticated.principal.userId, 'user-1');
    assert.strictEqual(authenticated.principal.sessionId, 'session-user-1');
    assert.deepStrictEqual(authenticated.principal.permissions, MATCH_PERMISSIONS);
    assert.ok(Object.isFrozen(authenticated.principal));
}

// Principal provenance, expiry, revocation, and permission checks are independent.
{
    now = 2000;
    const identity = createIdentity();
    const principal = (await identity.authenticate({
        credential: 'credential-user-1'
    })).principal;
    assert.strictEqual((await identity.requireAuthenticated(principal)).ok, true);
    assert.strictEqual((await identity.requirePermission(principal, 'match.join')).ok, true);
    assert.strictEqual((await identity.requirePermission(principal, 'match.unknown')).error.code,
        IDENTITY_ERRORS.AUTHORIZATION_DENIED);

    const roleOnly = (await identity.authenticate({
        credential: 'credential-role-only'
    })).principal;
    assert.strictEqual(roleOnly.roles.includes('admin'), true);
    assert.strictEqual((await identity.requirePermission(roleOnly, 'match.finish')).error.code,
        IDENTITY_ERRORS.AUTHORIZATION_DENIED);

    const forged = {
        ...principal,
        userId: 'SYSTEM',
        roles: ['admin'],
        permissions: [...MATCH_PERMISSIONS, 'match.finish', 'match.result.lock']
    };
    assert.strictEqual((await identity.requireAuthenticated(forged)).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    now = principal.expiresAt;
    assert.strictEqual((await identity.requireAuthenticated(principal)).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_EXPIRED);
}

// Invalid and revoked sessions fail closed; no token is returned in errors.
{
    now = 3000;
    sessions.set('session-user-1', false);
    const identity = createIdentity();
    const rejected = await identity.authenticate({ credential: 'credential-user-1' });
    assert.strictEqual(rejected.error.code, IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    assert.deepStrictEqual(rejected, {
        ok: false,
        error: { code: IDENTITY_ERRORS.AUTHENTICATION_REQUIRED }
    });
    sessions.delete('session-user-1');
    const valid = await identity.authenticate({ credential: 'credential-user-1' });
    sessions.set('session-user-1', false);
    assert.strictEqual((await identity.requireAuthenticated(valid.principal)).error.code,
        IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    sessions.delete('session-user-1');
}

// SYSTEM authority is operation-scoped, one-time, adapter-verified, and not a principal.
{
    now = 4000;
    const identity = createIdentity();
    const normal = (await identity.authenticate({
        credential: 'credential-user-1'
    })).principal;
    assert.strictEqual(normal.userId, 'user-1');
    assert.strictEqual((await identity.requireAuthenticated({
        userId: 'SYSTEM',
        sessionId: 'fake',
        roles: ['system'],
        permissions: ['match.start']
    })).error.code, IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await identity.authorizeSystemOperation(
        'client-supplied', 'startMatch'
    )).error.code, IDENTITY_ERRORS.AUTHORIZATION_DENIED);

    const issued = await identity.authorizeSystemOperation(
        'trusted-system-key', 'startMatch'
    );
    assert.strictEqual(issued.ok, true);
    assert.deepStrictEqual(Object.keys(issued.capability), []);
    assert.strictEqual(identity.consumeSystemOperation(issued.capability, 'finishMatch').error.code,
        IDENTITY_ERRORS.AUTHORIZATION_DENIED);

    const oneTime = await identity.authorizeSystemOperation(
        'trusted-system-key', 'lockResult'
    );
    assert.strictEqual(identity.consumeSystemOperation(oneTime.capability, 'lockResult').ok, true);
    assert.strictEqual(identity.consumeSystemOperation(oneTime.capability, 'lockResult').error.code,
        IDENTITY_ERRORS.AUTHORIZATION_DENIED);
    assert.strictEqual(identity.consumeSystemOperation({}, 'lockResult').error.code,
        IDENTITY_ERRORS.AUTHORIZATION_DENIED);
}

// Identity has only the contracts dependency and no transport/provider SDK.
{
    const source = fs.readFileSync(path.join(__dirname,
        '../packages/identity/v2/index.js'), 'utf8');
    const imports = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
        .map((match) => match[1]);
    assert.deepStrictEqual(imports, [
        '../../contracts/v2',
        '../../contracts/v2/validation'
    ]);
    assert.doesNotMatch(source, /firebase|firestore|express|socket\.io|server\.js/i);
}

console.log('OK identity v2: verified principals, sessions, explicit permissions and private system capabilities.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
