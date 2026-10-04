'use strict';
const assert = require('assert');
const { createIdempotencyStore, validRequestId } = require('../apps/server/platform/idempotency');

assert.strictEqual(validRequestId('request-1234'), true);
assert.strictEqual(validRequestId('x'), false);
const store = createIdempotencyStore({ ttlMs: 10000 });
assert.strictEqual(store.get('request-1234'), undefined);
assert.strictEqual(store.set('request-1234', { ok: true }), true);
assert.deepStrictEqual(store.get('request-1234'), { ok: true });
console.log('OK idempotency: request IDs can be stored and replayed safely.');
