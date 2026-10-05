'use strict';

const { randomUUID } = require('crypto');

const OBSERVABILITY_CATEGORIES = Object.freeze([
    'SYSTEM',
    'SECURITY',
    'ADMIN',
    'MATCH',
    'RECOVERY',
    'ECONOMY',
    'SETTLEMENT',
    'AUTH',
    'ERROR'
]);

const OBSERVABILITY_OUTCOMES = Object.freeze([
    'SUCCESS',
    'FAILURE',
    'DENIED',
    'REJECTED',
    'RETRY',
    'STARTED',
    'COMPLETED'
]);

const OBSERVABILITY_ERRORS = Object.freeze({
    INVALID_EVENT: 'INVALID_EVENT',
    INVALID_CATEGORY: 'INVALID_CATEGORY',
    INVALID_OUTCOME: 'INVALID_OUTCOME',
    MISSING_EVENT_ID: 'MISSING_EVENT_ID',
    MISSING_TIMESTAMP: 'MISSING_TIMESTAMP',
    SENSITIVE_DATA: 'SENSITIVE_DATA',
    INVALID_CORRELATION_CONTEXT: 'INVALID_CORRELATION_CONTEXT',
    SINK_FAILURE: 'SINK_FAILURE'
});

const SAFE_MESSAGES = Object.freeze({
    INVALID_EVENT: 'The event is invalid.',
    INVALID_CATEGORY: 'The event category is invalid.',
    INVALID_OUTCOME: 'The event outcome is invalid.',
    MISSING_EVENT_ID: 'An event identifier is required.',
    MISSING_TIMESTAMP: 'A valid event timestamp could not be generated.',
    SENSITIVE_DATA: 'The event contains data that cannot be serialized safely.',
    INVALID_CORRELATION_CONTEXT: 'The correlation context is invalid.',
    SINK_FAILURE: 'The event sink did not confirm the event.'
});

const SENSITIVE_KEY_PARTS = Object.freeze([
    'password',
    'token',
    'secret',
    'credential',
    'privatekey',
    'serviceaccount',
    'authorization',
    'cookie',
    'walletsecret',
    'paymentcredential'
]);

const EVENT_FIELDS = new Set([
    'eventId',
    'eventType',
    'category',
    'timestamp',
    'schemaVersion',
    'correlationId',
    'requestId',
    'actorId',
    'sessionId',
    'matchId',
    'operation',
    'outcome',
    'metadata'
]);

const CONTEXT_FIELDS = new Set([
    'correlationId',
    'requestId',
    'actorId',
    'sessionId',
    'matchId'
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,99}$/;
const MAX_DEPTH = 16;
const MAX_ARRAY_LENGTH = 1000;
const MAX_OBJECT_KEYS = 1000;
const MAX_STRING_LENGTH = 8192;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code) {
    const safeCode = Object.hasOwn(SAFE_MESSAGES, code)
        ? code
        : OBSERVABILITY_ERRORS.INVALID_EVENT;
    return {
        ok: false,
        error: {
            code: safeCode,
            message: SAFE_MESSAGES[safeCode]
        }
    };
}

function isSensitiveKey(key) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function sanitize(value, depth = 0, ancestors = new Set()) {
    if (depth > MAX_DEPTH) return { ok: false };
    if (value === null || typeof value === 'boolean') return { ok: true, value };
    if (typeof value === 'string') {
        return value.length <= MAX_STRING_LENGTH
            ? { ok: true, value }
            : { ok: false };
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? { ok: true, value } : { ok: false };
    }
    if (typeof value !== 'object') return { ok: false };
    if (ancestors.has(value)) return { ok: false };

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_LENGTH) return { ok: false };
        const output = [];
        for (const item of value) {
            const sanitized = sanitize(item, depth + 1, nextAncestors);
            if (!sanitized.ok) return sanitized;
            output.push(sanitized.value);
        }
        return { ok: true, value: output };
    }
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) {
        return { ok: false };
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) return { ok: false };
    const output = {};
    for (const [key, item] of entries) {
        if (isSensitiveKey(key)) continue;
        const sanitized = sanitize(item, depth + 1, nextAncestors);
        if (!sanitized.ok) return sanitized;
        output[key] = sanitized.value;
    }
    return { ok: true, value: output };
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function validIdentifier(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
}

function validName(value) {
    return typeof value === 'string' && NAME_PATTERN.test(value);
}

