'use strict';

const assert = require('assert');
const { addScore, bankMatchOrbs, awardElimination, SCORE_VALUES } = require('../apps/server/game/score');

const player = { charge: 100, bankedScore: 10 };
assert.strictEqual(bankMatchOrbs(player), 100);
assert.strictEqual(player.charge, 0);
assert.strictEqual(player.bankedScore, 110);

assert.strictEqual(awardElimination(player), SCORE_VALUES.ELIMINATION);
assert.strictEqual(player.bankedScore, 115);
assert.strictEqual(player.eliminations, 1);
assert.strictEqual(awardElimination(player), SCORE_VALUES.ELIMINATION);
assert.strictEqual(player.eliminations, 2);
assert.strictEqual(awardElimination(player, { countAsElimination: false }), SCORE_VALUES.ELIMINATION);
assert.strictEqual(player.eliminations, 2);
assert.strictEqual(addScore(player, -50), 0);
assert.strictEqual(player.bankedScore, 125);

console.log('OK score domain: MatchOrbs banking and elimination score are server-side rules.');
