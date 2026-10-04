'use strict';
const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

assert.ok(!source.includes('process.env.ADMIN_PASSWORD || "admin123"'));
assert.ok(!source.includes('process.env.ADMIN_PASSWORD || \'admin123\''));
assert.match(source, /extractIdToken/);
assert.match(source, /socket\.verifiedUid/);
assert.doesNotMatch(source, /socket\.verifiedUid\s*=\s*uidRaw/);
assert.match(source, /validatePlayerInput/);
assert.match(source, /validateShoot/);
assert.match(source, /adminAutorizado/);

console.log('OK security: server does not trust raw UID or fallback admin credentials.');
