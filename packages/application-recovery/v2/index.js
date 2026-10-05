'use strict';

const { MATCH_PERMISSIONS } = require('../../identity/v2');
const {
    validateGameState,
    validateMatchResult
} = require('../../contracts/v2/validation');

const APPLICATION_RECOVERY_ERRORS = Object.freeze({
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    RECOVERY_NOT_FOUND: 'RECOVERY_NOT_FOUND',
    RECOVERY_ABORT_REQUIRED: 'RECOVERY_ABORT_REQUIRED',
    INVALID_MATCH_ID: 'INVALID_MATCH_ID',
    INVALID_RECOVERY_REQUEST: 'INVALID_RECOVERY_REQUEST',
    RECOVERY_INTEGRITY_ERROR: 'RECOVERY_INTEGRITY_ERROR',
    RESULT_NOT_LOCKED: 'RESULT_NOT_LOCKED',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR'
});

const SAFE_MESSAGES = Object.freeze({
    AUTHENTICATION_REQUIRED: 'Authentication is required.',
    AUTHORIZATION_DENIED: 'Access to this match is not permitted.',
    MATCH_NOT_FOUND: 'The match was not found.',
    RECOVERY_NOT_FOUND: 'Recovery information was not found.',
    RECOVERY_ABORT_REQUIRED: 'This match requires an explicit abort decision.',
    INVALID_MATCH_ID: 'The match identifier is invalid.',
    INVALID_RECOVERY_REQUEST: 'The recovery request is invalid.',
    RECOVERY_INTEGRITY_ERROR: 'Persisted match data failed integrity checks.',
    RESULT_NOT_LOCKED: 'The match result is not locked.',
    PERSISTENCE_ERROR: 'Persisted match data could not be read.'
});

const FORBIDDEN_KEYS = new Set([
    'winner',
    'winnerid',
    'payout',
    'payoutminor',
    'amount',
    'amountminor',
    'balance',
    'balanceminor',
    'fee',
    'wallet',
    'settlement',
    'adminpassword',
    'credentials',
    'credential',
    'firebasetoken',
    'serviceaccount',
    'roles',
    'permissions'
]);

const RECOVERY_READ_PERMISSION = MATCH_PERMISSIONS.includes('match.view')
    ? 'match.view'
    : null;
const RESULT_READ_PERMISSION = MATCH_PERMISSIONS.includes('match.result.read')
    ? 'match.result.read'
    : null;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMatchId(value) {
    return typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= 128 &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function fail(code) {
    const safeCode = Object.hasOwn(SAFE_MESSAGES, code)
        ? code
        : APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR;
    return {
        ok: false,
        error: {
            code: safeCode,
            message: SAFE_MESSAGES[safeCode]
        }
    };
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function containsForbidden(value) {
    if (Array.isArray(value)) return value.some(containsForbidden);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, child]) => {
        const normalized = key.toLowerCase();
        return [...FORBIDDEN_KEYS].some((forbidden) => normalized.includes(forbidden)) ||
            containsForbidden(child);
    });
}

function errorCode(response) {
    return response?.error?.code;
}

