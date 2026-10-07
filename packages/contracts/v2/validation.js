'use strict';

const {
    SCHEMA_VERSION,
    GAME_COMMAND_TYPES,
    GAME_EVENT_TYPES,
    MATCH_LIFECYCLE,
    MATCH_FINISH_REASONS,
    CONTRACT_ERRORS
} = require('./index');

const COMMAND_PAYLOAD_KEYS = Object.freeze({
    MovePlayer: ['direction'],
    Shoot: ['angle'],
    Dash: [],
    ThrowBomb: ['angle'],
    SwitchWeapon: ['weapon'],
    Reload: [],
    PickupLoot: ['lootId'],
    Respawn: []
});

const EVENT_PAYLOAD_KEYS = Object.freeze({
    PlayerMoved: ['actorId', 'position', 'velocity'],
    ShotFired: ['actorId', 'weapon', 'projectileId'],
    DamageApplied: ['targetId', 'amount', 'absorbed', 'health', 'cause'],
    PlayerKilled: ['actorId', 'killerId'],
    PlayerDied: ['actorId', 'cause'],
    OrbDropped: ['orbId', 'position', 'amount'],
    OrbCollected: ['actorId', 'orbId', 'amount'],
    LootSpawned: ['lootId', 'lootType', 'position'],
    LootCollected: ['actorId', 'lootId', 'lootType'],
    PlayerRespawned: ['actorId', 'position'],
    ZoneUpdated: ['center', 'radius', 'phase'],
    ScoreUpdated: ['actorId', 'score', 'reason'],
    MatchStarted: ['startedAt', 'rulesVersion'],
    MatchFinished: ['resultId', 'finishReason']
});

const ACTOR_EVENT_TYPES = Object.freeze([
    'PlayerMoved',
    'ShotFired',
    'DamageApplied',
    'PlayerKilled',
    'PlayerDied',
    'OrbDropped',
    'OrbCollected',
    'LootCollected',
    'PlayerRespawned',
    'ScoreUpdated'
]);

const FORBIDDEN_KEY_PARTS = Object.freeze([
    'wallet',
    'balance',
    'payment',
    'withdraw',
    'prize',
    'payout',
    'fee',
    'money',
    'socket',
    'expressrequest',
    'adminsession'
]);

function failure(code, path) {
    return { ok: false, error: { code, path } };
}

function success(value) {
    return { ok: true, value };
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value, maxLength = 128) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function hasExactKeys(value, required, optional = []) {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowed.has(key));
}

function containsForbiddenKeys(value, path = '$') {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const found = containsForbiddenKeys(value[i], `${path}[${i}]`);
            if (found) return found;
        }
        return null;
    }
    if (!isRecord(value)) return null;
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (FORBIDDEN_KEY_PARTS.some((part) => normalizedKey.includes(part))) {
            return `${path}.${key}`;
        }
        const found = containsForbiddenKeys(child, `${path}.${key}`);
        if (found) return found;
    }
    return null;
}

function baseValidation(value, errorCode) {
    if (!isRecord(value)) return failure(errorCode, '$');
    if (!Number.isInteger(value.schemaVersion) || value.schemaVersion !== SCHEMA_VERSION) {
        return failure(CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION, '$.schemaVersion');
    }
    const forbiddenPath = containsForbiddenKeys(value);
    if (forbiddenPath) return failure(errorCode, forbiddenPath);
    return null;
}

function validVector(value, allowNegative = true) {
    return isRecord(value) &&
        Object.keys(value).length === 2 &&
        finite(value.x) &&
        finite(value.y) &&
        (allowNegative || (value.x >= 0 && value.y >= 0));
}

