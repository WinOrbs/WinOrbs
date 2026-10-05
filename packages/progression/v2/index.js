'use strict';

const crypto = require('crypto');
const {
    SCHEMA_VERSION,
    GAME_EVENT_TYPES
} = require('../../contracts/v2');
const {
    validateGameEvent,
    validateMatchResult
} = require('../../contracts/v2/validation');
const { assertRepository } = require('../../persistence/v2');

const PROGRESSION_ERRORS = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_POLICY: 'INVALID_POLICY',
    INVALID_MISSION: 'INVALID_MISSION',
    INVALID_EVENT: 'INVALID_EVENT',
    EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
    EVENT_NOT_AUTHORITATIVE: 'EVENT_NOT_AUTHORITATIVE',
    INVALID_RESULT: 'INVALID_RESULT',
    RESULT_NOT_FOUND: 'RESULT_NOT_FOUND',
    RESULT_NOT_LOCKED: 'RESULT_NOT_LOCKED',
    RESULT_INTEGRITY_ERROR: 'RESULT_INTEGRITY_ERROR',
    PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
    PROFILE_INTEGRITY_ERROR: 'PROFILE_INTEGRITY_ERROR',
    UNSUPPORTED_PROFILE_VERSION: 'UNSUPPORTED_PROFILE_VERSION',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    REWARD_INTEGRITY_ERROR: 'REWARD_INTEGRITY_ERROR',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR'
});

const MISSION_OBJECTIVES = Object.freeze([
    'MATCHES_PLAYED',
    'MATCHES_COMPLETED',
    'MATCHES_WON',
    'ELIMINATIONS',
    'ORBS_COLLECTED'
]);

const DEFAULT_POLICY = Object.freeze({
    progressionVersion: 'progression-v1',
    xpRulesVersion: 'xp-rules-v1',
    levelCurveVersion: 'level-curve-v1',
    eventXp: Object.freeze({
        OrbCollected: 2,
        PlayerKilled: 10
    }),
    matchXp: Object.freeze({
        participation: 25,
        winnerBonus: 50,
        drawBonus: 15
    })
});
const DEFAULT_LEVEL_CURVE = Object.freeze({ baseXpPerLevel: 100 });

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function validId(value) {
    return typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function exactKeys(value, required, optional = []) {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowed.has(key));
}

