'use strict';

const assert = require('assert');

const original = process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_PASSWORD;

const configPath = require.resolve('../apps/server/config');
delete require.cache[configPath];

const config = require('../apps/server/config');

assert.strictEqual(config.adminPassword, '', 'ADMIN_PASSWORD must not have a source-code fallback');
assert.strictEqual(config.isOriginAllowed('https://example.com'), false, 'unconfigured production origins must not be implicitly allowed');

if (original === undefined) delete process.env.ADMIN_PASSWORD;
else process.env.ADMIN_PASSWORD = original;

console.log('OK security config: no admin password fallback; explicit origin policy.');
