'use strict';

function percentile(values, fraction) {
    if (!values.length) return 0;
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.ceil(fraction * ordered.length) - 1];
}

function createRealtimeMetrics({ sampleEvery = 30, maxTickSamples = 3600 } = {}) {
    if (!Number.isSafeInteger(sampleEvery) || sampleEvery < 1 ||
        !Number.isSafeInteger(maxTickSamples) || maxTickSamples < 1) {
        throw new TypeError('Realtime metric bounds must be positive safe integers');
    }

    let ticks = [];
    let broadcasts = 0;
    let serializedBytes = 0;
    let serializedSamples = 0;
    let inboundEvents = 0;
    const inboundByEvent = new Map();
    const emissionsByRoom = new Map();
    const lastPayloadBytesByRoom = new Map();
    const players = new Map();
    let windowStartedAt = process.hrtime.bigint();

    function recordTick(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new TypeError('Tick duration must be a finite non-negative number');
        }
        ticks.push(durationMs);
        if (ticks.length > maxTickSamples) ticks.shift();
    }

    function recordInboundEvent(eventName) {
        if (typeof eventName !== 'string' || !eventName) return;
        inboundEvents += 1;
        const key = eventName.length <= 64 &&
            (inboundByEvent.has(eventName) || inboundByEvent.size < 64)
            ? eventName
            : '<other>';
        inboundByEvent.set(key, (inboundByEvent.get(key) || 0) + 1);
    }

    function recordGameState(roomId, payload, socketIds) {
        if (typeof roomId !== 'string' || !roomId || !Array.isArray(socketIds)) {
            throw new TypeError('Room ID and recipient socket IDs are required');
        }
        broadcasts += 1;
        const emissionCount = (emissionsByRoom.get(roomId) || 0) + 1;
        emissionsByRoom.set(roomId, emissionCount);
        let payloadBytes = lastPayloadBytesByRoom.get(roomId);
        if (payloadBytes === undefined || emissionCount % sampleEvery === 0) {
            const serialized = JSON.stringify(payload);
            if (typeof serialized !== 'string') {
                throw new TypeError('Game state must be JSON serializable');
            }
            payloadBytes = Buffer.byteLength(serialized, 'utf8');
            lastPayloadBytesByRoom.set(roomId, payloadBytes);
            serializedBytes += payloadBytes;
            serializedSamples += 1;
        }
        for (const socketId of socketIds) {
            if (typeof socketId !== 'string' || !socketId) continue;
            const current = players.get(socketId) || { messages: 0, bytes: 0 };
            current.messages += 1;
            current.bytes += payloadBytes;
            players.set(socketId, current);
        }
    }

    function snapshot({
        activeMatches = 0,
        activeSockets = 0,
        cpuPercent = null,
        memoryRssBytes = null
    } = {}) {
        const now = process.hrtime.bigint();
        const durationSeconds = Number(now - windowStartedAt) / 1e9;
        const playerStats = [...players.entries()].map(([socketId, metrics]) => ({
            socketId,
            messages: metrics.messages,
            bytes: metrics.bytes
        }));
        const totalPlayerMessages = playerStats.reduce((sum, player) => sum + player.messages, 0);
        const totalPlayerBytes = playerStats.reduce((sum, player) => sum + player.bytes, 0);
        const topInboundEvents = [...inboundByEvent.entries()]
            .map(([event, count]) => ({ event, count, perSecond: count / durationSeconds }))
            .sort((left, right) => right.count - left.count)
            .slice(0, 10);
        const result = {
            intervalSeconds: durationSeconds,
            activeMatches,
            activeSockets,
            inboundMessagesPerSecond: inboundEvents / durationSeconds,
            topInboundEvents,
            gameStateBroadcastsPerSecond: broadcasts / durationSeconds,
            playerMessagesPerSecond: totalPlayerMessages / durationSeconds,
            sampledGameStateCount: serializedSamples,
            sampledGameStateBytes: serializedSamples
                ? serializedBytes / serializedSamples
                : 0,
            bytesSentPerPlayer: {
                average: playerStats.length ? totalPlayerBytes / playerStats.length : 0,
                maximum: playerStats.reduce((maximum, player) =>
                    Math.max(maximum, player.bytes), 0),
                players: playerStats
            },
            tickDurationMs: {
                samples: ticks.length,
                average: ticks.length
                    ? ticks.reduce((sum, duration) => sum + duration, 0) / ticks.length
                    : 0,
                p95: percentile(ticks, 0.95),
                p99: percentile(ticks, 0.99)
            },
            cpuPercent,
            memoryRssBytes
        };

        ticks = [];
        broadcasts = 0;
        serializedBytes = 0;
        serializedSamples = 0;
        inboundEvents = 0;
        inboundByEvent.clear();
        emissionsByRoom.clear();
        lastPayloadBytesByRoom.clear();
        players.clear();
        windowStartedAt = now;
        return result;
    }

    return Object.freeze({
        recordTick,
        recordInboundEvent,
        recordGameState,
        snapshot
    });
}

module.exports = Object.freeze({ createRealtimeMetrics });
