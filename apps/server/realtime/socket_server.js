'use strict';

const { Server } = require('socket.io');
const { SOCKET_IO_DEFAULTS } = require('../config/defaults');

function createSocketServer(server, {
    isOriginAllowed,
    ServerClass = Server,
    socketConfig = SOCKET_IO_DEFAULTS
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

    return new ServerClass(server, {
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
}

module.exports = Object.freeze({ createSocketServer });
