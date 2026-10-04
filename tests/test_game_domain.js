'use strict';

const assert = require('assert');
const { MATCH_STATUS, canTransition, transition } = require('../apps/server/game/lifecycle');
const { calculateDeathLoss, applyDeathLoss, DEATH_LOSS_RATE } = require('../apps/server/game/orbs');

assert.strictEqual(canTransition(MATCH_STATUS.CREATED, MATCH_STATUS.WAITING), true);
assert.strictEqual(canTransition(MATCH_STATUS.RUNNING, MATCH_STATUS.WAITING), false);
assert.deepStrictEqual(
    transition({ status: MATCH_STATUS.WAITING }, MATCH_STATUS.STARTING),
    { ok: true, state: { status: MATCH_STATUS.STARTING } }
);
assert.strictEqual(transition({ status: MATCH_STATUS.CREATED }, MATCH_STATUS.RUNNING).ok, false);

assert.strictEqual(DEATH_LOSS_RATE, 0.20);
assert.deepStrictEqual(calculateDeathLoss(100), { lost: 20, remaining: 80 });
assert.deepStrictEqual(calculateDeathLoss(3), { lost: 0, remaining: 3 });
const player = { charge: 100 };
assert.deepStrictEqual(applyDeathLoss(player), { lost: 20, remaining: 80 });
assert.strictEqual(player.charge, 80);

console.log('OK game domain: lifecycle transitions and MatchOrbs death-loss rules.');