function validCommandPayload(type, payload) {
    const keys = COMMAND_PAYLOAD_KEYS[type];
    if (!keys || !hasExactKeys(payload, keys)) return false;
    switch (type) {
        case 'MovePlayer':
            return validVector(payload.direction) &&
                Math.abs(payload.direction.x) <= 1 &&
                Math.abs(payload.direction.y) <= 1;
        case 'Shoot':
        case 'ThrowBomb':
            return finite(payload.angle) && Math.abs(payload.angle) <= Math.PI * 2;
        case 'SwitchWeapon':
            return Number.isInteger(payload.weapon) && payload.weapon >= 1 && payload.weapon <= 3;
        case 'PickupLoot':
            return nonEmptyString(payload.lootId);
        default:
            return true;
    }
}

function validateGameCommand(value) {
    const initial = baseValidation(value, CONTRACT_ERRORS.INVALID_COMMAND);
    if (initial) return initial;
    const required = [
        'schemaVersion', 'commandId', 'sessionId', 'matchId', 'actorId',
        'sequence', 'type', 'payload'
    ];
    if (!hasExactKeys(value, required, ['clientTimestamp'])) {
        return failure(CONTRACT_ERRORS.INVALID_COMMAND, '$');
    }
    for (const key of ['commandId', 'sessionId', 'matchId', 'actorId']) {
        if (!nonEmptyString(value[key])) return failure(CONTRACT_ERRORS.INVALID_COMMAND, `$.${key}`);
    }
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
        return failure(CONTRACT_ERRORS.INVALID_SEQUENCE, '$.sequence');
    }
    if (value.clientTimestamp !== undefined &&
        (!finite(value.clientTimestamp) || value.clientTimestamp < 0)) {
        return failure(CONTRACT_ERRORS.INVALID_COMMAND, '$.clientTimestamp');
    }
    if (!GAME_COMMAND_TYPES.includes(value.type)) {
        return failure(CONTRACT_ERRORS.INVALID_COMMAND, '$.type');
    }
    if (!validCommandPayload(value.type, value.payload)) {
        return failure(CONTRACT_ERRORS.INVALID_PAYLOAD, '$.payload');
    }
    return success(value);
}

function validEventPayload(type, payload) {
    const keys = EVENT_PAYLOAD_KEYS[type];
    if (!keys || !hasExactKeys(payload, keys)) return false;
    switch (type) {
        case 'PlayerMoved':
            return nonEmptyString(payload.actorId) && validVector(payload.position, false) &&
                validVector(payload.velocity);
        case 'ShotFired':
            return nonEmptyString(payload.actorId) && nonEmptyString(payload.weapon, 64) &&
                nonEmptyString(payload.projectileId);
        case 'DamageApplied':
            return nonEmptyString(payload.targetId) && finite(payload.amount) &&
                payload.amount >= 0 && finite(payload.absorbed) && payload.absorbed >= 0 &&
                finite(payload.health) && payload.health >= 0 &&
                nonEmptyString(payload.cause, 64);
        case 'PlayerKilled':
            return nonEmptyString(payload.actorId) &&
                (payload.killerId === null || nonEmptyString(payload.killerId));
        case 'PlayerDied':
            return nonEmptyString(payload.actorId) && nonEmptyString(payload.cause, 64);
        case 'OrbDropped':
            return nonEmptyString(payload.orbId) && validVector(payload.position, false) &&
                finite(payload.amount) && payload.amount > 0;
        case 'OrbCollected':
            return nonEmptyString(payload.actorId) && nonEmptyString(payload.orbId) &&
                finite(payload.amount) && payload.amount > 0;
        case 'LootSpawned':
            return nonEmptyString(payload.lootId) && nonEmptyString(payload.lootType, 64) &&
                validVector(payload.position, false);
        case 'LootCollected':
            return nonEmptyString(payload.actorId) && nonEmptyString(payload.lootId) &&
                nonEmptyString(payload.lootType, 64);
        case 'PlayerRespawned':
            return nonEmptyString(payload.actorId) && validVector(payload.position, false);
        case 'ZoneUpdated':
            return validVector(payload.center, false) && finite(payload.radius) &&
                payload.radius > 0 && Number.isInteger(payload.phase) && payload.phase >= 0;
        case 'ScoreUpdated':
            return nonEmptyString(payload.actorId) && finite(payload.score) &&
                payload.score >= 0 && nonEmptyString(payload.reason, 64);
        case 'MatchStarted':
            return finite(payload.startedAt) && payload.startedAt >= 0 &&
                nonEmptyString(payload.rulesVersion);
        case 'MatchFinished':
            return nonEmptyString(payload.resultId) &&
                MATCH_FINISH_REASONS.includes(payload.finishReason);
        default:
            return false;
    }
}

