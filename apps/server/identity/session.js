'use strict';

function createSessionStore({ ttlMs = 24 * 60 * 60 * 1000, maxSessions = 10000 } = {}) {
    const sessions = new Map();
    function purge(now) {
        for (const [id, session] of sessions) if (session.expiresAt <= now || session.revokedAt) sessions.delete(id);
        while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
    }
    return Object.freeze({
        issue(sessionId, userId) {
            if (!sessionId || !userId) return false;
            const now = Date.now(); purge(now);
            sessions.set(String(sessionId).slice(0, 128), { userId: String(userId).slice(0, 128), issuedAt: now, expiresAt: now + ttlMs, revokedAt: null });
            return true;
        },
        verify(sessionId, userId) {
            const now = Date.now(); purge(now);
            const session = sessions.get(String(sessionId || ''));
            return !!session && session.userId === String(userId || '') && session.expiresAt > now;
        },
        revoke(sessionId) {
            const session = sessions.get(String(sessionId || ''));
            if (!session) return false;
            session.revokedAt = Date.now(); return true;
        }
    });
}

module.exports = Object.freeze({ createSessionStore });
