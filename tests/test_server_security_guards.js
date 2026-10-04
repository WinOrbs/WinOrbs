'use strict';
const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

assert.ok(!source.includes('process.env.ADMIN_PASSWORD || "admin123"'));
assert.ok(!source.includes('process.env.ADMIN_PASSWORD || \'admin123\''));
assert.match(source, /extractIdToken/);
assert.match(source, /socket\.verifiedUid/);
assert.match(source, /canBindUid/);
assert.match(source, /Esa cuenta ya está jugando en esta sala/);
assert.doesNotMatch(source, /socket\.verifiedUid\s*=\s*uidRaw/);
assert.match(source, /validatePlayerInput/);
assert.match(source, /validateShoot/);
assert.match(source, /adminAutorizado/);
assert.match(source, /modo: FIREBASE_ECONOMY \? 'ECONOMIA' : 'DESHABILITADA'/);
assert.match(source, /salas con entrada monetaria requieren economía server-side configurada/);
assert.match(source, /Esta sala de pago no está disponible temporalmente/);
assert.doesNotMatch(source, /Cobro\/premio los gestiona el cliente/);

console.log('OK security: server does not trust raw UID or fallback admin credentials.');
