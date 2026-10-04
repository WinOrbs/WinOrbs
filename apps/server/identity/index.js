'use strict';

/**
 * Identity boundary: transport may carry a token, but only the auth adapter
 * may turn it into a verified UID. Client-supplied uid is intentionally ignored.
 */
function extractIdToken(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (typeof payload.token !== 'string') return null;
    const token = payload.token.trim();
    return token && token.length < 6000 ? token : null;
}

function canBindUid(currentUid, verifiedUid) {
    if (!verifiedUid) return false;
    return !currentUid || currentUid === verifiedUid;
}

module.exports = Object.freeze({ extractIdToken, canBindUid });