function createApplicationRecoveryBoundary({
    identity,
    recoveryService
} = {}) {
    if (!identity || typeof identity.requirePermission !== 'function' ||
        !recoveryService ||
        typeof recoveryService.loadMatch !== 'function' ||
        typeof recoveryService.loadSnapshot !== 'function' ||
        typeof recoveryService.loadEvents !== 'function' ||
        typeof recoveryService.loadResult !== 'function' ||
        typeof recoveryService.recoverMatch !== 'function') {
        throw new TypeError('IdentityService and Match Persistence RecoveryService are required');
    }
    if (!RECOVERY_READ_PERMISSION || !RESULT_READ_PERMISSION) {
        throw new TypeError('Compatible match read permissions are required');
    }

    async function authorize(principal, permission) {
        try {
            const access = await identity.requirePermission(principal, permission);
            if (!access?.ok) {
                const code = access?.error?.code === 'AUTHENTICATION_EXPIRED'
                    ? 'AUTHENTICATION_REQUIRED'
                    : access?.error?.code === 'AUTHENTICATION_REQUIRED'
                        ? 'AUTHENTICATION_REQUIRED'
                        : 'AUTHORIZATION_DENIED';
                return { ok: false, response: fail(code) };
            }
            return { ok: true, principal: access.principal };
        } catch {
            return { ok: false, response: fail('AUTHENTICATION_REQUIRED') };
        }
    }

    function mapPersistenceError(response) {
        switch (errorCode(response)) {
            case 'MATCH_NOT_FOUND':
                return fail(APPLICATION_RECOVERY_ERRORS.MATCH_NOT_FOUND);
            case 'RECOVERY_INCONSISTENT_STATE':
            case 'INVALID_RESULT':
                return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
            case 'INVALID_REQUEST':
                return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
            default:
                return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
    }

    function hasMembership(match, userId) {
        const snapshot = match?.matchPersistence?.snapshot?.value;
        const ids = snapshot?.memberActorIds;
        if (Array.isArray(ids) && ids.includes(userId)) return true;
        const members = snapshot?.members;
        if (Array.isArray(members) && members.some((member) =>
            member?.actorId === userId)) return true;
        return false;
    }

    async function loadAuthorizedMatch(principal, matchId, permission) {
        if (!isMatchId(matchId)) {
            return { ok: false, response: fail(APPLICATION_RECOVERY_ERRORS.INVALID_MATCH_ID) };
        }
        const access = await authorize(principal, permission);
        if (!access.ok) return access;
        let loaded;
        try {
            loaded = await recoveryService.loadMatch(matchId);
        } catch {
            return { ok: false, response: fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR) };
        }
        if (!loaded?.ok) {
            return { ok: false, response: mapPersistenceError(loaded) };
        }
        if (!loaded.match) {
            return { ok: false, response: fail(APPLICATION_RECOVERY_ERRORS.MATCH_NOT_FOUND) };
        }
        if (loaded.match.matchId !== matchId) {
            return {
                ok: false,
                response: fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR)
            };
        }
        if (!hasMembership(loaded.match, access.principal.userId)) {
            return { ok: false, response: fail(APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED) };
        }
        return { ok: true, match: loaded.match, principal: access.principal };
    }

    async function recoverMatch(principal, matchId, ...extra) {
        if (extra.length > 0) return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
        if (!isMatchId(matchId)) {
            return fail(APPLICATION_RECOVERY_ERRORS.INVALID_MATCH_ID);
        }
        const access = await authorize(principal, RECOVERY_READ_PERMISSION);
        if (!access.ok) return access.response;
        let loadedMatch;
        try {
            loadedMatch = await recoveryService.loadMatch(matchId);
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!loadedMatch?.ok) {
            if (errorCode(loadedMatch) === 'MATCH_NOT_FOUND') {
                return { ok: true, data: { state: 'NOT_FOUND', matchId } };
            }
            return mapPersistenceError(loadedMatch);
        }
        if (!loadedMatch.match) {
            return { ok: true, data: { state: 'NOT_FOUND', matchId } };
        }
        if (loadedMatch.match.matchId !== matchId) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        if (!hasMembership(loadedMatch.match, access.principal.userId)) {
            return fail(APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);
        }
        let recovery;
        try {
            recovery = await recoveryService.recoverMatch(matchId);
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!recovery?.ok) {
            if (errorCode(recovery) === 'RECOVERY_INCONSISTENT_STATE') {
                return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
            }
            return mapPersistenceError(recovery);
        }
        if (recovery.state === 'NOT_FOUND') return { ok: true, data: { state: 'NOT_FOUND', matchId } };
        if (recovery.state === 'ABORT_REQUIRED') {
            return {
                ...fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_ABORT_REQUIRED),
                data: {
                    state: 'ABORT_REQUIRED',
                    matchId,
                    diagnostic: recovery.diagnostic
                        ? clone(recovery.diagnostic)
                        : null
                }
            };
        }
        const allowedStates = new Set([
            'RECOVERABLE',
            'RESULT_LOCKED',
            'SETTLING',
            'SETTLED'
        ]);
        if (!allowedStates.has(recovery.state) || recovery.match?.matchId !== matchId) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        const data = {
            state: recovery.state,
            matchId,
            ...(recovery.actionRequired ? { actionRequired: recovery.actionRequired } : {}),
            ...(typeof recovery.replayRequired === 'boolean'
                ? { replayRequired: recovery.replayRequired }
                : {}),
            ...(recovery.diagnostic ? { diagnostic: clone(recovery.diagnostic) } : {})
        };
        return { ok: true, data: deepFreeze(data) };
    }

    async function getMatchMetadata(principal, matchId, ...extra) {
        if (extra.length > 0) return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
        const authorized = await loadAuthorizedMatch(
            principal, matchId, RECOVERY_READ_PERMISSION
        );
        if (!authorized.ok) return authorized.response;
        const { match } = authorized;
        const metadata = match.matchPersistence?.metadata;
        if (containsForbidden(metadata || {})) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        let recovery;
        try {
            recovery = await recoveryService.recoverMatch(matchId);
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!recovery?.ok && errorCode(recovery) !== 'RECOVERY_INCONSISTENT_STATE') {
            return mapPersistenceError(recovery);
        }
        if (errorCode(recovery) === 'RECOVERY_INCONSISTENT_STATE') {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        const data = {
            matchId,
            lifecycle: match.status,
            schemaVersion: match.matchPersistence.schemaVersion,
            stateVersion: match.matchPersistence.stateVersion,
            eventSequence: match.matchPersistence.eventSequence,
            resultVersion: match.resultVersion ?? null,
            rulesVersion: match.rulesVersion,
            createdAt: match.matchPersistence.createdAt,
            resultLockedAt: match.matchPersistence.resultLockedAt ?? null,
            metadata: clone(metadata || {}),
            recoveryState: recovery?.state || null
        };
        return { ok: true, data: deepFreeze(data) };
    }

    async function getMatchSnapshot(principal, matchId, ...extra) {
        if (extra.length > 0) return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
        const authorized = await loadAuthorizedMatch(
            principal, matchId, RECOVERY_READ_PERMISSION
        );
        if (!authorized.ok) return authorized.response;
        let loaded;
        try {
            loaded = await recoveryService.loadSnapshot(matchId);
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!loaded?.ok) return mapPersistenceError(loaded);
        if (!loaded.snapshot) return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_NOT_FOUND);
        if (containsForbidden(loaded.snapshot.value) ||
            loaded.snapshot.value?.matchId !== matchId ||
            !validateGameState(loaded.snapshot.value?.gameState).ok ||
            loaded.snapshot.value?.gameState.match.status !== loaded.lifecycle ||
            !Number.isSafeInteger(loaded.snapshot.stateVersion) ||
            loaded.snapshot.stateVersion > loaded.stateVersion ||
            loaded.snapshot.eventSequence > loaded.eventSequence) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        return {
            ok: true,
            data: deepFreeze({
                snapshot: clone(loaded.snapshot),
                lifecycle: loaded.lifecycle,
                stateVersion: loaded.stateVersion,
                eventSequence: loaded.eventSequence
            })
        };
    }

    async function getMatchEvents(principal, matchId, options = {}, ...extra) {
        if (extra.length > 0 ||
            !isRecord(options) ||
            Object.keys(options).some((key) => key !== 'fromSequence') ||
            (options.fromSequence !== undefined &&
                (!Number.isSafeInteger(options.fromSequence) || options.fromSequence < 1))) {
            return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
        }
        const authorized = await loadAuthorizedMatch(
            principal, matchId, RECOVERY_READ_PERMISSION
        );
        if (!authorized.ok) return authorized.response;
        let loaded;
        try {
            loaded = await recoveryService.loadEvents(
                matchId,
                options.fromSequence === undefined ? 1 : options.fromSequence
            );
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!loaded?.ok) return mapPersistenceError(loaded);
        if (!Array.isArray(loaded.events) || containsForbidden(loaded.events)) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        return {
            ok: true,
            data: deepFreeze({
                events: clone(loaded.events),
                eventSequence: loaded.eventSequence
            })
        };
    }

    async function getMatchResult(principal, matchId, ...extra) {
        if (extra.length > 0) return fail(APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
        const authorized = await loadAuthorizedMatch(
            principal, matchId, RESULT_READ_PERMISSION
        );
        if (!authorized.ok) return authorized.response;
        let loaded;
        try {
            loaded = await recoveryService.loadResult(matchId);
        } catch {
            return fail(APPLICATION_RECOVERY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!loaded?.ok) return mapPersistenceError(loaded);
        const match = authorized.match;
        if (!loaded.result) return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_NOT_FOUND);
        if (!loaded.locked ||
            !['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(match.status)) {
            return fail(APPLICATION_RECOVERY_ERRORS.RESULT_NOT_LOCKED);
        }
        if (!validateMatchResult(loaded.result).ok ||
            loaded.result.matchId !== matchId ||
            loaded.result.resultId !== match.result?.resultId ||
            loaded.result.resultHash !== match.result?.resultHash ||
            loaded.resultVersion !== match.resultVersion) {
            return fail(APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);
        }
        return {
            ok: true,
            data: deepFreeze({
                result: clone(loaded.result),
                resultVersion: loaded.resultVersion,
                locked: true
            })
        };
    }

    return Object.freeze({
        recoverMatch,
        getMatchMetadata,
        getMatchSnapshot,
        getMatchEvents,
        getMatchResult
    });
}

module.exports = Object.freeze({
    APPLICATION_RECOVERY_ERRORS,
    createApplicationRecoveryBoundary
});
