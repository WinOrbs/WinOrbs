'use strict';

const assert = require('assert');
const {
    MATCH_STATUS,
    COMMANDS,
    EVENTS,
    RESOURCE_BOUNDARIES
} = require('../packages/types');

assert.strictEqual(MATCH_STATUS.CREATED, 'CREATED');
assert.strictEqual(MATCH_STATUS.RESULT_LOCKED, 'RESULT_LOCKED');
assert.ok(COMMANDS.includes('PLAYER_MOVE'));
assert.ok(COMMANDS.includes('PLAYER_SHOOT'));
assert.ok(EVENTS.includes('MatchCompleted'));
assert.strictEqual(RESOURCE_BOUNDARIES.MATCH_ORBS, 'MatchOrbs');
assert.notStrictEqual(RESOURCE_BOUNDARIES.MATCH_ORBS, RESOURCE_BOUNDARIES.SCORE);
assert.notStrictEqual(RESOURCE_BOUNDARIES.SCORE, RESOURCE_BOUNDARIES.XP);
assert.notStrictEqual(RESOURCE_BOUNDARIES.XP, RESOURCE_BOUNDARIES.REAL_MONEY);

console.log('OK types: lifecycle, command/event vocabulary and resource boundaries are stable.');
