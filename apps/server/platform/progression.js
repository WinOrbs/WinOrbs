'use strict';

const MAX_LEVEL = 100;
const XP_FIRST_LEVEL = 150;
const XP_LEVEL_INCREMENT = 5;

const DAILY_MISSIONS = Object.freeze([
    Object.freeze({ id: 'play-one', description: 'Termina 1 partida', xp: 15, target: 1, stat: 'matchesCompleted' }),
    Object.freeze({ id: 'play-three', description: 'Termina 3 partidas', xp: 30, target: 3, stat: 'matchesCompleted' }),
    Object.freeze({ id: 'score-250', description: 'Consigue 250 puntos en una partida', xp: 25, target: 250, stat: 'bestScore' }),
    Object.freeze({ id: 'top-three', description: 'Queda entre los 3 primeros', xp: 35, target: 1, stat: 'topThree' }),
    Object.freeze({ id: 'two-eliminations', description: 'Consigue 2 eliminaciones en el día', xp: 45, target: 2, stat: 'eliminations' })
]);

const DEFAULT_VISUAL_REWARDS = Object.freeze([
    Object.freeze({ id: 'level-aura-10', level: 10, type: 'aura', name: 'Pulso Cian', color: '#22d3ee', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-20', level: 20, type: 'aura', name: 'Brote Esmeralda', color: '#34d399', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-30', level: 30, type: 'aura', name: 'Vórtice Violeta', color: '#a78bfa', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-40', level: 40, type: 'aura', name: 'Llama Carmesí', color: '#fb7185', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-50', level: 50, type: 'aura', name: 'Corona Solar', color: '#fbbf24', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-60', level: 60, type: 'aura', name: 'Núcleo Glacial', color: '#7dd3fc', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-70', level: 70, type: 'aura', name: 'Pulso Magenta', color: '#e879f9', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-80', level: 80, type: 'aura', name: 'Energía Lima', color: '#a3e635', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-90', level: 90, type: 'aura', name: 'Luz Carmesí', color: '#f87171', imageUrl: '' }),
    Object.freeze({ id: 'level-aura-100', level: 100, type: 'aura', name: 'Aura Prisma', color: '#f8fafc', imageUrl: '' })
]);

function sanitizeVisualRewards(value) {
    const source = Array.isArray(value) ? value : [];
    return Object.freeze(DEFAULT_VISUAL_REWARDS.map((fallback) => {
        const item = source.find((reward) => reward && reward.level === fallback.level) || {};
        const imageUrl = typeof item.imageUrl === 'string' &&
            /^https:\/\/[^\s'"<>]{10,500}$/i.test(item.imageUrl.trim()) &&
            encodeURIComponent(item.imageUrl.trim()).length <= 260
            ? item.imageUrl.trim()
            : '';
        const color = typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)
            ? item.color
            : fallback.color;
        return Object.freeze({
            id: fallback.id,
            level: fallback.level,
            type: item.type === 'skin' ? 'skin' : 'aura',
            name: String(item.name || fallback.name).replace(/[<>&"'`]/g, '').trim().slice(0, 32) || fallback.name,
            color,
            imageUrl,
            c1: typeof item.c1 === 'string' && /^#[0-9a-f]{6}$/i.test(item.c1) ? item.c1 : color,
            c2: typeof item.c2 === 'string' && /^#[0-9a-f]{6}$/i.test(item.c2) ? item.c2 : color,
            border: typeof item.border === 'string' && /^#[0-9a-f]{6}$/i.test(item.border) ? item.border : color
        });
    }));
}

function normalizedXp(value) {
    const xp = Number(value);
    return Number.isFinite(xp) && xp > 0 ? xp : 0;
}

function xpForNextLevel(level) {
    const currentLevel = Math.max(1, Math.floor(Number(level) || 1));
    return currentLevel >= MAX_LEVEL
        ? 0
        : XP_FIRST_LEVEL + XP_LEVEL_INCREMENT * (currentLevel - 1);
}

function levelForXp(amount) {
    let remaining = normalizedXp(amount);
    let level = 1;
    while (level < MAX_LEVEL) {
        const required = xpForNextLevel(level);
        if (remaining < required) break;
        remaining -= required;
        level++;
    }
    return level;
}

function addXp(progress, amount) {
    if (!progress || typeof progress !== 'object') return false;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) return false;
    progress.xp = normalizedXp(progress.xp) + value;
    progress.level = levelForXp(progress.xp);
    return true;
}

function snapshot(progress) {
    const xp = normalizedXp(progress?.xp);
    return Object.freeze({
        xp,
        level: levelForXp(xp)
    });
}

function utcDay(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function freshDailyProgress(date) {
    return {
        date,
        matchesCompleted: 0,
        eliminations: 0,
        bestScore: 0,
        topThree: 0,
        completed: {}
    };
}

function applyMatch(progress, match, date = utcDay(), visualRewards = DEFAULT_VISUAL_REWARDS) {
    if (!progress || typeof progress !== 'object' || !match || typeof match !== 'object') {
        return { xpAwarded: 0, completedMissions: [], unlockedRewards: [] };
    }

    const daily = progress.daily && progress.daily.date === date
        ? Object.assign(freshDailyProgress(date), progress.daily, {
            completed: Object.assign({}, progress.daily.completed || {})
        })
        : freshDailyProgress(date);
    const beforeLevel = levelForXp(progress.xp);
    const score = Math.max(0, Number(match.score) || 0);
    const eliminations = Math.max(0, Math.floor(Number(match.eliminations) || 0));
    daily.matchesCompleted++;
    daily.eliminations += eliminations;
    daily.bestScore = Math.max(daily.bestScore, score);
    if (Number(match.position) >= 1 && Number(match.position) <= 3) daily.topThree = 1;

    const stats = {
        matchesCompleted: daily.matchesCompleted,
        eliminations: daily.eliminations,
        bestScore: daily.bestScore,
        topThree: daily.topThree
    };
    const completedMissions = [];
    let xpAwarded = 0;
    for (const mission of DAILY_MISSIONS) {
        if (!daily.completed[mission.id] && stats[mission.stat] >= mission.target) {
            daily.completed[mission.id] = true;
            completedMissions.push(mission.id);
            xpAwarded += mission.xp;
        }
    }

    progress.daily = daily;
    if (xpAwarded > 0) {
        progress.xp = normalizedXp(progress.xp) + xpAwarded;
        progress.level = levelForXp(progress.xp);
    } else {
        progress.xp = normalizedXp(progress.xp);
        progress.level = beforeLevel;
    }

    const unlocked = Array.isArray(progress.unlockedRewards)
        ? progress.unlockedRewards
        : (Array.isArray(progress.unlockedAuras) ? progress.unlockedAuras : []);
    const configuredRewards = sanitizeVisualRewards(visualRewards);
    const unlockedRewards = configuredRewards.filter((reward) =>
        reward.level <= progress.level &&
        !unlocked.some((aura) => aura && aura.id === reward.id)
    );
    progress.unlockedRewards = unlocked.concat(unlockedRewards);
    progress.unlockedAuras = progress.unlockedRewards;

    return { xpAwarded, completedMissions, unlockedRewards };
}

function rankEntries(entries, limit = 20) {
    if (!Array.isArray(entries)) return [];
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    const sorted = entries
        .map((entry) => ({
            nickname: String(entry?.nickname || 'Jugador').trim().slice(0, 32) || 'Jugador',
            xp: normalizedXp(entry?.xp),
            level: Math.min(MAX_LEVEL, Math.max(1, levelForXp(entry?.xp)))
        }))
        .sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname, 'es'));
    let rank = 0;
    return sorted.slice(0, safeLimit).map((entry, index, list) => {
        if (index === 0 || entry.xp < list[index - 1].xp) rank = index + 1;
        return Object.freeze({ rank, ...entry });
    });
}

module.exports = Object.freeze({
    MAX_LEVEL,
    DAILY_MISSIONS,
    DEFAULT_VISUAL_REWARDS,
    addXp,
    applyMatch,
    levelForXp,
    rankEntries,
    sanitizeVisualRewards,
    snapshot,
    utcDay,
    xpForNextLevel
});
