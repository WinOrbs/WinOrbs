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

const AURA_REWARDS = Object.freeze([
    Object.freeze({ id: 'level-aura-10', level: 10, name: 'Pulso Cian', color: '#22d3ee' }),
    Object.freeze({ id: 'level-aura-20', level: 20, name: 'Brote Esmeralda', color: '#34d399' }),
    Object.freeze({ id: 'level-aura-30', level: 30, name: 'Vórtice Violeta', color: '#a78bfa' }),
    Object.freeze({ id: 'level-aura-40', level: 40, name: 'Llama Carmesí', color: '#fb7185' }),
    Object.freeze({ id: 'level-aura-50', level: 50, name: 'Corona Solar', color: '#fbbf24' }),
    Object.freeze({ id: 'level-aura-60', level: 60, name: 'Núcleo Glacial', color: '#7dd3fc' }),
    Object.freeze({ id: 'level-aura-70', level: 70, name: 'Pulso Magenta', color: '#e879f9' }),
    Object.freeze({ id: 'level-aura-80', level: 80, name: 'Energía Lima', color: '#a3e635' }),
    Object.freeze({ id: 'level-aura-90', level: 90, name: 'Luz Carmesí', color: '#f87171' }),
    Object.freeze({ id: 'level-aura-100', level: 100, name: 'Aura Prisma', color: '#f8fafc' })
]);

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

function applyMatch(progress, match, date = utcDay()) {
    if (!progress || typeof progress !== 'object' || !match || typeof match !== 'object') {
        return { xpAwarded: 0, completedMissions: [], unlockedAuras: [] };
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

    const unlocked = Array.isArray(progress.unlockedAuras) ? progress.unlockedAuras : [];
    const unlockedAuras = AURA_REWARDS.filter((reward) =>
        reward.level <= progress.level &&
        !unlocked.some((aura) => aura && aura.id === reward.id)
    );
    progress.unlockedAuras = unlocked.concat(unlockedAuras);

    return { xpAwarded, completedMissions, unlockedAuras };
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
    AURA_REWARDS,
    addXp,
    applyMatch,
    levelForXp,
    rankEntries,
    snapshot,
    utcDay,
    xpForNextLevel
});
