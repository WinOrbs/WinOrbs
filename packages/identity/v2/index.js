'use strict';

const { SCHEMA_VERSION } = require('../../contracts/v2');
const { validateAuthenticatedPrincipal } = require('../../contracts/v2/validation');

const IDENTITY_ERRORS = Object.freeze({
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    AUTHENTICATION_EXPIRED: 'AUTHENTICATION_EXPIRED',
    AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED'
});

const MATCH_PERMISSIONS = Object.freeze([
    'match.join',
    'match.leave',
    'match.command',
    'match.view',
    'match.ready',
    'match.start',
    'match.finish',
    'match.result.read',
    'match.result.lock'
]);

const SYSTEM_OPERATIONS = Object.freeze([
    'startCountdown',
    'startMatch',
    'finishMatch',
    'lockResult'
]);

function failure(code) {
    return { ok: false, error: { code } };
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function validString(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function validStringList(value) {
    return Array.isArray(value) && value.every(validString) &&
        new Set(value).size === value.length;
}

function createIdentityService({
    authenticate,
    resolveAuthorization,
    validateSession,
    verifySystemOperation = () => false,
    clock
} = {}) {
    if (typeof authenticate !== 'function' ||
        typeof resolveAuthorization !== 'function' ||
        typeof validateSession !== 'function' ||
        typeof verifySystemOperation !== 'function' ||
        typeof clock !== 'function') {
        throw new TypeError('Identity adapters and clock must be functions');
    }

    const issuedPrincipals = new WeakSet();
    const systemCapabilities = new WeakMap();

    async function authenticateIdentity(input) {
        const credential = isRecord(input) ? input.credential : null;
        if (typeof credential !== 'string' || !credential.trim()) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }

        const identity = await authenticate(credential);
        if (!isRecord(identity) || identity.ok === false) {
            return failure(identity?.error?.code === IDENTITY_ERRORS.AUTHENTICATION_EXPIRED
                ? IDENTITY_ERRORS.AUTHENTICATION_EXPIRED
                : IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }

        const now = clock();
        if (!Number.isFinite(now) || now < 0 ||
            !validString(identity.userId) ||
            !validString(identity.provider) ||
            !validString(identity.sessionId) ||
            !Number.isFinite(identity.expiresAt) ||
            identity.expiresAt <= now) {
            return failure(identity.expiresAt <= now
                ? IDENTITY_ERRORS.AUTHENTICATION_EXPIRED
                : IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }

        const trustedIdentity = Object.freeze({
            userId: identity.userId,
            provider: identity.provider,
            sessionId: identity.sessionId,
            authenticatedAt: now,
            expiresAt: identity.expiresAt
        });
        const sessionValid = await validateSession(trustedIdentity);
        if (sessionValid !== true) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }

        const access = await resolveAuthorization(Object.freeze({
            userId: trustedIdentity.userId,
            provider: trustedIdentity.provider
        }));
        if (!isRecord(access) ||
            !validStringList(access.roles) ||
            !validStringList(access.permissions)) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }

        const principal = deepFreeze({
            schemaVersion: SCHEMA_VERSION,
            ...trustedIdentity,
            roles: [...access.roles],
            permissions: [...access.permissions]
        });
        if (!validateAuthenticatedPrincipal(principal).ok) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }
        issuedPrincipals.add(principal);
        return { ok: true, principal };
    }

    async function requireAuthenticated(principal) {
        if (!principal || typeof principal !== 'object' || !issuedPrincipals.has(principal)) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }
        const validation = validateAuthenticatedPrincipal(principal);
        if (!validation.ok) return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        const now = clock();
        if (!Number.isFinite(now) || principal.expiresAt <= now) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_EXPIRED);
        }
        const sessionValid = await validateSession(Object.freeze({
            userId: principal.userId,
            provider: principal.provider,
            sessionId: principal.sessionId,
            authenticatedAt: principal.authenticatedAt,
            expiresAt: principal.expiresAt
        }));
        if (sessionValid !== true) {
            return failure(IDENTITY_ERRORS.AUTHENTICATION_REQUIRED);
        }
        return { ok: true, principal };
    }

    async function requirePermission(principal, permission) {
        const authenticated = await requireAuthenticated(principal);
        if (!authenticated.ok) return authenticated;
        if (typeof permission !== 'string' ||
            !authenticated.principal.permissions.includes(permission)) {
            return failure(IDENTITY_ERRORS.AUTHORIZATION_DENIED);
        }
        return authenticated;
    }

    async function authorizeSystemOperation(credential, operation) {
        if (typeof credential !== 'string' || !credential.trim() ||
            !SYSTEM_OPERATIONS.includes(operation)) {
            return failure(IDENTITY_ERRORS.AUTHORIZATION_DENIED);
        }
        const authorized = await verifySystemOperation(credential, operation);
        if (authorized !== true) return failure(IDENTITY_ERRORS.AUTHORIZATION_DENIED);
        const capability = Object.freeze(Object.create(null));
        systemCapabilities.set(capability, operation);
        return { ok: true, capability };
    }

    function consumeSystemOperation(capability, operation) {
        if (!capability || typeof capability !== 'object' ||
            systemCapabilities.get(capability) !== operation) {
            return failure(IDENTITY_ERRORS.AUTHORIZATION_DENIED);
        }
        systemCapabilities.delete(capability);
        return { ok: true };
    }

    return Object.freeze({
        authenticate: authenticateIdentity,
        requireAuthenticated,
        requirePermission,
        authorizeSystemOperation,
        consumeSystemOperation
    });
}

module.exports = Object.freeze({
    IDENTITY_ERRORS,
    MATCH_PERMISSIONS,
    SYSTEM_OPERATIONS,
    createIdentityService
});
