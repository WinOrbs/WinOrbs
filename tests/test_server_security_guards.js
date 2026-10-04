'use strict';
const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const indexHtml = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const walletHtml = fs.readFileSync(require.resolve('../public/wallet.html'), 'utf8');
const adminHtml = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');


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

assert.doesNotMatch(walletHtml, /runTransaction/);
assert.doesNotMatch(walletHtml, /updateDoc\([^)]*usuarios/);
assert.doesNotMatch(walletHtml, /usuarios\/[^\n]*saldo/);

assert.match(source, /socket\.on\('adminProcesarPago'/);
assert.match(source, /socket\.on\('adminAjustarSaldo'/);
assert.doesNotMatch(adminHtml, /updateDoc\(doc\(db, "usuarios"[^\n]*saldo/);
assert.doesNotMatch(adminHtml, /setDoc\(doc\(db, "movimientos"/);
assert.doesNotMatch(adminHtml, /updateDoc\(doc\(db, "partidas"/);

console.log('OK security: server does not trust raw UID or fallback admin credentials.');