function createObservabilityService({ sink, clock = () => new Date() } = {}) {
    const write = typeof sink === 'function'
        ? sink
        : sink && typeof sink.write === 'function'
            ? sink.write.bind(sink)
            : null;
    if (!write || typeof clock !== 'function') {
        throw new TypeError('An event sink and clock function are required');
    }

    const emittedIds = new Set();
    const pendingIds = new Set();

    function createCorrelationContext(input = {}) {
        if (!isRecord(input) ||
            Object.keys(input).some((key) => !CONTEXT_FIELDS.has(key))) {
            return fail(OBSERVABILITY_ERRORS.INVALID_CORRELATION_CONTEXT);
        }
        const context = {};
        for (const [key, value] of Object.entries(input)) {
            if (value !== undefined && !validIdentifier(value)) {
                return fail(OBSERVABILITY_ERRORS.INVALID_CORRELATION_CONTEXT);
            }
            if (value !== undefined) context[key] = value;
        }
        if (!context.correlationId) context.correlationId = randomUUID();
        return { ok: true, data: deepFreeze(context) };
    }

    async function emit(event, forcedCategory) {
        if (!isRecord(event)) return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
        if (!Object.hasOwn(event, 'eventId') || !event.eventId) {
            return fail(OBSERVABILITY_ERRORS.MISSING_EVENT_ID);
        }
        if (!['eventType', 'operation', 'outcome'].every((key) =>
            Object.hasOwn(event, key))) {
            return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
        }
        if (!validIdentifier(event.eventId) || !validName(event.eventType) ||
            !validName(event.operation)) {
            return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
        }
        if (event.outcome !== undefined &&
            !OBSERVABILITY_OUTCOMES.includes(event.outcome)) {
            return fail(OBSERVABILITY_ERRORS.INVALID_OUTCOME);
        }
        const category = forcedCategory === undefined ? event.category : forcedCategory;
        if (!OBSERVABILITY_CATEGORIES.includes(category)) {
            return fail(OBSERVABILITY_ERRORS.INVALID_CATEGORY);
        }
        if (!OBSERVABILITY_OUTCOMES.includes(event.outcome)) {
            return fail(OBSERVABILITY_ERRORS.INVALID_OUTCOME);
        }
        if (event.timestamp !== undefined && !validTimestamp(event.timestamp)) {
            return fail(OBSERVABILITY_ERRORS.MISSING_TIMESTAMP);
        }
        if (emittedIds.has(event.eventId) || pendingIds.has(event.eventId)) {
            return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
        }
        for (const key of ['correlationId', 'requestId', 'actorId', 'sessionId', 'matchId']) {
            if (event[key] !== undefined && !validIdentifier(event[key])) {
                return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
            }
        }
        for (const key of Object.keys(event)) {
            if (!EVENT_FIELDS.has(key) && !isSensitiveKey(key)) {
                return fail(OBSERVABILITY_ERRORS.INVALID_EVENT);
            }
        }

        let timestamp;
        try {
            timestamp = normalizeTimestamp(clock());
        } catch {
            return fail(OBSERVABILITY_ERRORS.MISSING_TIMESTAMP);
        }
        if (!timestamp) return fail(OBSERVABILITY_ERRORS.MISSING_TIMESTAMP);

        const metadata = sanitize(event.metadata === undefined ? {} : event.metadata);
        if (!metadata.ok) return fail(OBSERVABILITY_ERRORS.SENSITIVE_DATA);
        const normalized = {
            eventId: event.eventId,
            eventType: event.eventType,
            category,
            timestamp,
            schemaVersion: 1,
            operation: event.operation,
            outcome: event.outcome,
            metadata: metadata.value
        };
        for (const key of [
            'correlationId',
            'requestId',
            'actorId',
            'sessionId',
            'matchId'
        ]) {
            if (event[key] !== undefined) normalized[key] = event[key];
        }

        pendingIds.add(event.eventId);
        const immutableEvent = deepFreeze(normalized);
        try {
            const result = await write(immutableEvent);
            if (result === false || result?.ok === false) {
                return fail(OBSERVABILITY_ERRORS.SINK_FAILURE);
            }
            emittedIds.add(event.eventId);
            return { ok: true, data: immutableEvent };
        } catch {
            return fail(OBSERVABILITY_ERRORS.SINK_FAILURE);
        } finally {
            pendingIds.delete(event.eventId);
        }
    }

    function validTimestamp(value) {
        return typeof value === 'string' && Number.isFinite(Date.parse(value)) ||
            value instanceof Date && Number.isFinite(value.getTime()) ||
            typeof value === 'number' && Number.isFinite(value);
    }

    function normalizeTimestamp(value) {
        if (value instanceof Date) {
            return Number.isFinite(value.getTime()) ? value.toISOString() : null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? date.toISOString() : null;
        }
        if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
            return new Date(value).toISOString();
        }
        return null;
    }

    return Object.freeze({
        logEvent: (event) => emit(event),
        logSecurityEvent: (event) => emit(event, 'SECURITY'),
        logAdminAction: (event) => emit(event, 'ADMIN'),
        logMatchEvent: (event) => emit(event, 'MATCH'),
        logRecoveryEvent: (event) => emit(event, 'RECOVERY'),
        logEconomyEvent: (event) => emit(event, 'ECONOMY'),
        createCorrelationContext
    });
}

module.exports = {
    OBSERVABILITY_CATEGORIES,
    OBSERVABILITY_OUTCOMES,
    OBSERVABILITY_ERRORS,
    createObservabilityService
};
