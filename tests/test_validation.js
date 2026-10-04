'use strict';

const assert = require('assert');
const {
    validatePlayerInput,
    validateShootData,
    validateWeapon,
    validateNick
} = require('../packages/validation');

assert.deepStrictEqual(
    validatePlayerInput({ w: true, a: false, s: false, d: true, angle: 1.25 }),
    { w: true, a: false, s: false, d: true, angle: 1.25 }
);
assert.strictEqual(validatePlayerInput({ w: true, angle: NaN }), null);
assert.strictEqual(validatePlayerInput({ w: true, unexpected: true }), null);
assert.strictEqual(validatePlayerInput({ w: 1 }), null);
assert.deepStrictEqual(
    validateShootData({ angle: -2 }),
    { angle: -2 }
);
assert.strictEqual(validateShootData({ angle: Infinity }), null);
assert.strictEqual(validateShootData(null), null);
assert.strictEqual(validateWeapon(1), 1);
assert.strictEqual(validateWeapon(99), null);
assert.strictEqual(validateNick(' Player '), 'Player');
assert.strictEqual(validateNick('<script>'), null);

console.log('OK validation: gameplay transport payloads are schema-limited.');
