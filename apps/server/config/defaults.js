'use strict';

const ENVIRONMENTS = Object.freeze(['development', 'test', 'production']);

const SERVER_DEFAULTS = Object.freeze({
    port: 3000,
    host: '0.0.0.0',
    trustProxy: 1
});

const CORS_DEFAULTS = Object.freeze({
    development: Object.freeze(['*']),
    test: Object.freeze(['*'])
});

const LIMIT_DEFAULTS = Object.freeze({
    maxSocketsPerIp: 3,
    inputMinIntervalMs: 8
});

const TIMING_DEFAULTS = Object.freeze({
    adminSessionMs: 30 * 60 * 1000,
    disconnectGraceMs: 125_000,
    shootCooldownMs: Object.freeze({ 1: 120, 2: 400, 3: 500 }),
    bombCooldownMs: 400,
    reloadTicks: 150,
    ticksPerEmission: 2,
    prizeReconciliationIntervalMs: 2 * 60 * 1000,
    prizeReconciliationMinimumMs: 60_000
});

const SOCKET_IO_DEFAULTS = Object.freeze({
    connectionStateRecovery: Object.freeze({
        maxDisconnectionDuration: 120_000,
        skipMiddlewares: false
    }),
    corsMethods: Object.freeze(['GET', 'POST']),
    corsCredentials: true
});

const FIREBASE_DEFAULTS = Object.freeze({
    serviceAccountFileName: 'serviceAccountKey.json',
    secretDirectory: '/etc/secrets'
});

module.exports = Object.freeze({
    ENVIRONMENTS,
    SERVER_DEFAULTS,
    CORS_DEFAULTS,
    LIMIT_DEFAULTS,
    TIMING_DEFAULTS,
    SOCKET_IO_DEFAULTS,
    FIREBASE_DEFAULTS
});
