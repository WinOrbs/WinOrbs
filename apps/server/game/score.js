'use strict';

/**
 * Score is match-only competitive state. It is not MatchOrbs, XP, persistent
 * currency, inventory, or real-money balance.
 */
const SCORE_EVENTS = Object.freeze({
    ORB_BANK: 'ORB_BANK',
    ELIMINATION: 'ELIMINATION'
});

const SCORE_VALUES = Object.freeze({
    [SCORE_EVENTS.ELIMINATION]: 5
});

function addScore(player, amount) {
    if (!player || typeof player !== 'object') return 0;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return 0;
    player.bankedScore = Math.max(0, Number(player.bankedScore) || 0) + value;
    return value;
}

function bankMatchOrbs(player) {
    if (!player || typeof player !== 'object') return 0;
    const amount = Math.max(0, Number(player.charge) || 0);
    if (amount <= 0) return 0;
    addScore(player, amount);
    player.charge = 0;
    return amount;
}

function awardElimination(player, { countAsElimination = true } = {}) {
    const awarded = addScore(player, SCORE_VALUES[SCORE_EVENTS.ELIMINATION]);
    if (awarded > 0 && countAsElimination) {
        player.eliminations = Math.max(0, Math.floor(Number(player.eliminations) || 0)) + 1;
    }
    return awarded;
}

module.exports = Object.freeze({
    SCORE_EVENTS,
    SCORE_VALUES,
    addScore,
    bankMatchOrbs,
    awardElimination
});