function validateGameEvent(value) {
    const initial = baseValidation(value, CONTRACT_ERRORS.INVALID_EVENT);
    if (initial) return initial;
    const required = [
        'schemaVersion', 'eventId', 'matchId', 'sequence', 'timestamp', 'type', 'payload'
    ];
    if (!hasExactKeys(value, required, ['actorId'])) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$');
    }
    if (!nonEmptyString(value.eventId)) return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.eventId');
    if (!nonEmptyString(value.matchId)) return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.matchId');
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
        return failure(CONTRACT_ERRORS.INVALID_SEQUENCE, '$.sequence');
    }
    if (!finite(value.timestamp) || value.timestamp < 0) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.timestamp');
    }
    if (value.actorId !== undefined && !nonEmptyString(value.actorId)) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.actorId');
    }
    if (!GAME_EVENT_TYPES.includes(value.type)) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.type');
    }
    if (!validEventPayload(value.type, value.payload)) {
        return failure(CONTRACT_ERRORS.INVALID_PAYLOAD, '$.payload');
    }
    return success(value);
}

function validateNewGameEvent(value) {
    const validation = validateGameEvent(value);
    if (!validation.ok) return validation;
    if (ACTOR_EVENT_TYPES.includes(value.type) && !nonEmptyString(value.actorId)) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.actorId');
    }
    if (['PlayerMoved', 'ShotFired', 'PlayerDied', 'OrbCollected', 'LootCollected',
        'PlayerRespawned', 'ScoreUpdated'].includes(value.type) &&
        value.actorId !== value.payload.actorId) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.actorId');
    }
    if (value.type === 'PlayerKilled' &&
        value.actorId !== (value.payload.killerId || value.payload.actorId)) {
        return failure(CONTRACT_ERRORS.INVALID_EVENT, '$.actorId');
    }
    return validation;
}

function validIdMap(value, validateEntry) {
    if (!isRecord(value)) return false;
    return Object.entries(value).every(([id, entry]) => nonEmptyString(id) && validateEntry(entry, id));
}

function validPlayer(player, id) {
    if (!hasExactKeys(player, [
        'actorId', 'teamId', 'position', 'velocity', 'health', 'shield', 'energy',
        'movement', 'weapons', 'ammunition', 'cooldowns', 'reload', 'inventory',
        'score', 'kills', 'deaths', 'respawn', 'alive'
    ])) return false;
    if (player.actorId !== id || !nonEmptyString(player.actorId)) return false;
    if (player.teamId !== null && !nonEmptyString(player.teamId)) return false;
    if (!validVector(player.position, false) || !validVector(player.velocity)) return false;
    if (!hasExactKeys(player.movement, ['direction', 'dashTicks']) ||
        !validVector(player.movement.direction) ||
        Math.abs(player.movement.direction.x) > 1 ||
        Math.abs(player.movement.direction.y) > 1 ||
        !Number.isSafeInteger(player.movement.dashTicks) || player.movement.dashTicks < 0) return false;
    if (!hasExactKeys(player.health, ['current', 'max']) ||
        !finite(player.health.current) || !finite(player.health.max) ||
        player.health.current < 0 || player.health.max <= 0 ||
        player.health.current > player.health.max) return false;
    if (!finite(player.shield) || player.shield < 0 ||
        !finite(player.energy) || player.energy < 0) return false;
    if (!hasExactKeys(player.weapons, ['equipped', 'owned']) ||
        !nonEmptyString(player.weapons.equipped, 64) ||
        !Array.isArray(player.weapons.owned) ||
        !player.weapons.owned.every((weapon) => nonEmptyString(weapon, 64))) return false;
    if (!validNumberMap(player.ammunition, true) || !validNumberMap(player.cooldowns, true)) return false;
    if (!hasExactKeys(player.reload, ['ticksRemaining', 'weapon']) ||
        !Number.isSafeInteger(player.reload.ticksRemaining) || player.reload.ticksRemaining < 0 ||
        (player.reload.weapon !== null && !nonEmptyString(player.reload.weapon, 64)) ||
        (player.reload.ticksRemaining === 0 && player.reload.weapon !== null)) return false;
    if (!validNumberMap(player.inventory, true)) return false;
    if (!finite(player.score) || player.score < 0 ||
        !Number.isSafeInteger(player.kills) || player.kills < 0 ||
        !Number.isSafeInteger(player.deaths) || player.deaths < 0 ||
        typeof player.alive !== 'boolean') return false;
    const validRespawn = hasExactKeys(player.respawn, ['eligible', 'availableAt']) &&
        typeof player.respawn.eligible === 'boolean' &&
        (player.respawn.availableAt === null ||
            (finite(player.respawn.availableAt) && player.respawn.availableAt >= 0));
    if (!validRespawn) return false;
    if (player.alive) {
        return player.health.current > 0 && !player.respawn.eligible &&
            player.respawn.availableAt === null;
    }
    return player.health.current === 0 && player.respawn.eligible &&
        player.respawn.availableAt !== null;
}

