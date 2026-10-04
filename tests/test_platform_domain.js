'use strict';
const assert = require('assert');
const { hasItem, grantItem, consumeItem } = require('../apps/server/platform/inventory');
const {
    DEFAULT_VISUAL_REWARDS,
    DAILY_MISSIONS,
    addXp,
    applyMatch,
    levelForXp,
    rankEntries,
    snapshot,
    xpForNextLevel
} = require('../apps/server/platform/progression');
const { claimReward } = require('../apps/server/platform/rewards');
const { createAuditEvent } = require('../apps/server/platform/audit');

const inv = {};
assert.strictEqual(grantItem(inv, 'skin-1', 1), true);
assert.strictEqual(hasItem(inv, 'skin-1'), true);
assert.strictEqual(consumeItem(inv, 'skin-1'), true);
assert.strictEqual(hasItem(inv, 'skin-1'), false);

const progress = { xp: 0, level: 1 };
assert.strictEqual(addXp(progress, 150), true);
assert.deepStrictEqual(snapshot(progress), { xp: 150, level: 2 });
assert.strictEqual(xpForNextLevel(2), 155);
assert.strictEqual(levelForXp(100000), 100);
assert.strictEqual(xpForNextLevel(100), 0);
assert.strictEqual(levelForXp(39104), 99);
assert.strictEqual(levelForXp(39105), 100);

const daily = { xp: 0, unlockedAuras: [] };
assert.deepStrictEqual(
    applyMatch(daily, { score: 300, eliminations: 2, position: 1 }, '2026-10-04'),
    {
        xpAwarded: 120,
        completedMissions: ['play-one', 'score-250', 'top-three', 'two-eliminations'],
        unlockedRewards: []
    }
);
assert.strictEqual(daily.daily.matchesCompleted, 1);
assert.strictEqual(applyMatch(daily, { score: 0, eliminations: 0, position: 4 }, '2026-10-04').xpAwarded, 0);
assert.strictEqual(applyMatch(daily, { score: 0, eliminations: 0, position: 4 }, '2026-10-04').xpAwarded, 30);
assert.strictEqual(daily.xp, 150);
assert.strictEqual(daily.daily.completed['play-three'], true);
assert.strictEqual(applyMatch(daily, { score: 300, eliminations: 2, position: 1 }, '2026-10-05').xpAwarded, 120);
assert.strictEqual(daily.daily.matchesCompleted, 1);
const nearAuraUnlock = { xp: 1420, level: 9, unlockedRewards: [] };
const auraResult = applyMatch(nearAuraUnlock, { score: 300, eliminations: 2, position: 1 }, '2026-10-04');
assert.strictEqual(nearAuraUnlock.level, 10);
assert.deepStrictEqual(auraResult.unlockedRewards.map((reward) => reward.id), ['level-aura-10']);
assert.deepStrictEqual(DAILY_MISSIONS.map((mission) => mission.xp), [15, 30, 25, 35, 45]);
assert.deepStrictEqual(DEFAULT_VISUAL_REWARDS.map((reward) => reward.level), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const customRewards = DEFAULT_VISUAL_REWARDS.map((reward) => ({
    ...reward,
    type: reward.level === 10 ? 'skin' : reward.type,
    imageUrl: reward.level === 10 ? 'https://res.cloudinary.com/demo/image/upload/skin.png' : reward.imageUrl
}));
const configuredRewards = require('../apps/server/platform/progression').sanitizeVisualRewards(customRewards);
assert.strictEqual(configuredRewards[0].type, 'skin');
assert.strictEqual(configuredRewards[0].imageUrl, customRewards[0].imageUrl);
assert.strictEqual(configuredRewards[0].level, 10);
assert.strictEqual(
    require('../apps/server/platform/progression').sanitizeVisualRewards([{ level: 10, imageUrl: 'javascript:alert(1)' }])[0].imageUrl,
    ''
);
const unlockSkin = { xp: 1420, unlockedRewards: [] };
const unlockSkinResult = applyMatch(unlockSkin, { score: 300, eliminations: 2, position: 1 }, '2026-10-04', customRewards);
assert.strictEqual(unlockSkinResult.unlockedRewards[0].type, 'skin');
assert.strictEqual(unlockSkinResult.unlockedRewards[0].imageUrl, customRewards[0].imageUrl);

const ranking = rankEntries([
    { nickname: 'Beto', xp: 305, uid: 'private-1' },
    { nickname: 'Ana', xp: 305, uid: 'private-2' },
    { nickname: 'Cris', xp: 155, uid: 'private-3' }
]);
assert.deepStrictEqual(ranking.map((entry) => [entry.rank, entry.nickname, entry.level]), [
    [1, 'Ana', 3],
    [1, 'Beto', 3],
    [3, 'Cris', 2]
]);
assert.deepStrictEqual(Object.keys(ranking[0]).sort(), ['level', 'nickname', 'rank', 'xp']);

const claims = {};
assert.strictEqual(claimReward(claims, 'r1'), true);
assert.strictEqual(claimReward(claims, 'r1'), false);

const audit = createAuditEvent('TEST', 'u1', { token: 'secret', ok: true });
assert.strictEqual(audit.data.token, '[REDACTED]');
assert.strictEqual(audit.data.ok, true);

console.log('OK platform domain: inventory, progression, rewards and audit boundaries.');
