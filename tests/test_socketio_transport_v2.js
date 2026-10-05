'use strict';

const assert = require('assert');
const {
    MATCH_PERMISSIONS,
    createIdentityService
} = require('../packages/identity/v2');
const { createSocketIoTransport } = require('../packages/transport/socketio/v2');

class FakeSocket {
    constructor(auth = {}) {
        this.handshake = { auth };
        this.handlers = new Map();
        this.anyHandler = null;
        this.emitted = [];
        this.disconnected = false;
    }

    on(event, handler) {
        this.handlers.set(event, handler);
    }

    onAny(handler) {
        this.anyHandler = handler;
    }

    emit(event, payload) {
        this.emitted.push({ event, payload });
    }

    disconnect(close) {
        this.disconnected = close;
    }

    async trigger(event, payload, acknowledge = true) {
        const handler = this.handlers.get(event);
        assert.ok(handler, `No listener registered for ${event}`);
        let response;
        const callback = acknowledge ? (value) => { response = value; } : undefined;
        await handler(payload, callback);
        return response;
    }

    triggerUnknown(event, payload = {}) {
        assert.ok(this.anyHandler);
        let response;
        this.anyHandler(event, payload, (value) => { response = value; });
        return response;
    }

    disconnectNow() {
        this.handlers.get('disconnect')();
    }
}

class FakeIo {
    use(middleware) {
        this.middleware = middleware;
    }

    on(event, handler) {
        assert.strictEqual(event, 'connection');
        this.connectionHandler = handler;
    }

    async connect(socket) {
        let middlewareError;
        await this.middleware(socket, (error) => { middlewareError = error || null; });
        if (!middlewareError) this.connectionHandler(socket);
        return middlewareError;
    }
}

let now = 1000;
const identity = createIdentityService({
    authenticate: async (credential) => {
        if (credential === 'valid') {
            return {
                userId: 'player-1',
                provider: 'test',
                sessionId: 'session-1',
                expiresAt: now + 10000
            };
        }
        if (credential === 'expired') {
            return {
                userId: 'player-1',
                provider: 'test',
                sessionId: 'session-1',
                expiresAt: now
            };
        }
        return null;
    },
    resolveAuthorization: async () => ({
        roles: ['player'],
        permissions: [...MATCH_PERMISSIONS]
    }),
    validateSession: async () => true,
    clock: () => now
});

const calls = [];
const application = Object.fromEntries([
    'joinMatch',
    'leaveMatch',
    'markReady',
    'submitGameCommand',
    'getMatchSnapshot',
    'getMatchEvents'
].map((method) => [method, async (request) => {
    calls.push({ method, request });
    return { ok: true, snapshot: { method } };
}]));
const io = new FakeIo();
const transport = createSocketIoTransport({ io, identity, application });

async function run() {
    for (const [auth, expectedCode] of [
        [{}, 'AUTHENTICATION_REQUIRED'],
        [{ credential: 'expired' }, 'AUTHENTICATION_EXPIRED'],
        [{ credential: 'invalid' }, 'AUTHENTICATION_REQUIRED']
    ]) {
        const socket = new FakeSocket(auth);
        const error = await io.connect(socket);
        assert.ok(error);
        assert.deepStrictEqual(error.data, {
            ok: false,
            error: {
                code: expectedCode,
                message: expectedCode === 'AUTHENTICATION_EXPIRED'
                    ? 'Authentication has expired.'
                    : 'Authentication is required.'
            }
        });
        assert.strictEqual(transport.getAuthenticatedPrincipal(socket), null);
    }

    const socket = new FakeSocket({
        credential: 'valid',
        userId: 'forged-user',
        actorId: 'forged-actor',
        sessionId: 'forged-session',
        roles: ['admin'],
        permissions: ['match.finish']
    });
    assert.strictEqual(await io.connect(socket), null);
    const principal = transport.getAuthenticatedPrincipal(socket);
    assert.strictEqual(principal.userId, 'player-1');
    assert.strictEqual(principal.sessionId, 'session-1');
    assert.deepStrictEqual(principal.roles, ['player']);
    assert.deepStrictEqual(principal.permissions, [...MATCH_PERMISSIONS]);

    const cases = [
        ['match:join', { matchId: 'match-1' }, 'joinMatch'],
        ['match:leave', {}, 'leaveMatch'],
        ['match:ready', {}, 'markReady'],
        ['match:snapshot', {}, 'getMatchSnapshot'],
        ['match:events', {}, 'getMatchEvents']
    ];
    for (const [event, payload, method] of cases) {
        const response = await socket.trigger(event, payload);
        assert.deepStrictEqual(response, {
            ok: true,
            data: { snapshot: { method } }
        });
        const call = calls.at(-1);
        assert.strictEqual(call.method, method);
        assert.strictEqual(call.request.principal, principal);
        assert.strictEqual(call.request.sessionId, principal.sessionId);
    }

    const command = {
        schemaVersion: '2.0',
        commandId: 'command-1',
        sessionId: principal.sessionId,
        matchId: 'match-1',
        actorId: principal.userId,
        sequence: 1,
        type: 'MovePlayer',
        payload: { direction: { x: 1, y: 0 } }
    };
    const commandResponse = await socket.trigger('game:command', {
        matchId: 'match-1',
        command
    });
    assert.strictEqual(commandResponse.ok, true);
    assert.strictEqual(calls.at(-1).method, 'submitGameCommand');
    assert.strictEqual(calls.at(-1).request.command, command);

    assert.strictEqual((await socket.trigger('match:join', {
        actorId: 'another-player'
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('match:join', {
        userId: 'another-player'
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('match:join', {
        sessionId: 'forged-session'
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('match:join', {
        roles: ['admin']
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('match:join', {
        permissions: ['match.finish']
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('game:command', {
        command: { ...command, actorId: 'forged-actor' }
    })).error.code, 'ACTOR_MISMATCH');
    assert.strictEqual((await socket.trigger('game:command', {
        command: { ...command, sessionId: 'forged-session' }
    })).error.code, 'SESSION_MISMATCH');
    assert.strictEqual((await socket.trigger('game:command', {
        command: { ...command, permissions: ['match.finish'] }
    })).error.code, 'INVALID_PAYLOAD');
    assert.strictEqual((await socket.trigger('match:ready', [])).error.code,
        'INVALID_PAYLOAD');

    assert.strictEqual(socket.triggerUnknown('startMatch').error.code,
        'SYSTEM_OPERATION_FORBIDDEN');
    assert.strictEqual(socket.triggerUnknown('match:finishMatch').error.code,
        'SYSTEM_OPERATION_FORBIDDEN');
    assert.strictEqual(socket.triggerUnknown('made:up:event').error.code,
        'EVENT_NOT_SUPPORTED');
    assert.strictEqual(calls.some(({ method }) =>
        ['startCountdown', 'startMatch', 'finishMatch', 'lockResult'].includes(method)), false);

    const beforeDisconnect = calls.length;
    socket.disconnectNow();
    assert.strictEqual(transport.getAuthenticatedPrincipal(socket), null);
    assert.strictEqual(calls.length, beforeDisconnect);

    const noAckSocket = new FakeSocket({ credential: 'valid' });
    assert.strictEqual(await io.connect(noAckSocket), null);
    await noAckSocket.trigger('match:join', {}, false);
    assert.deepStrictEqual(noAckSocket.emitted.at(-1), {
        event: 'transport:response',
        payload: {
            event: 'match:join',
            ok: true,
            data: { snapshot: { method: 'joinMatch' } }
        }
    });

}

run().then(() => {
    console.log('Socket.IO transport v2 tests passed');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