function validNumberMap(value, allowZero) {
    return isRecord(value) && Object.entries(value).every(([key, number]) =>
        nonEmptyString(key) && finite(number) && (allowZero ? number >= 0 : number > 0));
}

function validEntity(entity, required, extraValidation) {
    return hasExactKeys(entity, required) && extraValidation(entity);
}

function validateGameState(value) {
    const initial = baseValidation(value, CONTRACT_ERRORS.INVALID_STATE);
    if (initial) return initial;
    if (!hasExactKeys(value, [
        'schemaVersion', 'match', 'players', 'teams', 'projectiles', 'loot', 'orbs',
        'zone', 'bankZone', 'timers', 'sequence'
    ])) return failure(CONTRACT_ERRORS.INVALID_STATE, '$');

    const match = value.match;
    if (!hasExactKeys(match, ['matchId', 'status', 'rulesVersion', 'startedAt']) ||
        !nonEmptyString(match.matchId) || !MATCH_LIFECYCLE.includes(match.status) ||
        !nonEmptyString(match.rulesVersion) ||
        (match.startedAt !== null && (!finite(match.startedAt) || match.startedAt < 0))) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.match');
    }
    if (!validIdMap(value.players, validPlayer)) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.players');
    }
    if (!validIdMap(value.teams, (team, id) =>
        hasExactKeys(team, ['teamId', 'memberActorIds']) &&
        team.teamId === id && Array.isArray(team.memberActorIds) &&
        new Set(team.memberActorIds).size === team.memberActorIds.length &&
        team.memberActorIds.every(nonEmptyString) &&
        team.memberActorIds.every((actorId) => Object.hasOwn(value.players, actorId) &&
            value.players[actorId].teamId === id))) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.teams');
    }
    for (const player of Object.values(value.players)) {
        if (player.teamId !== null && (!Object.hasOwn(value.teams, player.teamId) ||
            !value.teams[player.teamId].memberActorIds.includes(player.actorId))) {
            return failure(CONTRACT_ERRORS.INVALID_STATE, '$.players');
        }
    }
    if (!Array.isArray(value.projectiles) || !value.projectiles.every((item) =>
        validEntity(item, [
            'projectileId', 'ownerId', 'kind', 'position', 'velocity', 'remainingTicks',
            'damage', 'blastRadius', 'friction'
        ], (p) => nonEmptyString(p.projectileId) && Object.hasOwn(value.players, p.ownerId) &&
                ['bullet', 'orb', 'bomb'].includes(p.kind) &&
                validVector(p.position, false) && validVector(p.velocity) &&
                Number.isSafeInteger(p.remainingTicks) && p.remainingTicks >= 0 &&
                finite(p.damage) && p.damage >= 0 &&
                finite(p.blastRadius) && p.blastRadius >= 0 &&
                finite(p.friction) && p.friction >= 0 && p.friction <= 1)) ||
        new Set(value.projectiles.map((item) => item?.projectileId)).size !== value.projectiles.length) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.projectiles');
    }
    if (!Array.isArray(value.loot) || !value.loot.every((item) =>
        validEntity(item, ['lootId', 'lootType', 'position', 'quantity'],
            (loot) => nonEmptyString(loot.lootId) && nonEmptyString(loot.lootType, 64) &&
                validVector(loot.position, false) && finite(loot.quantity) && loot.quantity > 0)) ||
        new Set(value.loot.map((item) => item?.lootId)).size !== value.loot.length) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.loot');
    }
    if (!Array.isArray(value.orbs) || !value.orbs.every((item) =>
        validEntity(item, ['orbId', 'position', 'amount'],
            (orb) => nonEmptyString(orb.orbId) && validVector(orb.position, false) &&
                finite(orb.amount) && orb.amount > 0)) ||
        new Set(value.orbs.map((item) => item?.orbId)).size !== value.orbs.length) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.orbs');
    }
    if (!hasExactKeys(value.zone, ['center', 'radius', 'phase']) ||
        !validVector(value.zone.center, false) || !finite(value.zone.radius) ||
        value.zone.radius <= 0 || !Number.isSafeInteger(value.zone.phase) || value.zone.phase < 0) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.zone');
    }
    if (!hasExactKeys(value.bankZone, ['center', 'radius']) ||
        !validVector(value.bankZone.center, false) ||
        !finite(value.bankZone.radius) || value.bankZone.radius <= 0) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.bankZone');
    }
    if (!hasExactKeys(value.timers, ['elapsedMs', 'remainingMs']) ||
        !finite(value.timers.elapsedMs) || value.timers.elapsedMs < 0 ||
        (value.timers.remainingMs !== null &&
            (!finite(value.timers.remainingMs) || value.timers.remainingMs < 0))) {
        return failure(CONTRACT_ERRORS.INVALID_STATE, '$.timers');
    }
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
        return failure(CONTRACT_ERRORS.INVALID_SEQUENCE, '$.sequence');
    }
    return success(value);
}

