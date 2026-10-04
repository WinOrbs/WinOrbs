'use strict';
const assert = require('assert');
const fs = require('fs');
const firestore = fs.readFileSync(require.resolve('../firestore.rules'), 'utf8');
const storage = fs.readFileSync(require.resolve('../storage.rules'), 'utf8');

assert.match(firestore, /match \/inventarios\/\{uid\}/);
assert.match(firestore, /hasOnly\(\['apodo', 'displayName', 'avatarId', 'bio', 'country'\]\)/);
assert.match(firestore, /match \/progresion\/\{uid\}/);
assert.match(firestore, /match \/recompensas\/\{uid\}/);
assert.match(firestore, /match \/pagos\/\{id\}/);
assert.match(firestore, /allow update: if isAdmin\(\);/);
assert.doesNotMatch(storage, /2TRnwllarqhaggRR8so48rSVzji1/);

console.log('OK rules: platform writes remain server/admin controlled and storage has no hardcoded UID.');

assert.doesNotMatch(firestore, /SUSTITUYE_ESTO_POR_TU_UID/);
assert.doesNotMatch(firestore, /2TRnwllarqhaggRR8so48rSVzji1/);