function failure(code) {
    return { ok: false, error: { code } };
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function resultHashIsValid(result) {
    const unsigned = { ...result, resultHash: '' };
    return crypto.createHash('sha256')
        .update(canonical(unsigned))
        .digest('hex') === result.resultHash;
}

function getXpRequiredForLevel(level, curve = DEFAULT_LEVEL_CURVE) {
    if (!Number.isSafeInteger(level) || level < 1) {
        throw new RangeError('level must be a positive safe integer');
    }
    if (!isRecord(curve) || !Number.isSafeInteger(curve.baseXpPerLevel) ||
        curve.baseXpPerLevel < 1) {
        throw new TypeError('A valid level curve is required');
    }
    const required = BigInt(curve.baseXpPerLevel) *
        BigInt(level - 1) * BigInt(level) / 2n;
    if (required > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError('level exceeds the supported XP curve');
    }
    return Number(required);
}

function getLevelForXp(totalXp, curve = DEFAULT_LEVEL_CURVE) {
    if (!Number.isSafeInteger(totalXp) || totalXp < 0) {
        throw new RangeError('totalXp must be a non-negative safe integer');
    }
    if (!isRecord(curve) || !Number.isSafeInteger(curve.baseXpPerLevel) ||
        curve.baseXpPerLevel < 1) {
        throw new TypeError('A valid level curve is required');
    }
    let level = Math.floor(
        (1 + Math.sqrt(1 + (8 * totalXp / curve.baseXpPerLevel))) / 2
    );
    const total = BigInt(totalXp);
    const required = (candidate) => BigInt(curve.baseXpPerLevel) *
        BigInt(candidate - 1) * BigInt(candidate) / 2n;
    while (required(level + 1) <= total) level += 1;
    while (required(level) > total) level -= 1;
    return level;
}

function profileKey(userId) {
    return userId;
}

function missionKey(missionId, version) {
    return `${missionId}@${version}`;
}

function validateMission(definition) {
    if (!exactKeys(definition, [
        'missionId',
        'version',
        'title',
        'description',
        'category',
        'objective',
        'target',
        'xpReward',
        'rewardDefinition',
        'active'
    ]) ||
        !validId(definition.missionId) ||
        !validId(definition.version) ||
        typeof definition.title !== 'string' || !definition.title.trim() ||
        typeof definition.description !== 'string' ||
        typeof definition.category !== 'string' || !validId(definition.category) ||
        !MISSION_OBJECTIVES.includes(definition.objective) ||
        !Number.isSafeInteger(definition.target) || definition.target < 1 ||
        !Number.isSafeInteger(definition.xpReward) || definition.xpReward < 0 ||
        typeof definition.active !== 'boolean' ||
        !(definition.rewardDefinition === null ||
            validateRewardDefinition(definition.rewardDefinition))) {
        return false;
    }
    return true;
}

function validateRewardDefinition(definition) {
    if (!exactKeys(definition, ['type', 'definitionId']) ||
        !['badge', 'cosmetic', 'title'].includes(definition.type) ||
        !validId(definition.definitionId)) {
        return false;
    }
    return true;
}

function createProgressionService({
    persistence,
    clock,
    policy = DEFAULT_POLICY,
    missions = [],
    levelCurves = {
        [DEFAULT_POLICY.levelCurveVersion]: DEFAULT_LEVEL_CURVE
    }
} = {}) {
    if (!persistence || typeof persistence !== 'object') {
        throw new TypeError('Persistence repositories are required');
    }
    for (const name of [
        'MatchRepository',
        'ProgressionRepository',
        'RewardRepository',
        'IdempotencyRepository'
    ]) {
        assertRepository(persistence[name], name);
    }
    if (typeof persistence.runInTransaction !== 'function') {
        throw new TypeError('runInTransaction must be implemented');
    }
    if (typeof clock !== 'function') {
        throw new TypeError('A controlled server clock function is required');
    }
    if (!isRecord(policy) ||
        !validId(policy.progressionVersion) ||
        !validId(policy.xpRulesVersion) ||
        !validId(policy.levelCurveVersion) ||
        !isRecord(policy.eventXp) ||
        !isRecord(policy.matchXp) ||
        !Number.isSafeInteger(policy.matchXp.participation) ||
        policy.matchXp.participation < 0 ||
        !Number.isSafeInteger(policy.matchXp.winnerBonus) ||
        policy.matchXp.winnerBonus < 0 ||
        !Number.isSafeInteger(policy.matchXp.drawBonus) ||
        policy.matchXp.drawBonus < 0 ||
        Object.entries(policy.eventXp).some(([type, xp]) =>
            !GAME_EVENT_TYPES.includes(type) ||
            !Number.isSafeInteger(xp) || xp < 0)) {
        throw new TypeError(PROGRESSION_ERRORS.INVALID_POLICY);
    }
    if (!Array.isArray(missions) || missions.some((mission) => !validateMission(mission)) ||
        new Set(missions.map((mission) => missionKey(mission.missionId, mission.version))).size !==
            missions.length) {
        throw new TypeError(PROGRESSION_ERRORS.INVALID_MISSION);
    }
    if (!isRecord(levelCurves) ||
        Object.entries(levelCurves).some(([version, curve]) =>
            !validId(version) || !isRecord(curve) ||
            !Number.isSafeInteger(curve.baseXpPerLevel) || curve.baseXpPerLevel < 1) ||
        !Object.hasOwn(levelCurves, policy.levelCurveVersion)) {
        throw new TypeError(PROGRESSION_ERRORS.INVALID_POLICY);
    }

    const configuredPolicy = deepFreeze(clone(policy));
    const configuredMissions = deepFreeze(clone(missions));
    const configuredLevelCurves = deepFreeze(clone(levelCurves));

    function createProfile(userId, now) {
        return {
            userId,
            schemaVersion: SCHEMA_VERSION,
            progressionVersion: configuredPolicy.progressionVersion,
            xpRulesVersion: configuredPolicy.xpRulesVersion,
            levelCurveVersion: configuredPolicy.levelCurveVersion,
            level: 1,
            totalXp: 0,
            updatedAt: now,
            version: 1,
            missionProgress: {}
        };
    }

    function validateProfile(profile, userId) {
        if (!isRecord(profile) ||
            profile.userId !== userId ||
            profile.schemaVersion !== SCHEMA_VERSION ||
            !validId(profile.progressionVersion) ||
            !validId(profile.xpRulesVersion) ||
            !validId(profile.levelCurveVersion) ||
            !Number.isSafeInteger(profile.level) || profile.level < 1 ||
            !Number.isSafeInteger(profile.totalXp) || profile.totalXp < 0 ||
            !Number.isSafeInteger(profile.updatedAt) || profile.updatedAt < 0 ||
            !Number.isSafeInteger(profile.version) || profile.version < 1 ||
            !isRecord(profile.missionProgress)) {
            return false;
        }
        const curve = configuredLevelCurves[profile.levelCurveVersion];
        if (curve && profile.level !== getLevelForXp(profile.totalXp, curve)) {
            return false;
        }
        return Object.entries(profile.missionProgress).every(([key, progress]) =>
            isRecord(progress) &&
            key === missionKey(progress.missionId, progress.missionVersion) &&
            progress.userId === userId &&
            validId(progress.missionId) &&
            validId(progress.missionVersion) &&
            Number.isSafeInteger(progress.progress) && progress.progress >= 0 &&
            Number.isSafeInteger(progress.target) && progress.target >= 1 &&
            progress.progress <= progress.target &&
            typeof progress.completed === 'boolean' &&
            progress.completed === (progress.progress === progress.target) &&
            (progress.completedAt === null ||
                (Number.isSafeInteger(progress.completedAt) && progress.completedAt >= 0)) &&
            (!progress.completed || progress.completedAt !== null) &&
            typeof progress.rewardClaimed === 'boolean' &&
            Number.isSafeInteger(progress.version) && progress.version >= 1 &&
            Number.isSafeInteger(progress.updatedAt) && progress.updatedAt >= 0);
    }

    async function loadProfiles(tx, userIds, now) {
        const profiles = new Map();
        for (const userId of [...new Set(userIds)].sort()) {
            if (!validId(userId)) return failure(PROGRESSION_ERRORS.INVALID_EVENT);
            let profile = await tx.ProgressionRepository.getByUserId(
                profileKey(userId), tx.transaction
            );
            if (profile === null || profile === undefined) {
                profile = createProfile(userId, now);
            } else if (!validateProfile(profile, userId)) {
                return failure(PROGRESSION_ERRORS.PROFILE_INTEGRITY_ERROR);
            } else if (!Object.hasOwn(configuredLevelCurves, profile.levelCurveVersion)) {
                return failure(PROGRESSION_ERRORS.UNSUPPORTED_PROFILE_VERSION);
            }
            profiles.set(userId, clone(profile));
        }
        return { ok: true, profiles };
    }

    function addXp(profile, amount, now) {
        if (!Number.isSafeInteger(amount) || amount < 0 ||
            !Number.isSafeInteger(profile.totalXp + amount)) {
            return false;
        }
        profile.totalXp += amount;
        profile.level = getLevelForXp(
            profile.totalXp,
            configuredLevelCurves[profile.levelCurveVersion]
        );
        profile.xpRulesVersion = configuredPolicy.xpRulesVersion;
        profile.progressionVersion = configuredPolicy.progressionVersion;
        profile.updatedAt = now;
        return true;
    }

    function progressFor(profile, mission) {
        const key = missionKey(mission.missionId, mission.version);
        if (!profile.missionProgress[key]) {
            profile.missionProgress[key] = {
                userId: profile.userId,
                missionId: mission.missionId,
                missionVersion: mission.version,
                progress: 0,
                target: mission.target,
                completed: false,
                completedAt: null,
                rewardClaimed: mission.rewardDefinition === null,
                version: 1,
                updatedAt: profile.updatedAt
            };
        }
        return profile.missionProgress[key];
    }

    function objectiveDelta(mission, fact) {
        if (fact.kind === 'event') {
            if (mission.objective === 'ORBS_COLLECTED' &&
                fact.event.type === 'OrbCollected' &&
                fact.event.payload.actorId === fact.actorId) return 1;
            return 0;
        }
        const participant = fact.participant;
        switch (mission.objective) {
            case 'MATCHES_PLAYED':
            case 'MATCHES_COMPLETED':
                return 1;
            case 'MATCHES_WON':
                return fact.rank === 1 ? 1 : 0;
            case 'ELIMINATIONS':
                return Number.isSafeInteger(participant.statistics.kills)
                    ? participant.statistics.kills
                    : 0;
            case 'ORBS_COLLECTED':
            default:
                return 0;
        }
    }

    function rewardId(userId, mission) {
        const identity = JSON.stringify([
            userId,
            mission.missionId,
            mission.version
        ]);
        return `progression-reward:${crypto.createHash('sha256')
            .update(identity)
            .digest('hex')}`;
    }

    async function applyFacts(tx, profiles, facts, sourceId, now) {
        const pendingRewards = [];
        for (const fact of facts) {
            const profile = profiles.get(fact.actorId);
            if (!profile) continue;
            if (!addXp(profile, fact.xp, now)) {
                return failure(PROGRESSION_ERRORS.PROFILE_INTEGRITY_ERROR);
            }
            for (const mission of configuredMissions) {
                if (!mission.active) continue;
                const delta = objectiveDelta(mission, fact);
                if (delta <= 0) continue;
                const progress = progressFor(profile, mission);
                if (progress.completed) continue;
                progress.progress = Math.min(mission.target, progress.progress + delta);
                progress.version += 1;
                progress.updatedAt = now;
                if (progress.progress === mission.target) {
                    progress.completed = true;
                    progress.completedAt = now;
                    if (mission.rewardDefinition) {
                        const id = rewardId(fact.actorId, mission);
                        const prior = await tx.RewardRepository.getById(id, tx.transaction);
                        if (prior && (
                            prior.userId !== fact.actorId ||
                            prior.missionId !== mission.missionId ||
                            prior.missionVersion !== mission.version ||
                            canonical(prior.definition) !== canonical(mission.rewardDefinition)
                        )) {
                            return failure(PROGRESSION_ERRORS.REWARD_INTEGRITY_ERROR);
                        }
                        progress.rewardClaimed = Boolean(prior);
                        if (!prior) {
                            progress.rewardClaimed = true;
                            pendingRewards.push({
                                id,
                                record: {
                                    rewardId: id,
                                    userId: fact.actorId,
                                    missionId: mission.missionId,
                                    missionVersion: mission.version,
                                    definition: clone(mission.rewardDefinition),
                                    sourceId,
                                    grantedAt: now,
                                    version: 1
                                }
                            });
                        }
                    }
                    if (!addXp(profile, mission.xpReward, now)) {
                        return failure(PROGRESSION_ERRORS.PROFILE_INTEGRITY_ERROR);
                    }
                }
            }
        }
        return { ok: true, pendingRewards };
    }

    async function commitProcessing(tx, scope, idempotencyKey, requestHash, response,
        profiles, pendingRewards, now) {
        for (const profile of profiles.values()) {
            profile.level = getLevelForXp(
                profile.totalXp,
                configuredLevelCurves[profile.levelCurveVersion]
            );
            profile.updatedAt = now;
            profile.version += 1;
        }
        response.data.profiles = [...profiles.values()].map(clone);
        const claimed = await tx.IdempotencyRepository.claim(
            scope,
            idempotencyKey,
            { requestHash, response },
            tx.transaction
        );
        if (!claimed.claimed) {
            return claimed.record?.requestHash === requestHash
                ? claimed.record.response
                : failure(PROGRESSION_ERRORS.IDEMPOTENCY_CONFLICT);
        }
        for (const { id, record } of pendingRewards) {
            await tx.RewardRepository.create(id, record, tx.transaction);
        }
        for (const [userId, profile] of profiles) {
            await tx.ProgressionRepository.replaceForUser(
                profileKey(userId), profile, tx.transaction
            );
        }
        return response;
    }

    async function processGameEvent(request) {
        if (!exactKeys(request, ['matchId', 'eventId']) ||
            !validId(request.matchId) || !validId(request.eventId)) {
            return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        }
        const scope = `progression:game-event:${request.matchId}`;
        const requestHash = crypto.createHash('sha256')
            .update(JSON.stringify([request.matchId, request.eventId]))
            .digest('hex');
        try {
            return await persistence.runInTransaction(async (tx) => {
                const prior = await tx.IdempotencyRepository.getByKey(
                    scope, request.eventId, tx.transaction
                );
                if (prior) {
                    return prior.requestHash === requestHash
                        ? prior.response
                        : failure(PROGRESSION_ERRORS.IDEMPOTENCY_CONFLICT);
                }
                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                if (!match) return failure(PROGRESSION_ERRORS.EVENT_NOT_FOUND);
                const event = match.matchPersistence?.events?.find((candidate) =>
                    candidate.eventId === request.eventId);
                if (!event) return failure(PROGRESSION_ERRORS.EVENT_NOT_FOUND);
                if (!validateGameEvent(event).ok ||
                    event.matchId !== request.matchId ||
                    event.sequence > match.matchPersistence.eventSequence) {
                    return failure(PROGRESSION_ERRORS.INVALID_EVENT);
                }
                let actorId = event.actorId;
                if (event.type === 'PlayerKilled') {
                    if (event.payload.killerId === null) {
                        if (event.actorId !== event.payload.actorId) {
                            return failure(PROGRESSION_ERRORS.EVENT_NOT_AUTHORITATIVE);
                        }
                        actorId = null;
                    } else if (event.actorId !== event.payload.killerId) {
                        return failure(PROGRESSION_ERRORS.EVENT_NOT_AUTHORITATIVE);
                    } else {
                        actorId = event.payload.killerId === event.payload.actorId
                            ? null
                            : event.payload.killerId;
                    }
                } else if (event.type === 'OrbCollected') {
                    if (event.actorId !== event.payload.actorId) {
                        return failure(PROGRESSION_ERRORS.EVENT_NOT_AUTHORITATIVE);
                    }
                    actorId = event.payload.actorId;
                }
                const members = match.matchPersistence.snapshot?.value?.memberActorIds ||
                    match.matchPersistence.snapshot?.value?.members?.map((member) =>
                        member.actorId) || [];
                const authoritativeActor = validId(actorId) && members.includes(actorId);
                const eligibleXp = actorId &&
                    Object.hasOwn(configuredPolicy.eventXp, event.type)
                    ? configuredPolicy.eventXp[event.type]
                    : 0;
                const applicableMission = configuredMissions.some((mission) =>
                    mission.active &&
                    objectiveDelta(mission, { kind: 'event', event, actorId }) > 0);
                const facts = authoritativeActor && (eligibleXp > 0 || applicableMission)
                    ? [{
                        kind: 'event',
                        event,
                        actorId,
                        xp: eligibleXp
                    }]
                    : [];
                const profilesResult = await loadProfiles(
                    tx,
                    facts.length > 0 ? [actorId] : [],
                    now
                );
                if (!profilesResult.ok) return profilesResult;
                const applied = await applyFacts(
                    tx, profilesResult.profiles, facts, request.eventId, now
                );
                if (!applied.ok) return applied;
                const response = {
                    ok: true,
                    data: {
                        source: 'GAME_EVENT',
                        matchId: request.matchId,
                        eventId: request.eventId,
                        processed: true,
                        actorId: authoritativeActor && facts.length > 0 ? actorId : null,
                        profiles: [...profilesResult.profiles.values()].map(clone)
                    }
                };
                return commitProcessing(
                    tx,
                    scope,
                    request.eventId,
                    requestHash,
                    response,
                    profilesResult.profiles,
                    applied.pendingRewards,
                    now
                );
            });
        } catch {
            return failure(PROGRESSION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function processMatchResult(request) {
        if (!exactKeys(request, ['matchId', 'resultId']) ||
            !validId(request.matchId) || !validId(request.resultId)) {
            return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        }
        const scope = `progression:match-result:${request.matchId}`;
        const requestHash = crypto.createHash('sha256')
            .update(JSON.stringify([request.matchId, request.resultId]))
            .digest('hex');
        try {
            return await persistence.runInTransaction(async (tx) => {
                const prior = await tx.IdempotencyRepository.getByKey(
                    scope, request.resultId, tx.transaction
                );
                if (prior) {
                    return prior.requestHash === requestHash
                        ? prior.response
                        : failure(PROGRESSION_ERRORS.IDEMPOTENCY_CONFLICT);
                }
                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                if (!match) return failure(PROGRESSION_ERRORS.RESULT_NOT_FOUND);
                if (!['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(match.status) ||
                    !Number.isSafeInteger(match.matchPersistence?.resultLockedAt) ||
                    match.matchPersistence.resultLockedAt < 0 ||
                    !match.result || match.result.locked !== true ||
                    !isRecord(match.result.value)) {
                    return failure(PROGRESSION_ERRORS.RESULT_NOT_LOCKED);
                }
                const result = match.result.value;
                if (result.resultId !== request.resultId ||
                    result.matchId !== request.matchId ||
                    match.resultVersion !== match.matchPersistence.resultVersion) {
                    return failure(PROGRESSION_ERRORS.RESULT_INTEGRITY_ERROR);
                }
                if (!validateMatchResult(result).ok || !resultHashIsValid(result)) {
                    return failure(PROGRESSION_ERRORS.INVALID_RESULT);
                }
                const participants = result.participants;
                const profileResult = await loadProfiles(
                    tx,
                    participants.map((participant) => participant.actorId),
                    now
                );
                if (!profileResult.ok) return profileResult;
                const winningActorIds = new Set(result.rankings
                    .filter((ranking) => ranking.rank === 1)
                    .flatMap((ranking) => ranking.actorIds));
                const draw = result.finishReason === 'DRAW' || winningActorIds.size > 1;
                const facts = participants.map((participant) => ({
                    kind: 'result',
                    participant,
                    actorId: participant.actorId,
                    rank: winningActorIds.has(participant.actorId) ? 1 : null,
                    xp: configuredPolicy.matchXp.participation +
                        (draw
                            ? configuredPolicy.matchXp.drawBonus
                            : winningActorIds.has(participant.actorId)
                                ? configuredPolicy.matchXp.winnerBonus
                                : 0)
                }));
                const applied = await applyFacts(
                    tx, profileResult.profiles, facts, request.resultId, now
                );
                if (!applied.ok) return applied;
                const response = {
                    ok: true,
                    data: {
                        source: 'MATCH_RESULT',
                        matchId: request.matchId,
                        resultId: request.resultId,
                        resultVersion: match.resultVersion,
                        processed: true,
                        profiles: [...profileResult.profiles.values()].map(clone)
                    }
                };
                return commitProcessing(
                    tx,
                    scope,
                    request.resultId,
                    requestHash,
                    response,
                    profileResult.profiles,
                    applied.pendingRewards,
                    now
                );
            });
        } catch {
            return failure(PROGRESSION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function getProfile(userId) {
        if (!validId(userId)) return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        try {
            const profile = await persistence.ProgressionRepository.getByUserId(userId);
            if (!profile) return failure(PROGRESSION_ERRORS.PROFILE_NOT_FOUND);
            if (!validateProfile(profile, userId)) {
                return failure(PROGRESSION_ERRORS.PROFILE_INTEGRITY_ERROR);
            }
            if (!Object.hasOwn(configuredLevelCurves, profile.levelCurveVersion)) {
                return failure(PROGRESSION_ERRORS.UNSUPPORTED_PROFILE_VERSION);
            }
            return { ok: true, data: deepFreeze(clone(profile)) };
        } catch {
            return failure(PROGRESSION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function getMissionReward(userId, missionId, version) {
        if (!validId(userId) || !validId(missionId) || !validId(version)) {
            return failure(PROGRESSION_ERRORS.INVALID_REQUEST);
        }
        try {
            const reward = await persistence.RewardRepository.getById(
                rewardId(userId, { missionId, version })
            );
            return reward
                ? { ok: true, data: deepFreeze(clone(reward)) }
                : failure(PROGRESSION_ERRORS.REWARD_INTEGRITY_ERROR);
        } catch {
            return failure(PROGRESSION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    return Object.freeze({
        processGameEvent,
        processMatchResult,
        getProfile,
        getMissionReward,
        getXpRequiredForLevel,
        getLevelForXp
    });
}

module.exports = Object.freeze({
    DEFAULT_POLICY,
    DEFAULT_LEVEL_CURVE,
    MISSION_OBJECTIVES,
    PROGRESSION_ERRORS,
    createProgressionService,
    getLevelForXp,
    getXpRequiredForLevel
});
