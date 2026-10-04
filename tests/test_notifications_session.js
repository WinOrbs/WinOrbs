'use strict';
const assert = require('assert');
const { createNotification, queueNotification } = require('../apps/server/platform/notifications');
const { createSessionStore } = require('../apps/server/identity/session');

const n = createNotification('MATCH', 'Match started', { matchId: 'm1' });
const q = {};
assert.strictEqual(queueNotification(q, 'u1', n), true);
assert.strictEqual(q.u1.length, 1);

const sessions = createSessionStore({ ttlMs: 10000 });
assert.strictEqual(sessions.issue('s1', 'u1'), true);
assert.strictEqual(sessions.verify('s1', 'u1'), true);
assert.strictEqual(sessions.verify('s1', 'u2'), false);
assert.strictEqual(sessions.revoke('s1'), true);
assert.strictEqual(sessions.verify('s1', 'u1'), false);

console.log('OK platform: notifications and server sessions are bounded and revocable.');
