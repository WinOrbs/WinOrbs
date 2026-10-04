'use strict';

const assert = require('assert');
const { lockResult } = require('../apps/server/game/results');

const players = [
    { id: 'p1', uid: 'u1', nick: 'One', bankedScore: 120, eliminations: 2 },
    { id: 'p2', uid: 'u2', nick: 'Two', bankedScore: 80, eliminations: 1 }
];
const a = lockResult(players);
const b = lockResult(players);
assert.deepStrictEqual(a.snapshot, b.snapshot);
assert.strictEqual(a.checksum, b.checksum);
assert.strictEqual(a.checksum.length, 64);
assert.strictEqual(a.snapshot[0].score, 120);

console.log('OK results domain: match snapshots are deterministic and checksum-protected.');