function validParticipant(participant) {
    return hasExactKeys(participant, ['actorId', 'teamId', 'status', 'statistics']) &&
        nonEmptyString(participant.actorId) &&
        (participant.teamId === null || nonEmptyString(participant.teamId)) &&
        ['COMPLETED', 'ELIMINATED', 'ABANDONED', 'DISCONNECTED'].includes(participant.status) &&
        isRecord(participant.statistics) &&
        Object.entries(participant.statistics).every(([key, number]) =>
            nonEmptyString(key) && finite(number) && number >= 0);
}

function validateMatchResult(value) {
    const initial = baseValidation(value, CONTRACT_ERRORS.INVALID_RESULT);
    if (initial) return initial;
    const required = [
        'schemaVersion', 'resultId', 'matchId', 'rulesVersion', 'startedAt', 'finishedAt',
        'finishReason', 'participants', 'rankings', 'teams', 'statistics', 'resultHash'
    ];
    if (!hasExactKeys(value, required, ['policyReference'])) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$');
    }
    for (const key of ['resultId', 'matchId', 'rulesVersion']) {
        if (!nonEmptyString(value[key])) return failure(CONTRACT_ERRORS.INVALID_RESULT, `$.${key}`);
    }
    if (!finite(value.startedAt) || value.startedAt < 0 ||
        !finite(value.finishedAt) || value.finishedAt < value.startedAt) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.finishedAt');
    }
    if (!MATCH_FINISH_REASONS.includes(value.finishReason)) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.finishReason');
    }
    if (!Array.isArray(value.participants) || value.participants.length < 1 ||
        !value.participants.every(validParticipant)) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.participants');
    }
    const participantIds = new Set(value.participants.map((participant) => participant.actorId));
    if (participantIds.size !== value.participants.length) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.participants');
    }
    if (!Array.isArray(value.rankings) || value.rankings.length < 1 ||
        !value.rankings.every((ranking) =>
            hasExactKeys(ranking, ['rank', 'actorIds', 'teamId']) &&
            Number.isSafeInteger(ranking.rank) && ranking.rank >= 1 &&
            Array.isArray(ranking.actorIds) && ranking.actorIds.length > 0 &&
            ranking.actorIds.every((actorId) => participantIds.has(actorId)) &&
            (ranking.teamId === null || nonEmptyString(ranking.teamId)))) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.rankings');
    }
    if (!Array.isArray(value.teams) || !value.teams.every((team) =>
        hasExactKeys(team, ['teamId', 'memberActorIds']) &&
        nonEmptyString(team.teamId) && Array.isArray(team.memberActorIds) &&
        team.memberActorIds.length > 0 &&
        new Set(team.memberActorIds).size === team.memberActorIds.length &&
        team.memberActorIds.every((actorId) => participantIds.has(actorId) &&
            value.participants.find((participant) => participant.actorId === actorId).teamId === team.teamId)) ||
        new Set(value.teams.map((team) => team?.teamId)).size !== value.teams.length) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.teams');
    }
    if (value.participants.some((participant) => participant.teamId !== null &&
        !value.teams.some((team) => team.teamId === participant.teamId &&
            team.memberActorIds.includes(participant.actorId)))) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.participants');
    }
    const rankedActorIds = value.rankings.flatMap((ranking) => ranking.actorIds);
    if (new Set(rankedActorIds).size !== participantIds.size ||
        rankedActorIds.some((actorId) => !participantIds.has(actorId)) ||
        value.rankings.some((ranking) => ranking.teamId !== null &&
            !value.teams.some((team) => team.teamId === ranking.teamId))) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.rankings');
    }
    if (!isRecord(value.statistics) ||
        !Object.entries(value.statistics).every(([key, number]) =>
            nonEmptyString(key) && finite(number) && number >= 0)) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.statistics');
    }
    if (value.policyReference !== undefined && !nonEmptyString(value.policyReference)) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.policyReference');
    }
    if (typeof value.resultHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.resultHash)) {
        return failure(CONTRACT_ERRORS.INVALID_RESULT, '$.resultHash');
    }
    return success(value);
}

