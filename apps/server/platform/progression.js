'use strict';

const crypto = require('crypto');
const {
    SCHEMA_VERSION,
    MATCH_FINISH_REASONS
} = require('../../../packages/contracts/v2');
const {
    validateGameEvent,
    validateMatchResult
} = require('../../../packages/contracts/v2/validation');
const {
    DEFAULT_LEVEL_CURVE,
    DEFAULT_LEVEL_REWARDS,
    DEFAULT_MISSIONS,
    DEFAULT_POLICY,
    createProgressionService,
    getLevelForXp,
    getXpRequiredForLevel
} = require('../../../packages/progression/v2');
const {
    COLLECTIONS,
    createFirestorePersistence
} = require('../../../packages/infrastructure/firestore/v2');

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
const VISUAL_REWARD_LEVEL_CAP = 100;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value) {
    return typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function hashResult(result) {
    return crypto.createHash('sha256')
        .update(canonical({ ...result, resultHash: '' }))
        .digest('hex');
}

function missionConfig() {
    return Object.freeze(DEFAULT_MISSIONS.map((mission) => Object.freeze({
        id: mission.missionId,
        version: mission.version,
        description: mission.description,
        xp: mission.xpReward,
        target: mission.target,
        objective: mission.objective,
        stat: {
            MATCHES_PLAYED: 'matchesCompleted',
            MATCHES_COMPLETED: 'matchesCompleted',
            MATCHES_WON: 'topThree',
            ELIMINATIONS: 'eliminations',
            ORBS_COLLECTED: 'orbsCollected'
        }[mission.objective]
    })));
}

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

function rankEntries(entries, limit = 20) {
    if (!Array.isArray(entries)) return [];
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    const sorted = entries
        .map((entry) => {
            const xp = Number(entry?.totalXp ?? entry?.xp);
            const totalXp = Number.isSafeInteger(xp) && xp > 0 ? xp : 0;
            return {
                nickname: String(entry?.nickname || 'Jugador').trim().slice(0, 32) || 'Jugador',
                xp: totalXp,
                level: getLevelForXp(totalXp)
            };
        })
        .sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname, 'es'));
    let rank = 0;
    return sorted.slice(0, safeLimit).map((entry, index, list) => {
        if (index === 0 || entry.xp < list[index - 1].xp) rank = index + 1;
        return Object.freeze({ rank, ...entry });
    });
}

function createAuthoritativeMatchAggregate({
    matchId,
    resultId,
    startedAt,
    finishedAt,
    finishReason,
    players,
    events = []
} = {}) {
    if (!validId(matchId) || !validId(resultId) ||
        !Number.isSafeInteger(startedAt) || startedAt < 0 ||
        !Number.isSafeInteger(finishedAt) || finishedAt < startedAt ||
        !MATCH_FINISH_REASONS.includes(finishReason) ||
        !Array.isArray(players) || !Array.isArray(events)) {
        throw new TypeError('Invalid authoritative match result input');
    }

    const participants = [];
    const rankings = [];
    const participantIds = new Set();
    for (const player of players) {
        if (!validId(player?.uid)) continue;
        if (participantIds.has(player.uid) ||
            !Number.isSafeInteger(player.score) || player.score < 0 ||
            !Number.isSafeInteger(player.eliminations) || player.eliminations < 0 ||
            !Number.isSafeInteger(player.position) || player.position < 1) {
            throw new TypeError('Invalid authoritative participant data');
        }
        participantIds.add(player.uid);
        participants.push({
            actorId: player.uid,
            teamId: null,
            status: 'COMPLETED',
            statistics: {
                score: player.score,
                kills: player.eliminations,
                deaths: 0
            }
        });
        rankings.push({ rank: player.position, actorIds: [player.uid], teamId: null });
    }
    if (participants.length === 0) {
        throw new TypeError('An authoritative result requires an authenticated participant');
    }

    const result = {
        schemaVersion: SCHEMA_VERSION,
        resultId,
        matchId,
        rulesVersion: 'winorbs-server-v1',
        startedAt,
        finishedAt,
        finishReason,
        participants,
        rankings,
        teams: [],
        statistics: { durationMs: finishedAt - startedAt },
        resultHash: ''
    };
    result.resultHash = hashResult(result);
    if (!validateMatchResult(result).ok) {
        throw new TypeError('The server-generated match result does not satisfy MatchResult v2');
    }

    const persistedEvents = events.map((event, index) => {
        const value = {
            schemaVersion: SCHEMA_VERSION,
            eventId: `${resultId}:event:${index + 1}`,
            matchId,
            sequence: index + 1,
            timestamp: event.timestamp,
            type: event.type,
            actorId: event.actorId,
            payload: event.payload
        };
        if (!validId(value.eventId) || !validateGameEvent(value).ok) {
            throw new TypeError('The server-generated game event does not satisfy GameEvent v2');
        }
        return value;
    });
    const finishedEvent = {
        schemaVersion: SCHEMA_VERSION,
        eventId: `${resultId}:finished`,
        matchId,
        sequence: persistedEvents.length + 1,
        timestamp: finishedAt,
        type: 'MatchFinished',
        payload: { resultId, finishReason }
    };
    if (!validId(finishedEvent.eventId) || !validateGameEvent(finishedEvent).ok) {
        throw new TypeError('The authoritative MatchFinished event is invalid');
    }
    persistedEvents.push(finishedEvent);

    const actorIds = participants.map((participant) => participant.actorId);
    const matchPersistence = {
        schemaVersion: SCHEMA_VERSION,
        stateVersion: 1,
        eventSequence: persistedEvents.length,
        resultVersion: 'result-v1',
        resultLockedAt: finishedAt,
        snapshot: {
            stateVersion: 1,
            eventSequence: persistedEvents.length,
            value: {
                schemaVersion: SCHEMA_VERSION,
                matchId,
                status: 'RESULT_LOCKED',
                memberActorIds: actorIds,
                members: actorIds.map((actorId) => ({ actorId, ready: true })),
                readyActorIds: actorIds,
                notReadyActorIds: [],
                gameState: {
                    match: { matchId, status: 'RESULT_LOCKED', rulesVersion: result.rulesVersion }
                }
            }
        },
        events: persistedEvents
    };

    return {
        matchId,
        status: 'RESULT_LOCKED',
        rulesVersion: result.rulesVersion,
        resultVersion: 'result-v1',
        result: { locked: true, value: result },
        matchPersistence
    };
}

