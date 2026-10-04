'use strict';

const crypto = require('crypto');

function buildResultSnapshot(players) {
    return (Array.isArray(players) ? players : []).map((p) => ({
        playerId: String(p.id || ''),
        uid: p.uid || null,
        nick: String(p.nick || ''),
        score: Number(p.bankedScore) || 0,
        eliminations: Number(p.eliminations) || 0
    }));
}

function checksum(snapshot) {
    const canonical = JSON.stringify(snapshot);
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

function lockResult(players) {
    const snapshot = buildResultSnapshot(players);
    return Object.freeze({
        snapshot,
        checksum: checksum(snapshot)
    });
}

module.exports = Object.freeze({ buildResultSnapshot, checksum, lockResult });
