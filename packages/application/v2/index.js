'use strict';

const { validateGameCommand } = require('../../contracts/v2/validation');
const {
    IDENTITY_ERRORS
} = require('../../identity/v2');

const APPLICATION_ERRORS = Object.freeze({
    ...IDENTITY_ERRORS,
    ACTOR_MISMATCH: 'ACTOR_MISMATCH',
    SESSION_MISMATCH: 'SESSION_MISMATCH',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    MATCH_ACCESS_DENIED: 'MATCH_ACCESS_DENIED',
    SYSTEM_OPERATION_REQUIRED: 'SYSTEM_OPERATION_REQUIRED',
    INVALID_APPLICATION_OPERATION: 'INVALID_APPLICATION_OPERATION',
    MATCH_RESULT_LOCKED: 'MATCH_RESULT_LOCKED'
});

const PLAYER_OPERATIONS = Object.freeze({
    joinMatch: 'match.join',
    leaveMatch: 'match.leave',
    markReady: 'match.ready',
    reassociatePlayerSession: 'match.join',
    submitGameCommand: 'match.command',
    getMatchSnapshot: 'match.view',
    getMatchEvents: 'match.view'
});

const SYSTEM_ACTIONS = Object.freeze({
    startCountdown: 'startCountdown',
    startMatch: 'startMatch',
    finishMatch: 'finishMatch',
    lockResult: 'lockResult'
});

