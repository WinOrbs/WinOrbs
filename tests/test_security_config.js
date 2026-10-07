'use strict';

const assert = require('assert');
const { createConfig } = require('../apps/server/config/env');
const config = createConfig({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://allowed.example'
});

assert.strictEqual(
    config.adminPassword,
    '',
    'ADMIN_PASSWORD must not have a source-code fallback'
);
assert.deepStrictEqual(
    config.cors.origins,
    ['https://allowed.example'],
    'production CORS must use the explicitly configured origin'
);
assert.strictEqual(
    config.cors.isOriginAllowed('https://example.com'),
    false,
    'unconfigured production origins must not be implicitly allowed'
);

console.log('OK security config: no admin password fallback; production requires explicit CORS.');
