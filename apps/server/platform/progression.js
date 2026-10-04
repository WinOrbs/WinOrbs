'use strict';

function addXp(progress, amount) {
    if (!progress || typeof progress !== 'object') return false;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) return false;
    progress.xp = Math.max(0, Number(progress.xp) || 0) + value;
    progress.level = Math.max(1, Math.floor(Math.sqrt(progress.xp / 100)) + 1);
    return true;
}

function snapshot(progress) {
    return Object.freeze({
        xp: Math.max(0, Number(progress?.xp) || 0),
        level: Math.max(1, Number(progress?.level) || 1)
    });
}

module.exports = Object.freeze({ addXp, snapshot });
