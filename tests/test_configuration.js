'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createConfig } = require('../apps/server/config/env');
const {
    SERVER_DEFAULTS,
    LIMIT_DEFAULTS,
    TIMING_DEFAULTS,
    SOCKET_IO_DEFAULTS
} = require('../apps/server/config/defaults');

function assertConfigError(environment, message) {
    const credential = String(environment.FIREBASE_SERVICE_ACCOUNT || '');
    assert.throws(
        () => createConfig(environment),
        (error) => error instanceof Error &&
            error.message.includes(message) &&
            (!credential || !error.message.includes(credential))
    );
}

const development = createConfig({});
assert.strictEqual(development.environment, 'development');
assert.strictEqual(development.isDevelopment, true);
assert.strictEqual(development.isTest, false);
assert.strictEqual(development.server.port, SERVER_DEFAULTS.port);
assert.strictEqual(development.server.host, SERVER_DEFAULTS.host);
assert.strictEqual(development.server.trustProxy, SERVER_DEFAULTS.trustProxy);
assert.deepStrictEqual(development.cors.origins, ['*']);
assert.strictEqual(development.cors.allowAll, true);
assert.strictEqual(development.cors.isOriginAllowed('https://dev.example'), true);

const testConfig = createConfig({ NODE_ENV: 'test' });
assert.strictEqual(testConfig.environment, 'test');
assert.strictEqual(testConfig.isTest, true);
assert.deepStrictEqual(testConfig.cors.origins, ['*']);
assert.strictEqual(testConfig.timing.prizeReconciliationIntervalMs,
    TIMING_DEFAULTS.prizeReconciliationIntervalMs);

const production = createConfig({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://winorbs.example,https://admin.winorbs.example',
    PORT: '8443',
    TRUST_PROXY: 'false',
    PREMIOS_AUTO_MS: '90000',
    ADMIN_PASSWORD: 'never-log-this',
    TELEGRAM_BOT_TOKEN: 'bot-secret',
    FIREBASE_SERVICE_ACCOUNT: '{"client_email":"private@example.test"}'
});
assert.strictEqual(production.isProduction, true);
assert.strictEqual(production.server.port, 8443);
assert.strictEqual(production.server.trustProxy, false);
assert.deepStrictEqual(production.cors.origins, [
    'https://winorbs.example',
    'https://admin.winorbs.example'
]);
assert.strictEqual(production.cors.isOriginAllowed('https://winorbs.example'), true);
assert.strictEqual(production.cors.isOriginAllowed('https://attacker.example'), false);
assert.strictEqual(production.timing.prizeReconciliationIntervalMs, 90_000);
assert.strictEqual(production.firebase.serviceAccount, '{"client_email":"private@example.test"}');
assert.strictEqual(production.firebase.credentialSource, 'service-account');
assert.strictEqual(production.firebase.serviceAccountFileName, 'serviceAccountKey.json');
assert.strictEqual(production.telegram.botToken, 'bot-secret');
assert.strictEqual(production.adminPassword, 'never-log-this');
assert.strictEqual(
    createConfig({ GOOGLE_APPLICATION_CREDENTIALS: '/credentials/application.json' })
        .firebase.credentialSource,
    'application-default'
);
assert.strictEqual(
    createConfig({ FIREBASE_SERVICE_ACCOUNT_B64: 'encoded' }).firebase.credentialSource,
    'base64'
);
assert.strictEqual(createConfig({ NODE_ENV: 'test' }).firebase.credentialSource, 'automatic');

const proxyConfig = createConfig({
    NODE_ENV: 'test',
    TRUST_PROXY: '2'
});
assert.strictEqual(proxyConfig.server.trustProxy, 2);
assert.strictEqual(createConfig({ TRUST_PROXY: 'true' }).server.trustProxy, true);

assertConfigError({ NODE_ENV: 'production' }, 'CORS_ORIGIN is required');
assertConfigError({
    NODE_ENV: 'production',
    CORS_ORIGIN: '*'
}, 'CORS_ORIGIN');
assertConfigError({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://allowed.example, *'
}, 'CORS_ORIGIN');
assertConfigError({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://allowed.example/path'
}, 'CORS_ORIGIN');
assertConfigError({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'ftp://allowed.example'
}, 'CORS_ORIGIN');
assertConfigError({ NODE_ENV: 'staging' }, 'NODE_ENV');
assertConfigError({ PORT: 'not-a-port' }, 'PORT');
assertConfigError({ PORT: '65536' }, 'PORT');
assertConfigError({ PORT: '0' }, 'PORT');
assertConfigError({ TRUST_PROXY: '-1' }, 'TRUST_PROXY');
assertConfigError({ TRUST_PROXY: 'yes' }, 'TRUST_PROXY');
assertConfigError({ TRUST_PROXY: '99999999999999999999' }, 'TRUST_PROXY');
assertConfigError({ PREMIOS_AUTO_MS: '59999' }, 'PREMIOS_AUTO_MS');
assertConfigError({ PREMIOS_AUTO_MS: 'not-a-duration' }, 'PREMIOS_AUTO_MS');

const secret = 'do-not-include-this-credential-in-errors';
assertConfigError({
    PORT: 'invalid',
    FIREBASE_SERVICE_ACCOUNT: secret,
    ADMIN_PASSWORD: secret
}, 'PORT');

const startupWithoutProductionCors = spawnSync(
    process.execPath,
    ['-e', "require('./apps/server/config')"],
    {
        cwd: path.join(__dirname, '..'),
        env: { NODE_ENV: 'production' },
        encoding: 'utf8'
    }
);
assert.notStrictEqual(startupWithoutProductionCors.status, 0);
assert.match(
    startupWithoutProductionCors.stderr,
    /CORS_ORIGIN is required in production/,
    'production config import must fail fast when CORS is omitted'
);

assert.strictEqual(
    development.socketIO.connectionStateRecovery.maxDisconnectionDuration,
    SOCKET_IO_DEFAULTS.connectionStateRecovery.maxDisconnectionDuration
);
assert.deepStrictEqual(development.socketIO.corsMethods, ['GET', 'POST']);
assert.deepStrictEqual(development.limits, LIMIT_DEFAULTS);
assert.ok(Object.isFrozen(development));
assert.ok(Object.isFrozen(development.socketIO));

console.log('OK configuration: environments, validation, CORS, proxy, Firebase, timing, and limits.');
