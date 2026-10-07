'use strict';

const { Server } = require('socket.io');

function createSocketServer(server, { isOriginAllowed, ServerClass = Server } = {}) {
    if (!server) {
        throw new TypeError('An HTTP server is required');
    }
    if (typeof isOriginAllowed !== 'function') {
        throw new TypeError('An origin policy is required');
    }
    if (typeof ServerClass !== 'function') {
        throw new TypeError('A Socket.IO Server constructor is required');
    }

    return new ServerClass(server, {
        connectionStateRecovery: {
            maxDisconnectionDuration: 120_000,
            skipMiddlewares: false
        },
        cors: {
            origin: (origin, callback) => {
                if (isOriginAllowed(origin)) return callback(null, true);
                return callback(new Error('CORS bloqueado para ' + origin), false);
            },
            methods: ['GET', 'POST'],
            credentials: true
        }
    });
}

module.exports = Object.freeze({ createSocketServer });
