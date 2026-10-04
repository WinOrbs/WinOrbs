'use strict';

const SENSITIVE_KEYS = new Set(['password', 'token', 'authorization', 'secret', 'apiKey']);

function sanitize(value, depth = 0) {
    if (depth > 4) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitize(v, depth + 1));
    if (!value || typeof value !== 'object') {
        return typeof value === 'string' ? value.slice(0, 500) : value;
    }
    const out = {};
    for (const [key, val] of Object.entries(value).slice(0, 50)) {
        out[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : sanitize(val, depth + 1);
    }
    return out;
}

function createAuditEvent(type, actor, data = {}) {
    return Object.freeze({
        type: String(type || 'UNKNOWN').slice(0, 100),
        actor: actor ? String(actor).slice(0, 128) : null,
        data: sanitize(data),
        createdAt: Date.now()
    });
}

module.exports = Object.freeze({ sanitize, createAuditEvent });
