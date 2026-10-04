'use strict';

/**
 * MatchOrbs are temporary match resources. Score, XP, persistent currency and
 * real-money balances are deliberately outside this module.
 */
const DEATH_LOSS_RATE = 0.20;

function calculateDeathLoss(amount) {
    const current = Math.max(0, Number(amount) || 0);
    const lost = Math.min(current, Math.floor(current * DEATH_LOSS_RATE));
    return { lost, remaining: current - lost };
}

function applyDeathLoss(player) {
    if (!player || typeof player !== 'object') {
        return { lost: 0, remaining: 0 };
    }

    const result = calculateDeathLoss(player.charge);
    player.charge = result.remaining;
    return result;
}

module.exports = Object.freeze({ DEATH_LOSS_RATE, calculateDeathLoss, applyDeathLoss });
