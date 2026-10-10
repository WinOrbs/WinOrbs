'use strict';

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;
const SAFE_CONTEXT_FIELDS = new Set([
    'method',
    'statusCode',
    'errorCode',
    'source',
    'port',
    'ready',
    'activeMatches',
    'activeSockets',
    'activePlayers',
    'activeRooms',
    'inboundMessagesPerSecond',
    'gameStateBroadcastsPerSecond',
    'playerMessagesPerSecond',
    'sampledGameStateBytes',
    'tickAverageMs',
    'tickP95Ms',
    'tickP99Ms',
    'cpuPercent',
    'memoryRssBytes'
]);

function normalizeTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
    const output = {};
    for (const [key, value] of Object.entries(context)) {
        if (!SAFE_CONTEXT_FIELDS.has(key)) continue;
        if (typeof value === 'boolean' || Number.isFinite(value)) {
            output[key] = value;
        } else if (typeof value === 'string' &&
            value.length <= 120 && /^[A-Za-z0-9 _./:-]*$/.test(value)) {
            output[key] = value;
        }
    }
    return output;
}

function ignoreAsyncSinkFailure(result) {
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return;
    if (typeof result.then !== 'function') return;
    Promise.resolve(result).catch(() => {});
}

function createStructuredLogger({ sink = console, clock = () => new Date() } = {}) {
    if (!sink || (typeof sink !== 'function' && typeof sink !== 'object') ||
        typeof clock !== 'function') {
        throw new TypeError('A log sink and clock function are required');
    }

    function write(level, event, context = {}) {
        if (!LEVELS.has(level) || typeof event !== 'string' || !EVENT_PATTERN.test(event)) {
            throw new TypeError('A valid log level and event name are required');
        }
        const timestamp = normalizeTimestamp(clock());
        if (!timestamp) throw new TypeError('A valid log timestamp is required');
        const record = {
            timestamp,
            level,
            event,
            ...safeContext(context)
        };
        const line = JSON.stringify(record);
        try {
            let result;
            if (typeof sink === 'function') {
                result = sink(line);
            } else {
                const output = typeof sink[level] === 'function' ? sink[level] : sink.log;
                if (typeof output === 'function') result = output.call(sink, line);
            }
            ignoreAsyncSinkFailure(result);
        } catch {
            // Logging must not change the outcome of the operation being observed.
        }
        return record;
    }

    return Object.freeze({
        debug: (event, context) => write('debug', event, context),
        info: (event, context) => write('info', event, context),
        warn: (event, context) => write('warn', event, context),
        error: (event, context) => write('error', event, context)
    });
}

module.exports = Object.freeze({ createStructuredLogger });