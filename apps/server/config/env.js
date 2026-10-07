'use strict';

const {
    ENVIRONMENTS,
    SERVER_DEFAULTS,
    CORS_DEFAULTS,
    LIMIT_DEFAULTS,
    TIMING_DEFAULTS,
    SOCKET_IO_DEFAULTS,
    FIREBASE_DEFAULTS
} = require('./defaults');

function configurationError(name, expectation) {
    return new Error(`Invalid configuration: ${name} ${expectation}.`);
}

function readInteger(env, name, fallback, { min, max } = {}) {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
        throw configurationError(name, 'must be a valid integer');
    }
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        const expectation = min !== undefined && max !== undefined
            ? `must be between ${min} and ${max}`
            : min !== undefined
                ? `must be at least ${min}`
                : `must be no greater than ${max}`;
        throw configurationError(name, expectation);
    }
    return value;
}

function readProxyTrust(env) {
    const raw = env.TRUST_PROXY;
    if (raw === undefined || String(raw).trim() === '') return SERVER_DEFAULTS.trustProxy;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (/^\d+$/.test(normalized)) {
        const value = Number(normalized);
        if (Number.isSafeInteger(value)) return value;
    }
    throw configurationError('TRUST_PROXY', 'must be true, false, or a non-negative integer');
}

function readEnvironment(env) {
    const value = String(env.NODE_ENV || 'development').trim().toLowerCase();
    if (!ENVIRONMENTS.includes(value)) {
        throw configurationError('NODE_ENV', 'must be development, test, or production');
    }
    return value;
}

function readCorsOrigins(env, environment) {
    const raw = env.CORS_ORIGIN;
    if (raw === undefined || String(raw).trim() === '') {
        if (environment === 'production') {
            throw configurationError('CORS_ORIGIN', 'is required in production');
        }
        return [...CORS_DEFAULTS[environment]];
    }

    const origins = String(raw).split(',').map((origin) => origin.trim()).filter(Boolean);
    if (origins.length === 0) {
        if (environment === 'production') {
            throw configurationError('CORS_ORIGIN', 'is required in production');
        }
        return [...CORS_DEFAULTS[environment]];
    }
    if (origins.includes('*')) {
        if (origins.length !== 1 || environment === 'production') {
            throw configurationError('CORS_ORIGIN', 'cannot combine wildcard origins or use a wildcard in production');
        }
        return origins;
    }

    for (const origin of origins) {
        let parsed;
        try {
            parsed = new URL(origin);
        } catch (error) {
            throw configurationError('CORS_ORIGIN', 'must contain valid HTTP(S) origins');
        }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
            throw configurationError('CORS_ORIGIN', 'must contain valid HTTP(S) origins without paths');
        }
    }
    return origins;
}

function createConfig(env = process.env) {
    if (!env || typeof env !== 'object') {
        throw new TypeError('Environment configuration must be an object.');
    }

    const environment = readEnvironment(env);
    const corsOrigins = readCorsOrigins(env, environment);
    const corsAllowAll = corsOrigins.includes('*');
    const server = Object.freeze({
        port: readInteger(env, 'PORT', SERVER_DEFAULTS.port, { min: 1, max: 65_535 }),
        host: SERVER_DEFAULTS.host,
        trustProxy: readProxyTrust(env)
    });
    const prizeReconciliationIntervalMs = readInteger(
        env,
        'PREMIOS_AUTO_MS',
        TIMING_DEFAULTS.prizeReconciliationIntervalMs,
        { min: TIMING_DEFAULTS.prizeReconciliationMinimumMs }
    );
    const cors = Object.freeze({
        origins: Object.freeze(corsOrigins),
        allowAll: corsAllowAll,
        isOriginAllowed(origin) {
            if (!origin) return true;
            return (corsAllowAll && environment !== 'production') || corsOrigins.includes(origin);
        }
    });
    const googleApplicationCredentials = String(env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    const serviceAccount = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    const serviceAccountBase64 = String(env.FIREBASE_SERVICE_ACCOUNT_B64 || '').trim();
    const firebase = Object.freeze({
        googleApplicationCredentials,
        serviceAccount,
        serviceAccountBase64,
        serviceAccountFileName: FIREBASE_DEFAULTS.serviceAccountFileName,
        secretDirectory: FIREBASE_DEFAULTS.secretDirectory,
        credentialSource: googleApplicationCredentials
            ? 'application-default'
            : serviceAccountBase64
                ? 'base64'
                : serviceAccount
                    ? 'service-account'
                    : 'automatic'
    });
    const config = {
        environment,
        isProduction: environment === 'production',
        isDevelopment: environment === 'development',
        isTest: environment === 'test',
        server,
        cors,
        socketIO: Object.freeze({
            connectionStateRecovery: Object.freeze({
                ...SOCKET_IO_DEFAULTS.connectionStateRecovery
            }),
            corsMethods: Object.freeze([...SOCKET_IO_DEFAULTS.corsMethods]),
            corsCredentials: SOCKET_IO_DEFAULTS.corsCredentials
        }),
        limits: Object.freeze({ ...LIMIT_DEFAULTS }),
        timing: Object.freeze({
            ...TIMING_DEFAULTS,
            shootCooldownMs: Object.freeze({ ...TIMING_DEFAULTS.shootCooldownMs }),
            prizeReconciliationIntervalMs
        }),
        firebase,
        adminPassword: String(env.ADMIN_PASSWORD || '').trim(),
        telegram: Object.freeze({
            botToken: String(env.TELEGRAM_BOT_TOKEN || ''),
            chatId: String(env.TELEGRAM_CHAT_ID || '')
        })
    };
    return Object.freeze(config);
}

module.exports = Object.freeze({ createConfig });