function validateAuthenticatedPrincipal(value) {
    const initial = baseValidation(value, CONTRACT_ERRORS.INVALID_PRINCIPAL);
    if (initial) return initial;
    if (!hasExactKeys(value, [
        'schemaVersion', 'userId', 'provider', 'sessionId', 'authenticatedAt',
        'expiresAt', 'roles', 'permissions'
    ])) return failure(CONTRACT_ERRORS.INVALID_PRINCIPAL, '$');
    for (const key of ['userId', 'provider', 'sessionId']) {
        if (!nonEmptyString(value[key])) {
            return failure(CONTRACT_ERRORS.INVALID_PRINCIPAL, `$.${key}`);
        }
    }
    if (!finite(value.authenticatedAt) || value.authenticatedAt < 0 ||
        !finite(value.expiresAt) || value.expiresAt <= value.authenticatedAt) {
        return failure(CONTRACT_ERRORS.INVALID_PRINCIPAL, '$.expiresAt');
    }
    for (const key of ['roles', 'permissions']) {
        if (!Array.isArray(value[key]) || !value[key].every((entry) => nonEmptyString(entry, 128)) ||
            new Set(value[key]).size !== value[key].length) {
            return failure(CONTRACT_ERRORS.INVALID_PRINCIPAL, `$.${key}`);
        }
    }
    return success(value);
}

module.exports = Object.freeze({
    validateGameCommand,
    validateGameEvent,
    validateNewGameEvent,
    validateGameState,
    validateMatchResult,
    validateAuthenticatedPrincipal
});
