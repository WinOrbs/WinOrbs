'use strict';

const { validateGameCommand } = require('../../../contracts/v2/validation');

const CLIENT_EVENTS = Object.freeze({
    'match:join': 'joinMatch',
    'match:leave': 'leaveMatch',
    'match:ready': 'markReady',
    'game:command': 'submitGameCommand',
    'match:snapshot': 'getMatchSnapshot',
    'match:events': 'getMatchEvents'
});

const SYSTEM_EVENTS = new Set([
    'startCountdown',
    'startMatch',
    'finishMatch',
    'lockResult',
    'match:startCountdown',
    'match:startMatch',
    'match:finishMatch',
    'match:lockResult',
    'match:start',
    'match:finish',
    'match:result:lock'
]);

const ERROR_MESSAGES = Object.freeze({
    AUTHENTICATION_REQUIRED: 'Authentication is required.',
    AUTHENTICATION_EXPIRED: 'Authentication has expired.',
    AUTHORIZATION_DENIED: 'This operation is not permitted.',
    ACTOR_MISMATCH: 'The actor does not match the authenticated user.',
    SESSION_MISMATCH: 'The session does not match the authenticated session.',
    RESOURCE_NOT_FOUND: 'The requested resource was not found.',
    MATCH_ACCESS_DENIED: 'Access to this match is not permitted.',
    INVALID_APPLICATION_OPERATION: 'The operation is invalid.',
    MATCH_RESULT_LOCKED: 'The match result is locked.',
    SYSTEM_OPERATION_REQUIRED: 'This operation is restricted to the system.',
    INVALID_PAYLOAD: 'The event payload is invalid.',
    EVENT_NOT_SUPPORTED: 'The event is not supported.',
    SYSTEM_OPERATION_FORBIDDEN: 'This operation is restricted to the system.',
    INTERNAL_ERROR: 'The request could not be completed.'
});

const FORBIDDEN_CLAIM_KEYS = new Set([
    'userId',
    'actorId',
    'sessionId',
    'roles',
    'permissions'
]);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorResponse(code) {
    const safeCode = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
        ? code
        : 'INTERNAL_ERROR';
    return {
        ok: false,
        error: {
            code: safeCode,
            message: ERROR_MESSAGES[safeCode]
        }
    };
}

function successResponse(result) {
    if (!isRecord(result) || result.ok !== true) return errorResponse('INTERNAL_ERROR');
    const { ok, ...data } = result;
    return { ok: true, data };
}

function hasForbiddenClaims(value) {
    return Object.keys(value).some((key) => FORBIDDEN_CLAIM_KEYS.has(key));
}

function requestForEvent(event, payload, principal) {
    if (payload === undefined || payload === null) payload = {};
    if (!isRecord(payload) || hasForbiddenClaims(payload)) {
        return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
    }

    if (event === 'game:command') {
        if (Object.keys(payload).some((key) => !['command', 'matchId'].includes(key)) ||
            !isRecord(payload.command)) {
            return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
        }

        const command = payload.command;
        if (['userId', 'roles', 'permissions'].some((key) =>
            Object.prototype.hasOwnProperty.call(command, key))) {
            return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
        }
        if (payload.matchId !== undefined &&
            (typeof payload.matchId !== 'string' || !payload.matchId.trim() ||
                payload.matchId.length > 128)) {
            return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
        }
        if (command.actorId !== principal.userId) {
            return { ok: false, response: errorResponse('ACTOR_MISMATCH') };
        }
        if (command.sessionId !== principal.sessionId) {
            return { ok: false, response: errorResponse('SESSION_MISMATCH') };
        }
        if (!validateGameCommand(command).ok) {
            return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
        }

        return {
            ok: true,
            request: {
                principal,
                sessionId: principal.sessionId,
                ...(payload.matchId === undefined ? {} : { matchId: payload.matchId }),
                command
            }
        };
    }

    if (Object.keys(payload).some((key) => key !== 'matchId')) {
        return { ok: false, response: errorResponse('INVALID_PAYLOAD') };
    }

    return {
        ok: true,
        request: {
            principal,
            sessionId: principal.sessionId,
            ...(payload.matchId === undefined ? {} : { matchId: payload.matchId })
        }
    };
}

function createSocketIoTransport({ io, identity, application } = {}) {
    if (!io || typeof io.use !== 'function' || typeof io.on !== 'function' ||
        !identity || typeof identity.authenticate !== 'function' ||
        !application ||
        Object.values(CLIENT_EVENTS).some((method) => typeof application[method] !== 'function')) {
        throw new TypeError('Socket.IO, Identity, and Application dependencies are required');
    }

    const principalsBySocket = new WeakMap();

    function respond(socket, event, callback, response) {
        if (typeof callback === 'function') {
            callback(response);
        } else {
            socket.emit('transport:response', { event, ...response });
        }
    }

    io.use(async (socket, next) => {
        try {
            const auth = socket?.handshake?.auth;
            if (!isRecord(auth) || typeof auth.credential !== 'string' ||
                !auth.credential.trim()) {
                const error = new Error(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
                error.data = errorResponse('AUTHENTICATION_REQUIRED');
                next(error);
                return;
            }

            const authenticated = await identity.authenticate({
                credential: auth.credential
            });
            if (!isRecord(authenticated) || authenticated.ok !== true ||
                !isRecord(authenticated.principal)) {
                const code = authenticated?.error?.code === 'AUTHENTICATION_EXPIRED'
                    ? 'AUTHENTICATION_EXPIRED'
                    : 'AUTHENTICATION_REQUIRED';
                const error = new Error(ERROR_MESSAGES[code]);
                error.data = errorResponse(code);
                next(error);
                return;
            }

            principalsBySocket.set(socket, authenticated.principal);
            next();
        } catch {
            const error = new Error(ERROR_MESSAGES.INTERNAL_ERROR);
            error.data = errorResponse('INTERNAL_ERROR');
            next(error);
        }
    });

    io.on('connection', (socket) => {
        const principal = principalsBySocket.get(socket);
        if (!principal) {
            socket.disconnect(true);
            return;
        }

        for (const [event, method] of Object.entries(CLIENT_EVENTS)) {
            socket.on(event, async (payload, callback) => {
                if (typeof payload === 'function') {
                    callback = payload;
                    payload = undefined;
                }

                const prepared = requestForEvent(event, payload, principal);
                if (!prepared.ok) {
                    respond(socket, event, callback, prepared.response);
                    return;
                }

                try {
                    const result = await application[method](prepared.request);
                    respond(socket, event, callback, result?.ok === true
                        ? successResponse(result)
                        : errorResponse(result?.error?.code));
                } catch {
                    respond(socket, event, callback, errorResponse('INTERNAL_ERROR'));
                }
            });
        }

        if (typeof socket.onAny === 'function') {
            socket.onAny((event, ...args) => {
                if (Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, event)) return;
                const callback = typeof args[args.length - 1] === 'function'
                    ? args[args.length - 1]
                    : null;
                const code = SYSTEM_EVENTS.has(event)
                    ? 'SYSTEM_OPERATION_FORBIDDEN'
                    : 'EVENT_NOT_SUPPORTED';
                respond(socket, event, callback, errorResponse(code));
            });
        }

        socket.on('disconnect', () => {
            principalsBySocket.delete(socket);
        });
    });

    return Object.freeze({
        getAuthenticatedPrincipal(socket) {
            return principalsBySocket.get(socket) || null;
        }
    });
}

module.exports = Object.freeze({
    CLIENT_EVENTS,
    createSocketIoTransport
});
