'use strict';

const assert = require('assert');
const { createRealtimeMetrics } = require('../apps/server/realtime/metrics');

assert.throws(() => createRealtimeMetrics({ sampleEvery: 0 }), TypeError);
const metrics = createRealtimeMetrics({ sampleEvery: 2, maxTickSamples: 3 });
metrics.recordTick(2);
metrics.recordTick(4);
metrics.recordTick(6);
metrics.recordTick(8);
metrics.recordInboundEvent('playerInput');
metrics.recordInboundEvent('playerInput');
metrics.recordInboundEvent('playerShoot');

const state = { players: { p1: { x: 1, y: 2 } } };
metrics.recordGameState('room-1', state, ['socket-1', 'socket-2']);
metrics.recordGameState('room-1', state, ['socket-1', 'socket-2']);
metrics.recordGameState('room-1', { players: { p1: { x: 3, y: 4 } } }, ['socket-1']);

const snapshot = metrics.snapshot({
    activeMatches: 1,
    activeSockets: 2,
    cpuPercent: 12.5,
    memoryRssBytes: 1024
});
assert.strictEqual(snapshot.activeMatches, 1);
assert.strictEqual(snapshot.activeSockets, 2);
assert.strictEqual(snapshot.topInboundEvents[0].event, 'playerInput');
assert.strictEqual(snapshot.gameStateBroadcastsPerSecond > 0, true);
assert.strictEqual(snapshot.playerMessagesPerSecond > 0, true);
assert.strictEqual(snapshot.sampledGameStateBytes,
    Buffer.byteLength(JSON.stringify(state)));
assert.deepStrictEqual(snapshot.bytesSentPerPlayer.players, [
    {
        socketId: 'socket-1',
        messages: 3,
        bytes: Buffer.byteLength(JSON.stringify(state)) * 3
    },
    {
        socketId: 'socket-2',
        messages: 2,
        bytes: Buffer.byteLength(JSON.stringify(state)) * 2
    }
]);
assert.strictEqual(snapshot.tickDurationMs.samples, 3);
assert.strictEqual(snapshot.tickDurationMs.average, 6);
assert.strictEqual(snapshot.tickDurationMs.p95, 8);
assert.strictEqual(snapshot.tickDurationMs.p99, 8);
assert.strictEqual(snapshot.cpuPercent, 12.5);
assert.strictEqual(snapshot.memoryRssBytes, 1024);
assert.strictEqual(metrics.snapshot().tickDurationMs.samples, 0);

const nextState = { players: { p1: { x: 10, y: 20 }, p2: { x: 30, y: 40 } } };
metrics.recordGameState('room-1', nextState, ['socket-1']);
const nextWindow = metrics.snapshot();
assert.strictEqual(nextWindow.sampledGameStateCount, 1);
assert.strictEqual(nextWindow.sampledGameStateBytes,
    Buffer.byteLength(JSON.stringify(nextState)));

console.log('OK realtime metrics: bounded tick percentiles, event rates, sampled payload and per-player bytes.');
