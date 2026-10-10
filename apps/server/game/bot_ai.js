'use strict';

const BOT_MODES = Object.freeze({
    COMBAT: 'engage',
    COLLECT: 'loot',
    BANK: 'bank',
    SURVIVE: 'flee',
    PATROL: 'wander'
});

function choosePracticeBotIntent(bot, context) {
    const {
        target,
        targetDistance,
        nearestOrb,
        nearestKit,
        energyItems,
        healthItems,
        bankZone,
        bankDistance,
        bankDetour,
        zoneCritical,
        mapSize
    } = context;
    const previous = bot.botObjective;
    const closeThreat = !!target && targetDistance <= 260;
    const lowHealth = bot.hp < bot.maxHp * 0.38;
    const lockedOrb = previous?.mode === BOT_MODES.COLLECT &&
        previous.resourceType === 'energy'
        ? energyItems.find((item) => item.id === previous.resourceId)
        : null;
    const lockedKit = previous?.mode === BOT_MODES.COLLECT &&
        previous.resourceType === 'health'
        ? healthItems.find((item) => item.id === previous.resourceId)
        : null;
    const lockedOrbDistance = lockedOrb
        ? Math.hypot(lockedOrb.x - bot.x, lockedOrb.y - bot.y)
        : Infinity;
    const lockedKitDistance = lockedKit
        ? Math.hypot(lockedKit.x - bot.x, lockedKit.y - bot.y)
        : Infinity;
    let intent = null;

    if (zoneCritical) {
        const centerDistance = Math.max(1, context.centerDistance);
        intent = {
            mode: BOT_MODES.SURVIVE,
            goal: {
                x: Math.max(bot.radius, Math.min(mapSize - bot.radius,
                    bot.x + (context.zoneCx - bot.x) / centerDistance * 500)),
                y: Math.max(bot.radius, Math.min(mapSize - bot.radius,
                    bot.y + (context.zoneCy - bot.y) / centerDistance * 500))
            }
        };
    } else if (closeThreat && target) {
        intent = { mode: BOT_MODES.COMBAT, goal: target };
    } else if (previous?.mode === BOT_MODES.BANK && bot.charge > 0 && bankZone) {
        intent = { mode: BOT_MODES.BANK, goal: bankZone };
    } else if (bot.charge >= 70 && bankZone && targetDistance > 300 &&
        (bankDistance <= 230 || bankDetour <= 180)) {
        intent = { mode: BOT_MODES.BANK, goal: bankZone };
    } else if (lockedKit && lowHealth && lockedKitDistance <= 280 && targetDistance > 260) {
        intent = {
            mode: BOT_MODES.COLLECT,
            goal: lockedKit,
            resourceType: 'health',
            resourceId: lockedKit.id
        };
    } else if (lockedOrb && bot.charge < 65 &&
        lockedOrbDistance <= 280 && targetDistance > 260) {
        intent = {
            mode: BOT_MODES.COLLECT,
            goal: lockedOrb,
            resourceType: 'energy',
            resourceId: lockedOrb.id
        };
    } else if (lowHealth && nearestKit && nearestKit.dist <= 220 && targetDistance > 260) {
        intent = {
            mode: BOT_MODES.COLLECT,
            goal: nearestKit.item,
            resourceType: 'health',
            resourceId: nearestKit.item.id
        };
    } else {
        const orbDetour = target && nearestOrb
            ? nearestOrb.dist + Math.hypot(
                target.x - nearestOrb.item.x,
                target.y - nearestOrb.item.y
            ) - targetDistance
            : nearestOrb?.dist ?? Infinity;
        if (bot.charge < 65 && nearestOrb && nearestOrb.dist <= 180 &&
            targetDistance > 300 && (!target || orbDetour <= 150)) {
            intent = {
                mode: BOT_MODES.COLLECT,
                goal: nearestOrb.item,
                resourceType: 'energy',
                resourceId: nearestOrb.item.id
            };
        } else if (target) {
            intent = { mode: BOT_MODES.COMBAT, goal: target };
        } else {
            intent = { mode: BOT_MODES.PATROL, goal: null };
        }
    }

    bot.botObjective = {
        mode: intent.mode,
        resourceType: intent.resourceType || null,
        resourceId: intent.resourceId || null
    };
    return intent;
}

module.exports = Object.freeze({ BOT_MODES, choosePracticeBotIntent });
