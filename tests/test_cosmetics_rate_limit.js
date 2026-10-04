'use strict';
const assert = require('assert');
const { canEquip, equip } = require('../apps/server/platform/cosmetics');
const { createRateLimiter } = require('../apps/server/platform/rate_limit');

const inv = { c1: { type: 'cosmetic', quantity: 1 } };
const profile = {};
assert.strictEqual(canEquip(inv, 'c1'), true);
assert.strictEqual(equip(profile, inv, 'c1'), true);
assert.strictEqual(profile.equippedCosmeticId, 'c1');
assert.strictEqual(canEquip({}, 'c1'), false);

const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
assert.strictEqual(allow('u1'), true);
assert.strictEqual(allow('u1'), true);
assert.strictEqual(allow('u1'), false);
assert.strictEqual(allow('u2'), true);

console.log('OK platform: cosmetics ownership and rate limiting.');
