'use strict';
const assert = require('assert');
const { hasItem, grantItem, consumeItem } = require('../apps/server/platform/inventory');
const {
    DEFAULT_VISUAL_REWARDS,
    levelForXp,
    missionConfig,
    rankEntries,
    snapshot,
    xpForNextLevel
} = require('../apps/server/platform/progression');
const { DEFAULT_MISSIONS, getLevelForXp } = require('../packages/progression/v2');
const { claimReward } = require('../apps/server/platform/rewards');
const { createAuditEvent } = require('../apps/server/platform/audit');

const inv = {};
assert.strictEqual(grantItem(inv, 'skin-1', 1), true);
assert.strictEqual(hasItem(inv, 'skin-1'), true);
assert.strictEqual(consumeItem(inv, 'skin-1'), true);
assert.strictEqual(hasItem(inv, 'skin-1'), false);

const progress = { totalXp: 300, level: 3 };
assert.deepStrictEqual(snapshot(progress), { xp: 300, level: 3 });
assert.strictEqual(xpForNextLevel(2), 200);
assert.strictEqual(levelForXp(100000), getLevelForXp(100000));
assert.deepStrictEqual(DEFAULT_MISSIONS.map((mission) => mission.missionId), [
    'elimination-one', 'collect-orbs', 'play-one', 'win-one'
]);
assert.deepStrictEqual(missionConfig().map((mission) => mission.id), [
    'elimination-one', 'collect-orbs', 'play-one', 'win-one'
]);
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

console.log('OK platform domain: runtime progression delegates XP, levels and missions to v2.');
