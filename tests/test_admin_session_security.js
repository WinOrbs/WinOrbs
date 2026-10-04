'use strict';
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
assert.match(source, /ADMIN_SESSION_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
assert.match(source, /function adminAutorizado\(socket\)/);
assert.match(source, /Date\.now\(\) - socket\.adminAuthenticatedAt >= ADMIN_SESSION_MS/);
assert.match(source, /socket\.adminAuthenticatedAt = now/);

console.log('OK security: administrative socket sessions have a bounded lifetime.');
