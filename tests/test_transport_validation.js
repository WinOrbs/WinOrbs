'use strict';

const assert = require('assert');
const {
    normalizeCommand,
    validatePlayerInput,
    validateShoot
} = require('../apps/server/transport/command');

const cmd = normalizeCommand(' abc ', 'PLAYER_MOVE', { w: true, angle: 0 });
assert.strictEqual(cmd.commandId, 'abc');
assert.strictEqual(cmd.type, 'PLAYER_MOVE');
assert.strictEqual(cmd.payload.w, true);

assert.strictEqual(validatePlayerInput({ w: true, a: false, s: false, d: false, angle: 1 }).ok, true);
assert.strictEqual(validatePlayerInput({ w: 'true' }).ok, false);
assert.strictEqual(validatePlayerInput({ angle: Infinity }).ok, false);
assert.strictEqual(validatePlayerInput({ angle: Math.PI * 3 }).ok, false);
assert.strictEqual(validatePlayerInput(null).ok, false);

assert.strictEqual(validateShoot({ angle: 0 }).ok, true);
assert.strictEqual(validateShoot({ angle: '0' }).ok, false);
assert.strictEqual(validateShoot({ angle: NaN }).ok, false);

console.log('OK transport validation: input and shoot payloads reject invalid types/ranges.');
