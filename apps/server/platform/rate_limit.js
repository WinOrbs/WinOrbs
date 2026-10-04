'use strict';

function createRateLimiter({ limit = 20, windowMs = 1000 } = {}) {
    const records = new Map();
    return function allow(key) {
        const now = Date.now();
        const k = String(key || 'anonymous').slice(0, 200);
        const record = records.get(k);
        if (!record || now - record.startedAt >= windowMs) {
            records.set(k, { startedAt: now, count: 1 });
            return true;
        }
        if (record.count >= limit) return false;
        record.count++;
        return true;
    };
}

module.exports = Object.freeze({ createRateLimiter });