function failure(code, details = {}) {
    return { ok: false, error: { code, ...details } };
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createApplicationBoundary({ identity, coordinator, matchId } = {}) {
    if (!identity || typeof identity.requirePermission !== 'function' ||
        typeof identity.consumeSystemOperation !== 'function' ||
        !coordinator || typeof coordinator.getSnapshot !== 'function' ||
        typeof coordinator.addPlayer !== 'function' ||
        typeof coordinator.reassociatePlayerSession !== 'function' ||
        typeof coordinator.removePlayer !== 'function' ||
        typeof coordinator.markReady !== 'function' ||
        typeof coordinator.submitCommand !== 'function' ||
        typeof coordinator.getEvents !== 'function' ||
        typeof coordinator.startCountdown !== 'function' ||
        typeof coordinator.startMatch !== 'function' ||
        typeof coordinator.finishMatch !== 'function' ||
        typeof coordinator.getResult !== 'function' ||
        typeof matchId !== 'string' || !matchId.trim()) {
        throw new TypeError('Identity, Match Coordinator, and matchId are required');
    }

    async function authorizePlayer(request, permission, options = {}) {
        if (!isRecord(request)) return failure(APPLICATION_ERRORS.AUTHENTICATION_REQUIRED);
        const authorized = await identity.requirePermission(request.principal, permission);
        if (!authorized.ok) return authorized;
        const principal = authorized.principal;
        if (request.sessionId !== principal.sessionId) {
            return failure(APPLICATION_ERRORS.SESSION_MISMATCH);
        }
        if (request.matchId !== undefined && request.matchId !== matchId) {
            return failure(APPLICATION_ERRORS.RESOURCE_NOT_FOUND);
        }
        if (request.actorId !== undefined && request.actorId !== principal.userId) {
            return failure(APPLICATION_ERRORS.ACTOR_MISMATCH);
        }
        if (options.requireMembership) {
            const current = coordinator.getSnapshot();
            if (!current.ok) return failure(APPLICATION_ERRORS.RESOURCE_NOT_FOUND);
            if (!current.snapshot.memberActorIds.includes(principal.userId)) {
                return failure(APPLICATION_ERRORS.MATCH_ACCESS_DENIED);
            }
        }
        return { ok: true, principal };
    }

    function mapCoordinatorError(response) {
        if (response.ok) return response;
        if (response.error.code === 'MATCH_NOT_FOUND') {
            return failure(APPLICATION_ERRORS.RESOURCE_NOT_FOUND);
        }
        if (response.error.code === 'PLAYER_NOT_MEMBER') {
            return failure(APPLICATION_ERRORS.MATCH_ACCESS_DENIED);
        }
        if (response.error.code === 'MATCH_RESULT_LOCKED') {
            return failure(APPLICATION_ERRORS.MATCH_RESULT_LOCKED);
        }
        if (response.error.code === 'SESSION_MISMATCH') {
            return failure(APPLICATION_ERRORS.SESSION_MISMATCH);
        }
        return failure(APPLICATION_ERRORS.INVALID_APPLICATION_OPERATION, {
            cause: response.error.code
        });
    }

    async function joinMatch(request) {
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.joinMatch);
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.addPlayer(
            access.principal.userId,
            access.principal.sessionId
        ));
    }

    async function leaveMatch(request) {
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.leaveMatch, {
            requireMembership: true
        });
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.removePlayer(
            access.principal.userId,
            access.principal.sessionId
        ));
    }

    async function markReady(request) {
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.markReady, {
            requireMembership: true
        });
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.markReady(
            access.principal.userId,
            access.principal.sessionId
        ));
    }

    async function reassociatePlayerSession(request) {
        const access = await authorizePlayer(
            request,
            PLAYER_OPERATIONS.reassociatePlayerSession,
            { requireMembership: true }
        );
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.reassociatePlayerSession(
            matchId,
            access.principal.userId,
            access.principal.sessionId
        ));
    }

    async function submitGameCommand(request) {
        if (!isRecord(request) || !isRecord(request.command)) {
            return failure(APPLICATION_ERRORS.INVALID_APPLICATION_OPERATION);
        }
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.submitGameCommand, {
            requireMembership: true
        });
        if (!access.ok) return access;
        const principal = access.principal;
        if (request.command.actorId !== principal.userId) {
            return failure(APPLICATION_ERRORS.ACTOR_MISMATCH);
        }
        if (request.command.sessionId !== principal.sessionId) {
            return failure(APPLICATION_ERRORS.SESSION_MISMATCH);
        }
        if (request.command.matchId !== matchId) {
            return failure(APPLICATION_ERRORS.RESOURCE_NOT_FOUND);
        }
        const validation = validateGameCommand(request.command);
        if (!validation.ok) {
            return failure(APPLICATION_ERRORS.INVALID_APPLICATION_OPERATION, {
                cause: validation.error.code
            });
        }
        const normalizedCommand = {
            ...request.command,
            actorId: principal.userId,
            sessionId: principal.sessionId,
            matchId
        };
        return mapCoordinatorError(coordinator.submitCommand(normalizedCommand));
    }

    async function getMatchSnapshot(request) {
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.getMatchSnapshot, {
            requireMembership: true
        });
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.getSnapshot());
    }

    async function getMatchEvents(request) {
        const access = await authorizePlayer(request, PLAYER_OPERATIONS.getMatchEvents, {
            requireMembership: true
        });
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.getEvents());
    }

    async function authorizeSystem(authority, operation) {
        const authorized = identity.consumeSystemOperation(authority, operation);
        if (!authorized.ok) {
            return failure(APPLICATION_ERRORS.SYSTEM_OPERATION_REQUIRED);
        }
        return { ok: true };
    }

    async function startCountdown(request = {}) {
        const authority = isRecord(request) ? request.authority : null;
        const access = await authorizeSystem(authority, SYSTEM_ACTIONS.startCountdown);
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.startCountdown());
    }

    async function startMatch(request = {}) {
        const authority = isRecord(request) ? request.authority : null;
        const access = await authorizeSystem(authority, SYSTEM_ACTIONS.startMatch);
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.startMatch());
    }

    async function finishMatch(request = {}) {
        const authority = isRecord(request) ? request.authority : null;
        const access = await authorizeSystem(authority, SYSTEM_ACTIONS.finishMatch);
        if (!access.ok) return access;
        return mapCoordinatorError(coordinator.finishMatch(request.finishReason));
    }

    async function lockResult(request = {}) {
        const authority = isRecord(request) ? request.authority : null;
        const access = await authorizeSystem(authority, SYSTEM_ACTIONS.lockResult);
        if (!access.ok) return access;
        const current = coordinator.getSnapshot();
        if (!current.ok) return failure(APPLICATION_ERRORS.RESOURCE_NOT_FOUND);
        if (current.snapshot.status !== 'RESULT_LOCKED') {
            return failure(APPLICATION_ERRORS.INVALID_APPLICATION_OPERATION, {
                reason: 'RESULT_NOT_LOCKED'
            });
        }
        return mapCoordinatorError(coordinator.getResult());
    }

    return Object.freeze({
        joinMatch,
        leaveMatch,
        markReady,
        reassociatePlayerSession,
        submitGameCommand,
        getMatchSnapshot,
        getMatchEvents,
        startCountdown,
        startMatch,
        finishMatch,
        lockResult
    });
}

module.exports = Object.freeze({
    APPLICATION_ERRORS,
    createApplicationBoundary
});
