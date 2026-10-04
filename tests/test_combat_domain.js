'use strict';

const assert = require('assert');
const { applyDamage } = require('../apps/server/game/combat');

const target = { hp: 100, shield: 30 };
assert.deepStrictEqual(applyDamage(target, 20), { absorbed: 20, damage: 0, hp: 100, killed: false });
assert.strictEqual(target.shield, 10);

assert.deepStrictEqual(applyDamage(target, 25), { absorbed: 10, damage: 15, hp: 85, killed: false });
assert.strictEqual(target.shield, 0);

assert.deepStrictEqual(applyDamage(target, 100), { absorbed: 0, damage: 85, hp: 0, killed: true });

console.log('OK combat domain: shield absorption and lethal damage are deterministic.');
