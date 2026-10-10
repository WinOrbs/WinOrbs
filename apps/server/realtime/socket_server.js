'use strict';

const { Server } = require('socket.io');
const { SOCKET_IO_DEFAULTS } = require('../config/defaults');

function createSocketServer(server, {
    isOriginAllowed,
    ServerClass = Server,
    socketConfig = SOCKET_IO_DEFAULTS,
    logger
} = {}) {
    if (!server) {
        throw new TypeError('An HTTP server is required');
    }
    if (typeof isOriginAllowed !== 'function') {
        throw new TypeError('An origin policy is required');
    }
    if (typeof ServerClass !== 'function') {
        throw new TypeError('A Socket.IO Server constructor is required');
    }
    if (!socketConfig || !socketConfig.connectionStateRecovery ||
        !Array.isArray(socketConfig.corsMethods) ||
        typeof socketConfig.corsCredentials !== 'boolean') {
        throw new TypeError('A valid Socket.IO configuration is required');
    }

    const socketServer = new ServerClass(server, {
        connectionStateRecovery: { ...socketConfig.connectionStateRecovery },
        cors: {
            origin: (origin, callback) => {
                if (isOriginAllowed(origin)) return callback(null, true);
                return callback(new Error('CORS bloqueado para ' + origin), false);
            },
            methods: [...socketConfig.corsMethods],
            credentials: socketConfig.corsCredentials
        }
    });

    if (logger && typeof logger.warn === 'function' && socketServer.engine &&
        typeof socketServer.engine.on === 'function') {
        let lastConnectionErrorAt = 0;
        socketServer.engine.on('connection_error', () => {
            const now = Date.now();
            if (now - lastConnectionErrorAt < 60_000) return;
            lastConnectionErrorAt = now;
            logger.warn('socket.connection_rejected', {
                errorCode: 'SOCKET_HANDSHAKE_REJECTED'
            });
        });
    }

    return socketServer;
}

module.exports = Object.freeze({ createSocketServer });
