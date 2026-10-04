'use strict';

function createIdempotencyStore({ ttlMs = 10 * 60 * 1000, maxEntries = 10000 } = {}) {
    const entries = new Map();

    function cleanup(now) {
        for (const [key, value] of entries) {
            if (now - value.createdAt >= ttlMs) entries.delete(key);
        }
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }

    return Object.freeze({
        get(key) {
            const now = Date.now();
            cleanup(now);
            return entries.get(String(key || ''))?.value;
        },
        set(key, value) {
            const k = String(key || '').trim().slice(0, 200);
            if (!k) return false;
            const now = Date.now();
            cleanup(now);
            entries.set(k, { value, createdAt: now });
            return true;
        }
    });
}

function validRequestId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

module.exports = Object.freeze({ createIdempotencyStore, validRequestId });
