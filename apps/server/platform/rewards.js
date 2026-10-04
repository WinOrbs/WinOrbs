'use strict';

function claimReward(claims, rewardId) {
    if (!claims || typeof claims !== 'object' || typeof rewardId !== 'string') return false;
    const id = rewardId.trim().slice(0, 128);
    if (!id || claims[id]) return false;
    claims[id] = { claimedAt: Date.now() };
    return true;
}

module.exports = Object.freeze({ claimReward });
