'use strict';
const assert = require('assert');
const { hasItem, grantItem, consumeItem } = require('../apps/server/platform/inventory');
const { addXp, snapshot } = require('../apps/server/platform/progression');
const { claimReward } = require('../apps/server/platform/rewards');
const { createAuditEvent } = require('../apps/server/platform/audit');

const inv = {};
assert.strictEqual(grantItem(inv, 'skin-1', 1), true);
assert.strictEqual(hasItem(inv, 'skin-1'), true);
assert.strictEqual(consumeItem(inv, 'skin-1'), true);
assert.strictEqual(hasItem(inv, 'skin-1'), false);

const progress = { xp: 0, level: 1 };
assert.strictEqual(addXp(progress, 100), true);
assert.deepStrictEqual(snapshot(progress), { xp: 100, level: 2 });

const claims = {};
assert.strictEqual(claimReward(claims, 'r1'), true);
assert.strictEqual(claimReward(claims, 'r1'), false);

const audit = createAuditEvent('TEST', 'u1', { token: 'secret', ok: true });
assert.strictEqual(audit.data.token, '[REDACTED]');
assert.strictEqual(audit.data.ok, true);

console.log('OK platform domain: inventory, progression, rewards and audit boundaries.');