function createProgressionRuntime({
    firestore,
    persistence = firestore ? createFirestorePersistence({ firestore }) : null,
    clock = Date.now,
    policy = DEFAULT_POLICY,
    missions = DEFAULT_MISSIONS,
    levelRewards = DEFAULT_LEVEL_REWARDS,
    levelCurves = { [DEFAULT_POLICY.levelCurveVersion]: DEFAULT_LEVEL_CURVE }
} = {}) {
    if (!persistence) throw new TypeError('Firestore-backed progression persistence is required');
    const service = createProgressionService({
        persistence,
        clock,
        policy,
        missions,
        levelRewards,
        levelCurves
    });

    async function ensureLegacyProfile(userId) {
        if (!validId(userId)) throw new TypeError('A valid user ID is required');
        const current = await persistence.ProgressionRepository.getByUserId(userId);
        if (current) return current;
        if (!firestore) return null;

        const legacySnapshot = await firestore.collection('progresion').doc(userId).get();
        if (!legacySnapshot.exists) return null;
        const legacy = legacySnapshot.data() || {};
        const rawXp = legacy.xp === undefined ? 0 : Number(legacy.xp);
        if (!Number.isSafeInteger(rawXp) || rawXp < 0) {
            throw new TypeError('Legacy progression contains an invalid XP total');
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            throw new TypeError('Progression clock returned an invalid timestamp');
        }
        const profile = {
            userId,
            schemaVersion: SCHEMA_VERSION,
            progressionVersion: policy.progressionVersion,
            xpRulesVersion: policy.xpRulesVersion,
            levelCurveVersion: policy.levelCurveVersion,
            level: getLevelForXp(rawXp, levelCurves[policy.levelCurveVersion]),
            totalXp: rawXp,
            updatedAt: now,
            version: 1,
            missionProgress: {},
            equippedReward: typeof legacy.equippedReward === 'string'
                ? legacy.equippedReward
                : typeof legacy.equippedAura === 'string' ? legacy.equippedAura : null
        };
        return persistence.runInTransaction(async (tx) => {
            const existing = await tx.ProgressionRepository.getByUserId(
                userId, tx.transaction
            );
            if (existing) return existing;
            await tx.ProgressionRepository.replaceForUser(
                userId, profile, tx.transaction
            );
            return profile;
        });
    }

    async function processAuthoritativeMatch(aggregate) {
        if (!isRecord(aggregate) ||
            aggregate.status !== 'RESULT_LOCKED' ||
            !aggregate.result?.locked ||
            !validateMatchResult(aggregate.result.value).ok ||
            hashResult(aggregate.result.value) !== aggregate.result.value.resultHash ||
            !Array.isArray(aggregate.matchPersistence?.events) ||
            !aggregate.matchPersistence.events.every((event) =>
                validateGameEvent(event).ok && event.matchId === aggregate.matchId)) {
            return { ok: false, error: 'INVALID_AUTHORITATIVE_RESULT' };
        }
        try {
            for (const participant of aggregate.result.value.participants) {
                await ensureLegacyProfile(participant.actorId);
            }
            const stored = await persistence.runInTransaction(async (tx) => {
                const existing = await tx.MatchRepository.getById(
                    aggregate.matchId, tx.transaction
                );
                if (existing) {
                    const sameResult = canonical(existing.result?.value) ===
                        canonical(aggregate.result.value);
                    const sameEvents = canonical(existing.matchPersistence?.events) ===
                        canonical(aggregate.matchPersistence.events);
                    return sameResult && sameEvents
                        ? { ok: true, duplicate: true }
                        : { ok: false, error: 'MATCH_RESULT_CONFLICT' };
                }
                await tx.MatchRepository.create(
                    aggregate.matchId, aggregate, tx.transaction
                );
                return { ok: true, duplicate: false };
            });
            if (!stored.ok) return stored;

            for (const event of aggregate.matchPersistence.events) {
                const processed = await service.processGameEvent({
                    matchId: aggregate.matchId,
                    eventId: event.eventId
                });
                if (!processed.ok) return processed;
            }
            return service.processMatchResult({
                matchId: aggregate.matchId,
                resultId: aggregate.result.value.resultId
            });
        } catch (error) {
            console.error('[PROGRESSION] Could not persist/process authoritative result:', error.message);
            return { ok: false, error: 'PERSISTENCE_ERROR' };
        }
    }

    async function equipVisualReward(userId, rewardId, visualRewards) {
        if (!validId(userId) ||
            (rewardId !== null && typeof rewardId !== 'string')) {
            return { ok: false, error: 'INVALID_REQUEST' };
        }
        const reward = rewardId === null
            ? null
            : visualRewards.find((item) => item.id === rewardId);
        if (rewardId !== null && !reward) return { ok: false, error: 'INVALID_REWARD' };
        try {
            await ensureLegacyProfile(userId);
            return await persistence.runInTransaction(async (tx) => {
                const profile = await tx.ProgressionRepository.getByUserId(
                    userId, tx.transaction
                );
                if (!profile) return { ok: false, error: 'NO_PROGRESS' };
                const level = getLevelForXp(
                    profile.totalXp,
                    levelCurves[profile.levelCurveVersion]
                );
                if (reward && level < reward.level) {
                    return { ok: false, error: 'REWARD_LOCKED' };
                }
                const now = clock();
                if (!Number.isSafeInteger(now) || now < 0) {
                    return { ok: false, error: 'INVALID_REQUEST' };
                }
                const updated = {
                    ...profile,
                    equippedReward: rewardId,
                    updatedAt: now,
                    version: profile.version + 1
                };
                await tx.ProgressionRepository.replaceForUser(
                    userId, updated, tx.transaction
                );
                return { ok: true, rewardId };
            });
        } catch (error) {
            console.error('[PROGRESSION] Could not persist equipped visual reward:', error.message);
            return { ok: false, error: 'SAVE_FAILED' };
        }
    }

    return Object.freeze({
        persistence,
        service,
        ensureLegacyProfile,
        processAuthoritativeMatch,
        equipVisualReward
    });
}

function levelForXp(totalXp) {
    return getLevelForXp(totalXp);
}

function xpForNextLevel(level) {
    return getXpRequiredForLevel(level + 1) - getXpRequiredForLevel(level);
}

function snapshot(progress) {
    const xp = Number(progress?.totalXp ?? progress?.xp) || 0;
    return Object.freeze({ xp, level: getLevelForXp(xp) });
}

module.exports = Object.freeze({
    DEFAULT_LEVEL_CURVE,
    DEFAULT_LEVEL_REWARDS,
    DEFAULT_MISSIONS,
    DEFAULT_POLICY,
    DEFAULT_VISUAL_REWARDS,
    DAILY_MISSIONS: missionConfig(),
    MAX_LEVEL: VISUAL_REWARD_LEVEL_CAP,
    COLLECTIONS,
    createAuthoritativeMatchAggregate,
    createProgressionRuntime,
    getLevelForXp,
    getXpRequiredForLevel,
    levelForXp,
    missionConfig,
    rankEntries,
    sanitizeVisualRewards,
    snapshot,
    xpForNextLevel
});
