'use strict';

const assert = require('assert');
const { extractIdToken, canBindUid } = require('../apps/server/identity');

assert.strictEqual(extractIdToken({ uid: 'attacker' }), null);
assert.strictEqual(extractIdToken({ token: '  abc  ' }), 'abc');
assert.strictEqual(extractIdToken({ token: 'x'.repeat(6000) }), null);
assert.strictEqual(canBindUid(null, 'uid-1'), true);
assert.strictEqual(canBindUid('uid-1', 'uid-1'), true);
assert.strictEqual(canBindUid('uid-1', 'uid-2'), false);

console.log('OK identity domain: only verified identity can bind to a socket.');
