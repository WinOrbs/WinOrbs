'use strict';

const assert = require('assert');

const original = {
    adminPassword: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    corsOrigin: process.env.CORS_ORIGIN
};

delete process.env.ADMIN_PASSWORD;
process.env.NODE_ENV = 'production';
delete process.env.CORS_ORIGIN;

const configPath = require.resolve('../apps/server/config');
delete require.cache[configPath];

const config = require('../apps/server/config');

assert.strictEqual(
    config.adminPassword,
    '',
    'ADMIN_PASSWORD must not have a source-code fallback'
);
assert.strictEqual(
    config.corsRaw.length,
    0,
    'production CORS must require explicit configuration'
);
assert.strictEqual(
    config.isOriginAllowed('https://example.com'),
    false,
    'unconfigured production origins must not be implicitly allowed'
);

if (original.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
else process.env.ADMIN_PASSWORD = original.adminPassword;

if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = original.nodeEnv;

if (original.corsOrigin === undefined) delete process.env.CORS_ORIGIN;
else process.env.CORS_ORIGIN = original.corsOrigin;

console.log('OK security config: no admin password fallback; production requires explicit CORS.');
