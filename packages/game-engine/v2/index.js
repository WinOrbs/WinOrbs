'use strict';

const crypto = require('crypto');
const {
    SCHEMA_VERSION,
    MATCH_LIFECYCLE,
    MATCH_FINISH_REASONS
} = require('../../contracts/v2');
const {
    validateGameCommand,
    validateNewGameEvent,
    validateGameState,
    validateMatchResult
} = require('../../contracts/v2/validation');

const ENGINE_ERRORS = Object.freeze({
    INVALID_COMMAND: 'INVALID_COMMAND',
    INVALID_PAYLOAD: 'INVALID_PAYLOAD',
    UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
    INVALID_STATE: 'INVALID_STATE',
    INVALID_RULES: 'INVALID_RULES',
    INVALID_SEQUENCE: 'INVALID_SEQUENCE',
    COMMAND_ID_REUSE: 'COMMAND_ID_REUSE',
    COMMAND_REJECTED: 'COMMAND_REJECTED',
    MATCH_NOT_RUNNING: 'MATCH_NOT_RUNNING',
    PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
    PLAYER_ALREADY_EXISTS: 'PLAYER_ALREADY_EXISTS',
    PLAYER_DEAD: 'PLAYER_DEAD',
    PLAYER_ALIVE: 'PLAYER_ALIVE',
    WEAPON_COOLDOWN: 'WEAPON_COOLDOWN',
    INSUFFICIENT_AMMO: 'INSUFFICIENT_AMMO',
    OUT_OF_RANGE: 'OUT_OF_RANGE',
    INVALID_TARGET: 'INVALID_TARGET',
    INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
    RESPAWN_NOT_READY: 'RESPAWN_NOT_READY'
});

const DEFAULT_RULES = Object.freeze({
    mapSize: 5000,
    initialZoneRadius: 4000,
    bankZoneRadius: 130,
    matchDurationMs: 60000,
    playerRadius: 22,
    movementSpeed: 5.5,
    tickMs: 1000 / 60,
    maxHealth: 100,
    pickupRange: 10,
    deathOrbDropRate: 0.2,
    eliminationScore: 5,
    respawnDelayTicks: 300,
    dashRechargeTicks: 200,
    spawnPoints: Object.freeze([Object.freeze({ x: 2500, y: 2500 })]),
    weapons: Object.freeze({
        pistol: Object.freeze({
            kind: 'bullet', damage: 20, speed: 18, lifetimeTicks: 55,
            magazineSize: 15, cooldownMs: 120, reloadTicks: 150, blastRadius: 0
        }),
        orbGun: Object.freeze({
            kind: 'orb', damage: 15, speed: 14, lifetimeTicks: 45,
            magazineSize: 3, cooldownMs: 400, reloadTicks: 150,
            reloadEnergyCost: 25, blastRadius: 0
        }),
        plasmaBomb: Object.freeze({
            kind: 'bomb', damage: 30, speed: 12, lifetimeTicks: 90,
            cooldownMs: 400, friction: 0.95, blastRadius: 150
        })
    }),
    zone: Object.freeze({
        closeSpeed: 200,
        centerSpeed: 200,
        damagePerSecond: Object.freeze([4, 8, 12, 16, 20]),
        phases: Object.freeze([
            Object.freeze({ remainingMs: 40000, radius: 3536 }),
            Object.freeze({ remainingMs: 30000, radius: 2600 }),
            Object.freeze({ remainingMs: 20000, radius: 1800 }),
            Object.freeze({ remainingMs: 10000, radius: 1000 }),
            Object.freeze({ remainingMs: 0, radius: 280 })
        ])
    })
});

const LIFECYCLE_TRANSITIONS = Object.freeze({
    WAITING: ['READY'],
    READY: ['COUNTDOWN', 'WAITING'],
    COUNTDOWN: ['RUNNING', 'WAITING'],
    RUNNING: ['FINISHING'],
    FINISHING: ['RESULT_LOCKED'],
    RESULT_LOCKED: [],
    SETTLING: [],
    SETTLED: []
});

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function resultError(code, details = {}) {
    return { ok: false, error: { code, ...details } };
}

function mergeRules(input) {
    if (input === undefined) input = {};
    if (!isRecord(input)) return null;
    const rules = {
        ...DEFAULT_RULES,
        ...input,
        spawnPoints: clone(input.spawnPoints || DEFAULT_RULES.spawnPoints),
        weapons: Object.fromEntries(Object.entries(DEFAULT_RULES.weapons).map(([id, defaults]) => [
            id,
            { ...defaults, ...(input.weapons?.[id] || {}) }
        ])),
        zone: {
            ...DEFAULT_RULES.zone,
            ...(input.zone || {}),
            damagePerSecond: clone(input.zone?.damagePerSecond || DEFAULT_RULES.zone.damagePerSecond),
            phases: clone(input.zone?.phases || DEFAULT_RULES.zone.phases)
        }
    };
    if (!Number.isFinite(rules.mapSize) || rules.mapSize <= 0 ||
    !Number.isFinite(rules.initialZoneRadius) || rules.initialZoneRadius <= 0 ||
    !Number.isFinite(rules.bankZoneRadius) || rules.bankZoneRadius <= 0 ||
    (rules.matchDurationMs !== null &&
        (!Number.isFinite(rules.matchDurationMs) || rules.matchDurationMs < 0)) ||
        !Number.isFinite(rules.playerRadius) || rules.playerRadius < 0 ||
        !Number.isFinite(rules.movementSpeed) || rules.movementSpeed < 0 ||
        !Number.isFinite(rules.tickMs) || rules.tickMs <= 0 ||
        !Number.isFinite(rules.maxHealth) || rules.maxHealth <= 0 ||
        !Number.isFinite(rules.pickupRange) || rules.pickupRange < 0 ||
        !Number.isFinite(rules.deathOrbDropRate) ||
        rules.deathOrbDropRate < 0 || rules.deathOrbDropRate > 1 ||
        !Number.isFinite(rules.eliminationScore) || rules.eliminationScore < 0 ||
        !Number.isSafeInteger(rules.respawnDelayTicks) || rules.respawnDelayTicks < 0 ||
        !Number.isSafeInteger(rules.dashRechargeTicks) || rules.dashRechargeTicks < 1 ||
        !Array.isArray(rules.spawnPoints) || rules.spawnPoints.length === 0 ||
        !rules.spawnPoints.every((point) => isRecord(point) &&
            Number.isFinite(point.x) && Number.isFinite(point.y) &&
            point.x >= 0 && point.y >= 0 &&
            point.x <= rules.mapSize && point.y <= rules.mapSize) ||
        !Array.isArray(rules.zone.damagePerSecond) ||
        !Number.isFinite(rules.zone.closeSpeed) || rules.zone.closeSpeed < 0 ||
        !Number.isFinite(rules.zone.centerSpeed) || rules.zone.centerSpeed < 0 ||
        !rules.zone.damagePerSecond.length ||
        !rules.zone.damagePerSecond.every((value) => Number.isFinite(value) && value >= 0) ||
        !Array.isArray(rules.zone.phases) || !rules.zone.phases.length ||
        !rules.zone.phases.every((phase) => isRecord(phase) &&
            Number.isFinite(phase.remainingMs) && phase.remainingMs >= 0 &&
            Number.isFinite(phase.radius) && phase.radius > 0 &&
            (phase.center === undefined || (Number.isFinite(phase.center.x) &&
                Number.isFinite(phase.center.y) && phase.center.x >= 0 &&
                phase.center.y >= 0 && phase.center.x <= rules.mapSize &&
                phase.center.y <= rules.mapSize)))) {
        return null;
    }
    for (const weapon of Object.values(rules.weapons)) {
        if (!isRecord(weapon) || !['bullet', 'orb', 'bomb'].includes(weapon.kind) ||
            !Number.isFinite(weapon.damage) || weapon.damage < 0 ||
            !Number.isFinite(weapon.speed) || weapon.speed < 0 ||
            !Number.isSafeInteger(weapon.lifetimeTicks) || weapon.lifetimeTicks < 1 ||
            !Number.isFinite(weapon.cooldownMs) || weapon.cooldownMs < 0 ||
            !Number.isFinite(weapon.blastRadius) || weapon.blastRadius < 0 ||
            (weapon.magazineSize !== undefined &&
                (!Number.isSafeInteger(weapon.magazineSize) || weapon.magazineSize < 1)) ||
            (weapon.reloadTicks !== undefined &&
                (!Number.isSafeInteger(weapon.reloadTicks) || weapon.reloadTicks < 1)) ||
            (weapon.friction !== undefined &&
                (!Number.isFinite(weapon.friction) || weapon.friction < 0 || weapon.friction > 1)) ||
            (weapon.reloadEnergyCost !== undefined &&
                (!Number.isFinite(weapon.reloadEnergyCost) || weapon.reloadEnergyCost < 0))) {
            return null;
        }
    }
    return deepFreeze(rules);
}

function makeEngineError(code, details = {}) {
    return resultError(code, details);
}

function createInitialGameState({
    matchId,
    rulesVersion = 'v2',
    rules: inputRules = {},
    durationMs,
    zone,
    bankZone
} = {}) {
    if (typeof matchId !== 'string' || !matchId.trim() || matchId.length > 128 ||
        typeof rulesVersion !== 'string' || !rulesVersion.trim() || rulesVersion.length > 128) {
        throw new TypeError('matchId and rulesVersion must be non-empty strings');
    }
    const rules = mergeRules(inputRules);
    if (!rules) throw new TypeError('Invalid game rules');
    const center = { x: rules.mapSize / 2, y: rules.mapSize / 2 };
    const initialState = {
        schemaVersion: SCHEMA_VERSION,
        match: { matchId, status: 'WAITING', rulesVersion, startedAt: null },
        players: {},
        teams: {},
        projectiles: [],
        loot: [],
        orbs: [],
        zone: zone || {
            center,
            radius: Math.min(rules.mapSize, rules.initialZoneRadius),
            phase: 0
        },
        bankZone: bankZone || {
            center,
            radius: Math.min(rules.mapSize / 2, rules.bankZoneRadius)
        },
        timers: {
            elapsedMs: 0,
            remainingMs: durationMs === undefined ? rules.matchDurationMs : durationMs
        },
        sequence: 0
    };
    const validation = validateGameState(initialState);
    if (!validation.ok) {
        throw new TypeError(`Invalid initial GameState: ${validation.error.code} at ${validation.error.path}`);
    }
    return deepFreeze(clone(initialState));
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function normalizeVector(vector) {
    const length = vectorLength(vector);
    if (!length) return { x: 0, y: 0 };
    return { x: vector.x / length, y: vector.y / length };
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function validNow(clock) {
    const value = clock();
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function createGameEngine(initialState, inputRules = {}, dependencies = {}) {
    const initialValidation = validateGameState(initialState);
    if (!initialValidation.ok) {
        throw new TypeError(`Invalid initial GameState: ${initialValidation.error.code} at ${initialValidation.error.path}`);
    }
    const rules = mergeRules(inputRules);
    if (!rules) throw new TypeError('Invalid game rules');
    if (!isRecord(dependencies)) throw new TypeError('dependencies must be an object');
    const clock = dependencies.clock || (() => 0);
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');

    let state = clone(initialState);
    const lastSequenceBySession = new Map();
    const actorBySession = new Map();
    const commandResults = new Map();
    const maxCachedCommands = Number.isSafeInteger(dependencies.maxCachedCommands) &&
        dependencies.maxCachedCommands > 0 ? dependencies.maxCachedCommands : 10000;

    function snapshot(value = state) {
        return deepFreeze(clone(value));
    }

    function event(draft, type, payload, actorId) {
        const candidate = {
            schemaVersion: SCHEMA_VERSION,
            eventId: `${draft.match.matchId}:event:${draft.sequence + 1}`,
            matchId: draft.match.matchId,
            sequence: draft.sequence + 1,
            timestamp: validNow(clock),
            type,
            ...(actorId ? { actorId } : {}),
            payload
        };
        if (candidate.timestamp === null) {
            throw new TypeError('clock must return a finite non-negative timestamp');
        }
        const validation = validateNewGameEvent(candidate);
        if (!validation.ok) {
            throw new TypeError(`Engine produced invalid ${type} event at ${validation.error.path}`);
        }
        draft.sequence = candidate.sequence;
        return candidate;
    }

    function emitScore(draft, player, reason, events) {
        events.push(event(draft, 'ScoreUpdated', {
            actorId: player.actorId,
            score: player.score,
            reason
        }, player.actorId));
    }

    function dropOrbs(draft, player, amount, events) {
        if (!(amount > 0)) return;
        const orbId = `${draft.match.matchId}:orb:${draft.sequence + 1}`;
        const orb = {
            orbId,
            position: { ...player.position },
            amount
        };
        draft.orbs.push(orb);
        events.push(event(draft, 'OrbDropped', orb, player.actorId));
    }

    function killPlayer(draft, victim, killerId, cause, events) {
        if (!victim.alive) return;
        victim.health.current = 0;
        victim.alive = false;
        victim.movement.direction = { x: 0, y: 0 };
        victim.movement.dashTicks = 0;
        victim.velocity = { x: 0, y: 0 };
        victim.reload = { ticksRemaining: 0, weapon: null };
        victim.deaths++;
        victim.respawn = {
            eligible: true,
            availableAt: validNow(clock) + rules.respawnDelayTicks * rules.tickMs
        };
        const dropped = victim.energy * rules.deathOrbDropRate;
        victim.energy -= dropped;
        dropOrbs(draft, victim, dropped, events);
        events.push(event(draft, 'PlayerDied', { actorId: victim.actorId, cause }, victim.actorId));
        events.push(event(draft, 'PlayerKilled', {
            actorId: victim.actorId,
            killerId: killerId || null
        }, killerId || victim.actorId));
        if (killerId && killerId !== victim.actorId) {
            const killer = Object.hasOwn(draft.players, killerId)
                ? draft.players[killerId]
                : null;
            if (killer) {
                killer.kills++;
                killer.score += rules.eliminationScore;
                emitScore(draft, killer, 'ELIMINATION', events);
            }
        }
    }

    function applyDamage(draft, target, amount, attackerId, cause, events) {
        const applied = Math.max(0, amount);
        const absorbed = Math.min(target.shield, applied);
        target.shield -= absorbed;
        const hpDamage = Math.min(target.health.current, applied - absorbed);
        target.health.current -= hpDamage;
        events.push(event(draft, 'DamageApplied', {
            targetId: target.actorId,
            amount: hpDamage,
            absorbed,
            health: target.health.current,
            cause
        }, attackerId || target.actorId));
        if (target.health.current <= 0) {
            killPlayer(draft, target, attackerId, cause, events);
        }
    }

    function spawnProjectile(draft, player, weaponName, angle, events) {
        const weapon = rules.weapons[weaponName];
        const now = validNow(clock);
        if (now === null) return makeEngineError(ENGINE_ERRORS.INVALID_RULES);
        const cooldownKey = `weapon:${weaponName}`;
        if (Object.hasOwn(player.cooldowns, cooldownKey) &&
            now < player.cooldowns[cooldownKey]) {
            return makeEngineError(ENGINE_ERRORS.WEAPON_COOLDOWN);
        }
        const ammoKey = weaponName === 'orbGun' ? 'orbGun' :
            weaponName === 'plasmaBomb' ? 'bomb' : 'pistol';
        const count = Number(player.ammunition[ammoKey] || player.inventory[ammoKey] || 0);
        if (weaponName === 'plasmaBomb') {
            const bombs = Number(player.inventory.bombs || player.ammunition.bombs || 0);
            if (bombs <= 0) return makeEngineError(ENGINE_ERRORS.INSUFFICIENT_AMMO);
            player.inventory.bombs = bombs - 1;
        } else {
            if (count <= 0) return makeEngineError(ENGINE_ERRORS.INSUFFICIENT_AMMO);
            player.ammunition[ammoKey] = count - 1;
        }
        player.cooldowns[cooldownKey] = now + weapon.cooldownMs;
        const projectileId = `${draft.match.matchId}:projectile:${draft.sequence + 1}`;
        const radius = rules.playerRadius + 12;
        const projectile = {
            projectileId,
            ownerId: player.actorId,
            kind: weapon.kind,
            position: {
                x: Math.max(0, Math.min(rules.mapSize, player.position.x + Math.cos(angle) * radius)),
                y: Math.max(0, Math.min(rules.mapSize, player.position.y + Math.sin(angle) * radius))
            },
            velocity: { x: Math.cos(angle) * weapon.speed, y: Math.sin(angle) * weapon.speed },
            remainingTicks: weapon.lifetimeTicks,
            damage: weapon.damage,
            blastRadius: weapon.blastRadius,
            friction: weapon.friction || 1
        };
        draft.projectiles.push(projectile);
        events.push(event(draft, 'ShotFired', {
            actorId: player.actorId,
            weapon: weaponName,
            projectileId
        }, player.actorId));
        return null;
    }

    function collectLoot(draft, player, lootIndex, events) {
        const loot = draft.loot[lootIndex];
        if (loot.lootType === 'healthKit') {
            if (player.health.current >= player.health.max) return false;
            player.health.current = Math.min(player.health.max, player.health.current + loot.quantity);
        } else if (loot.lootType === 'orbGun') {
            if (player.weapons.owned.includes('orbGun')) return false;
            player.weapons.owned.push('orbGun');
            player.ammunition.orbGun = rules.weapons.orbGun.magazineSize;
            player.weapons.equipped = 'orbGun';
        } else {
            return false;
        }
        draft.loot.splice(lootIndex, 1);
        events.push(event(draft, 'LootCollected', {
            actorId: player.actorId,
            lootId: loot.lootId,
            lootType: loot.lootType
        }, player.actorId));
        return true;
    }

    function processCommand(draft, command) {
        if (!Object.hasOwn(draft.players, command.actorId)) {
            return makeEngineError(ENGINE_ERRORS.PLAYER_NOT_FOUND);
        }
        const player = draft.players[command.actorId];
        if (draft.match.status !== 'RUNNING') return makeEngineError(ENGINE_ERRORS.MATCH_NOT_RUNNING);
        if (!player.alive && command.type !== 'Respawn') return makeEngineError(ENGINE_ERRORS.PLAYER_DEAD);
        const events = [];
        let error = null;

        switch (command.type) {
            case 'MovePlayer': {
                player.movement.direction = normalizeVector(command.payload.direction);
                break;
            }
            case 'Shoot': {
                const equipped = player.weapons.equipped;
                if (equipped === 'plasmaBomb') {
                    error = spawnProjectile(draft, player, equipped, command.payload.angle, events);
                } else if (!['pistol', 'orbGun'].includes(equipped) ||
                    !player.weapons.owned.includes(equipped)) {
                    error = makeEngineError(ENGINE_ERRORS.INVALID_TARGET);
                } else {
                    error = spawnProjectile(draft, player, equipped, command.payload.angle, events);
                }
                break;
            }
            case 'ThrowBomb':
                error = spawnProjectile(draft, player, 'plasmaBomb', command.payload.angle, events);
                break;
            case 'Dash': {
                const now = validNow(clock);
                if (now === null) {
                    error = makeEngineError(ENGINE_ERRORS.INVALID_RULES);
                    break;
                }
                const readyAt = Number(player.cooldowns.dash || 0);
                if (player.movement.dashTicks > 0 || now < readyAt) {
                    error = makeEngineError(ENGINE_ERRORS.WEAPON_COOLDOWN);
                    break;
                }
                player.movement.dashTicks = 15;
                player.cooldowns.dash = now + rules.dashRechargeTicks * rules.tickMs;
                break;
            }
            case 'SwitchWeapon': {
                const weaponNames = { 1: 'pistol', 2: 'orbGun', 3: 'plasmaBomb' };
                const weapon = weaponNames[command.payload.weapon];
                if (!weapon || (weapon !== 'plasmaBomb' && !player.weapons.owned.includes(weapon))) {
                    error = makeEngineError(ENGINE_ERRORS.INVALID_TARGET);
                    break;
                }
                player.weapons.equipped = weapon;
                player.reload = { ticksRemaining: 0, weapon: null };
                break;
            }
            case 'Reload': {
                const weaponName = player.weapons.equipped;
                const weapon = rules.weapons[weaponName];
                if (!weapon || !weapon.magazineSize || !weapon.reloadTicks) {
                    error = makeEngineError(ENGINE_ERRORS.INVALID_TARGET);
                    break;
                }
                const ammoKey = weaponName === 'orbGun' ? 'orbGun' : 'pistol';
                if (Number(player.ammunition[ammoKey] || 0) >= weapon.magazineSize) break;
                if (weapon.reloadEnergyCost && player.energy < weapon.reloadEnergyCost) {
                    error = makeEngineError(ENGINE_ERRORS.INSUFFICIENT_AMMO);
                    break;
                }
                player.reload = { ticksRemaining: weapon.reloadTicks, weapon: weaponName };
                break;
            }
            case 'PickupLoot': {
                const lootIndex = draft.loot.findIndex((item) => item.lootId === command.payload.lootId);
                if (lootIndex < 0) {
                    const orbIndex = draft.orbs.findIndex((item) => item.orbId === command.payload.lootId);
                    if (orbIndex < 0) {
                        error = makeEngineError(ENGINE_ERRORS.INVALID_TARGET);
                        break;
                    }
                    const orb = draft.orbs[orbIndex];
                    if (distance(player.position, orb.position) >= rules.playerRadius + rules.pickupRange) {
                        error = makeEngineError(ENGINE_ERRORS.OUT_OF_RANGE);
                        break;
                    }
                    draft.orbs.splice(orbIndex, 1);
                    player.energy += orb.amount;
                    events.push(event(draft, 'OrbCollected', {
                        actorId: player.actorId,
                        orbId: orb.orbId,
                        amount: orb.amount
                    }, player.actorId));
                    break;
                }
                const loot = draft.loot[lootIndex];
                if (distance(player.position, loot.position) >= rules.playerRadius + rules.pickupRange) {
                    error = makeEngineError(ENGINE_ERRORS.OUT_OF_RANGE);
                    break;
                }
                if (!collectLoot(draft, player, lootIndex, events)) {
                    error = makeEngineError(ENGINE_ERRORS.INVALID_TARGET);
                }
                break;
            }
            case 'Respawn': {
                if (player.alive) {
                    error = makeEngineError(ENGINE_ERRORS.PLAYER_ALIVE);
                    break;
                }
                const now = validNow(clock);
                if (now === null || !player.respawn.eligible ||
                    player.respawn.availableAt === null || now < player.respawn.availableAt) {
                    error = makeEngineError(ENGINE_ERRORS.RESPAWN_NOT_READY);
                    break;
                }
                const spawn = rules.spawnPoints[(player.deaths - 1) % rules.spawnPoints.length];
                player.alive = true;
                player.health = { current: rules.maxHealth, max: rules.maxHealth };
                player.shield = 0;
                player.energy = 0;
                player.position = {
                    x: Math.max(rules.playerRadius, Math.min(rules.mapSize - rules.playerRadius, spawn.x)),
                    y: Math.max(rules.playerRadius, Math.min(rules.mapSize - rules.playerRadius, spawn.y))
                };
                player.velocity = { x: 0, y: 0 };
                player.movement = { direction: { x: 0, y: 0 }, dashTicks: 0 };
                player.weapons.equipped = 'pistol';
                player.ammunition.pistol = rules.weapons.pistol.magazineSize;
                player.ammunition.orbGun = rules.weapons.orbGun.magazineSize;
                player.reload = { ticksRemaining: 0, weapon: null };
                player.respawn = { eligible: false, availableAt: null };
                events.push(event(draft, 'PlayerRespawned', {
                    actorId: player.actorId,
                    position: { ...player.position }
                }, player.actorId));
                break;
            }
            default:
                error = makeEngineError(ENGINE_ERRORS.INVALID_COMMAND);
        }
        return error ? { error } : { events };
    }

    function transition(to) {
        if (!MATCH_LIFECYCLE.includes(to) ||
            !LIFECYCLE_TRANSITIONS[state.match.status]?.includes(to)) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE_TRANSITION, {
                from: state.match.status,
                to
            });
        }
        const draft = clone(state);
        draft.match.status = to;
        const events = [];
        if (to === 'RUNNING') {
            const startedAt = validNow(clock);
            if (startedAt === null) return makeEngineError(ENGINE_ERRORS.INVALID_RULES);
            draft.match.startedAt = startedAt;
            events.push(event(draft, 'MatchStarted', {
                startedAt,
                rulesVersion: draft.match.rulesVersion
            }));
        }
        const validation = validateGameState(draft);
        if (!validation.ok) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validation.error.path });
        }
        state = draft;
        return { ok: true, state: snapshot(), events: deepFreeze(events), result: null };
    }

    function addPlayer(actorId) {
        if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 128) {
            return makeEngineError(ENGINE_ERRORS.INVALID_COMMAND);
        }
        if (!['WAITING', 'READY'].includes(state.match.status)) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE_TRANSITION, {
                from: state.match.status,
                operation: 'ADD_PLAYER'
            });
        }
        if (Object.hasOwn(state.players, actorId)) {
            return makeEngineError(ENGINE_ERRORS.PLAYER_ALREADY_EXISTS);
        }
        const spawnIndex = Object.keys(state.players).length % rules.spawnPoints.length;
        const spawn = rules.spawnPoints[spawnIndex];
        const player = {
            actorId,
            teamId: null,
            position: { ...spawn },
            velocity: { x: 0, y: 0 },
            health: { current: rules.maxHealth, max: rules.maxHealth },
            shield: 0,
            energy: 0,
            movement: { direction: { x: 0, y: 0 }, dashTicks: 0 },
            weapons: { equipped: 'pistol', owned: ['pistol'] },
            ammunition: {
                pistol: rules.weapons.pistol.magazineSize,
                orbGun: rules.weapons.orbGun.magazineSize
            },
            cooldowns: {},
            reload: { ticksRemaining: 0, weapon: null },
            inventory: { bombs: 0 },
            score: 0,
            kills: 0,
            deaths: 0,
            respawn: { eligible: false, availableAt: null },
            alive: true
        };
        const draft = clone(state);
        Object.defineProperty(draft.players, actorId, {
            value: player,
            enumerable: true,
            configurable: true,
            writable: true
        });
        const validation = validateGameState(draft);
        if (!validation.ok) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validation.error.path });
        }
        state = draft;
        return { ok: true, state: snapshot(), events: deepFreeze([]), result: null };
    }

    function removePlayer(actorId) {
        if (typeof actorId !== 'string' || !Object.hasOwn(state.players, actorId)) {
            return makeEngineError(ENGINE_ERRORS.PLAYER_NOT_FOUND);
        }
        if (!['WAITING', 'READY'].includes(state.match.status)) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE_TRANSITION, {
                from: state.match.status,
                operation: 'REMOVE_PLAYER'
            });
        }
        const draft = clone(state);
        delete draft.players[actorId];
        draft.projectiles = draft.projectiles.filter((projectile) =>
            projectile.ownerId !== actorId);
        for (const [teamId, team] of Object.entries(draft.teams)) {
            team.memberActorIds = team.memberActorIds.filter((memberId) => memberId !== actorId);
            if (!team.memberActorIds.length) delete draft.teams[teamId];
        }
        const validation = validateGameState(draft);
        if (!validation.ok) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validation.error.path });
        }
        state = draft;
        return { ok: true, state: snapshot(), events: deepFreeze([]), result: null };
    }

    function buildResult(draft, finishReason) {
        const participants = Object.values(draft.players)
            .sort((a, b) => a.actorId.localeCompare(b.actorId))
            .map((player) => ({
                actorId: player.actorId,
                teamId: player.teamId,
                status: player.alive ? 'COMPLETED' : 'ELIMINATED',
                statistics: {
                    score: player.score,
                    kills: player.kills,
                    deaths: player.deaths
                }
            }));
        const ordered = [...participants].sort((a, b) =>
            b.statistics.score - a.statistics.score || a.actorId.localeCompare(b.actorId));
        const rankings = [];
        let rank = 0;
        let previousScore = null;
        ordered.forEach((participant, index) => {
            const score = participant.statistics.score;
            if (previousScore === null || score < previousScore) rank = index + 1;
            previousScore = score;
            rankings.push({
                rank,
                actorIds: [participant.actorId],
                teamId: participant.teamId
            });
        });
        const startedAt = draft.match.startedAt;
        const finishedAt = validNow(clock);
        if (startedAt === null || !Number.isFinite(startedAt) ||
            finishedAt === null || finishedAt < startedAt) {
            return null;
        }
        const result = {
            schemaVersion: SCHEMA_VERSION,
            resultId: `${draft.match.matchId}:result`,
            matchId: draft.match.matchId,
            rulesVersion: draft.match.rulesVersion,
            startedAt,
            finishedAt,
            finishReason,
            participants,
            rankings,
            teams: Object.keys(draft.teams).sort().map((teamId) => ({
                teamId,
                memberActorIds: [...draft.teams[teamId].memberActorIds].sort()
            })),
            statistics: { durationMs: draft.timers.elapsedMs },
            resultHash: ''
        };
        const canonicalResult = canonical(result);
        result.resultHash = crypto.createHash('sha256').update(canonicalResult).digest('hex');
        return validateMatchResult(result).ok ? deepFreeze(result) : null;
    }

    function finishMatch(finishReason) {
        if (state.match.status !== 'RUNNING' ||
            !MATCH_FINISH_REASONS.includes(finishReason)) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE_TRANSITION, {
                from: state.match.status,
                to: 'FINISHING'
            });
        }
        const draft = clone(state);
        draft.match.status = 'FINISHING';
        const result = buildResult(draft, finishReason);
        if (!result) return makeEngineError(ENGINE_ERRORS.INVALID_STATE);
        draft.match.status = 'RESULT_LOCKED';
        const finished = event(draft, 'MatchFinished', {
            resultId: result.resultId,
            finishReason
        });
        state = draft;
        return {
            ok: true,
            state: snapshot(),
            events: deepFreeze([finished]),
            result
        };
    }

    function updateZone(draft, events) {
        const remaining = draft.timers.remainingMs;
        if (remaining === null) return;
        const phases = rules.zone.phases;
        const descending = [...phases].sort((a, b) => b.remainingMs - a.remainingMs);
        let upper = descending[0];
        let lower = descending[descending.length - 1];
        for (let i = 0; i < descending.length - 1; i++) {
            if (remaining <= descending[i].remainingMs &&
                remaining >= descending[i + 1].remainingMs) {
                upper = descending[i];
                lower = descending[i + 1];
                break;
            }
        }
        const span = upper.remainingMs - lower.remainingMs;
        const progress = span > 0
            ? Math.max(0, Math.min(1, (upper.remainingMs - remaining) / span))
            : 1;
        const targetRadius = upper.radius + (lower.radius - upper.radius) * progress;
        const targetCenter = {
            x: (upper.center || draft.zone.center).x +
                ((lower.center || upper.center || draft.zone.center).x -
                    (upper.center || draft.zone.center).x) * progress,
            y: (upper.center || draft.zone.center).y +
                ((lower.center || upper.center || draft.zone.center).y -
                    (upper.center || draft.zone.center).y) * progress
        };
        const maxRadiusStep = rules.zone.closeSpeed * rules.tickMs / 1000;
        const radiusDelta = targetRadius - draft.zone.radius;
        const nextRadius = Math.abs(radiusDelta) <= maxRadiusStep
            ? targetRadius
            : draft.zone.radius + Math.sign(radiusDelta) * maxRadiusStep;
        const maxCenterStep = rules.zone.centerSpeed * rules.tickMs / 1000;
        const centerDelta = distance(draft.zone.center, targetCenter);
        const nextCenter = centerDelta <= maxCenterStep || centerDelta === 0
            ? targetCenter
            : {
                x: draft.zone.center.x +
                    ((targetCenter.x - draft.zone.center.x) / centerDelta) * maxCenterStep,
                y: draft.zone.center.y +
                    ((targetCenter.y - draft.zone.center.y) / centerDelta) * maxCenterStep
            };
        let phaseIndex = 0;
        for (let i = 1; i < descending.length; i++) {
            if (remaining <= descending[i].remainingMs) phaseIndex = i;
        }
        if (nextRadius !== draft.zone.radius ||
            nextCenter.x !== draft.zone.center.x || nextCenter.y !== draft.zone.center.y ||
            phaseIndex !== draft.zone.phase) {
            draft.zone.radius = nextRadius;
            draft.zone.center = nextCenter;
            draft.zone.phase = phaseIndex;
            events.push(event(draft, 'ZoneUpdated', {
                center: { ...draft.zone.center },
                radius: draft.zone.radius,
                phase: draft.zone.phase
            }));
        }
    }

    function advanceProjectiles(draft, events) {
        const survivors = [];
        for (const projectile of draft.projectiles) {
            projectile.position.x += projectile.velocity.x;
            projectile.position.y += projectile.velocity.y;
            projectile.remainingTicks--;
            if (projectile.kind === 'bomb') {
                projectile.velocity.x *= projectile.friction;
                projectile.velocity.y *= projectile.friction;
                projectile.position.x = Math.max(0, Math.min(rules.mapSize, projectile.position.x));
                projectile.position.y = Math.max(0, Math.min(rules.mapSize, projectile.position.y));
            }
            if (projectile.position.x < 0 || projectile.position.y < 0 ||
                projectile.position.x > rules.mapSize || projectile.position.y > rules.mapSize ||
                projectile.remainingTicks <= 0) {
                if (projectile.kind === 'bomb' && projectile.remainingTicks <= 0) {
                    for (const target of Object.values(draft.players)) {
                        if (target.alive && distance(target.position, projectile.position) < projectile.blastRadius) {
                            applyDamage(draft, target, projectile.damage, projectile.ownerId, 'BOMB', events);
                        }
                    }
                }
                continue;
            }
            let hit = false;
            if (projectile.kind !== 'bomb') {
                for (const target of Object.values(draft.players)) {
                    if (target.actorId === projectile.ownerId || !target.alive) continue;
                    if (distance(target.position, projectile.position) <
                        rules.playerRadius + (projectile.kind === 'orb' ? 6 : 0)) {
                        applyDamage(draft, target, projectile.damage, projectile.ownerId, 'PROJECTILE', events);
                        hit = true;
                        break;
                    }
                }
            }
            if (!hit) survivors.push(projectile);
        }
        draft.projectiles = survivors;
    }

    function spawnLoot(loot) {
        if (state.match.status !== 'RUNNING') {
            return makeEngineError(ENGINE_ERRORS.MATCH_NOT_RUNNING);
        }
        if (!isRecord(loot) || Object.keys(loot).sort().join(',') !==
            ['lootId', 'lootType', 'position', 'quantity'].sort().join(',') ||
            typeof loot.lootId !== 'string' || !loot.lootId.trim() ||
            typeof loot.lootType !== 'string' || !loot.lootType.trim() ||
            !['healthKit', 'orbGun'].includes(loot.lootType) ||
            !Number.isFinite(loot.quantity) || loot.quantity <= 0 ||
            !isRecord(loot.position) || !Number.isFinite(loot.position.x) ||
            !Number.isFinite(loot.position.y) || loot.position.x < 0 || loot.position.y < 0 ||
            loot.position.x > rules.mapSize || loot.position.y > rules.mapSize ||
            state.loot.some((item) => item.lootId === loot.lootId)) {
            return makeEngineError(ENGINE_ERRORS.INVALID_COMMAND);
        }
        const draft = clone(state);
        const item = clone(loot);
        draft.loot.push(item);
        const spawned = event(draft, 'LootSpawned', {
            lootId: item.lootId,
            lootType: item.lootType,
            position: { ...item.position }
        });
        const validation = validateGameState(draft);
        if (!validation.ok) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validation.error.path });
        }
        state = draft;
        return { ok: true, state: snapshot(), events: deepFreeze([spawned]), result: null };
    }

    function advanceTick() {
        if (state.match.status !== 'RUNNING') {
            return makeEngineError(ENGINE_ERRORS.MATCH_NOT_RUNNING);
        }
        const now = validNow(clock);
        if (now === null) return makeEngineError(ENGINE_ERRORS.INVALID_RULES);
        const draft = clone(state);
        const events = [];
        draft.timers.elapsedMs += rules.tickMs;
        if (draft.timers.remainingMs !== null) {
            draft.timers.remainingMs = Math.max(0, draft.timers.remainingMs - rules.tickMs);
        }
        updateZone(draft, events);

        for (const player of Object.values(draft.players)) {
            if (!player.alive) continue;
            const direction = player.movement.direction;
            if (direction.x !== 0 || direction.y !== 0) {
                const dashFactor = player.movement.dashTicks > 0 ? 3 : 1;
                const movement = normalizeVector(direction);
                const speed = rules.movementSpeed * dashFactor;
                player.position = {
                    x: Math.max(rules.playerRadius, Math.min(rules.mapSize - rules.playerRadius,
                        player.position.x + movement.x * speed)),
                    y: Math.max(rules.playerRadius, Math.min(rules.mapSize - rules.playerRadius,
                        player.position.y + movement.y * speed))
                };
                player.velocity = { x: movement.x * speed, y: movement.y * speed };
                events.push(event(draft, 'PlayerMoved', {
                    actorId: player.actorId,
                    position: { ...player.position },
                    velocity: { ...player.velocity }
                }, player.actorId));
            } else {
                player.velocity = { x: 0, y: 0 };
            }
            if (player.movement.dashTicks > 0) player.movement.dashTicks--;
            if (player.reload.ticksRemaining > 0) {
                player.reload.ticksRemaining--;
                if (player.reload.ticksRemaining === 0) {
                    const weapon = rules.weapons[player.reload.weapon];
                    const ammoKey = player.reload.weapon === 'orbGun' ? 'orbGun' : 'pistol';
                    if (weapon.reloadEnergyCost) player.energy -= weapon.reloadEnergyCost;
                    player.ammunition[ammoKey] = weapon.magazineSize;
                    player.reload = { ticksRemaining: 0, weapon: null };
                }
            }
            if (distance(player.position, draft.bankZone.center) < draft.bankZone.radius &&
                player.energy > 0) {
                player.score += player.energy;
                player.energy = 0;
                emitScore(draft, player, 'ORB_BANK', events);
            }
            for (let index = draft.orbs.length - 1; index >= 0; index--) {
                const orb = draft.orbs[index];
                if (distance(player.position, orb.position) <
                    rules.playerRadius + rules.pickupRange) {
                    draft.orbs.splice(index, 1);
                    player.energy += orb.amount;
                    events.push(event(draft, 'OrbCollected', {
                        actorId: player.actorId,
                        orbId: orb.orbId,
                        amount: orb.amount
                    }, player.actorId));
                }
            }
            for (let index = draft.loot.length - 1; index >= 0; index--) {
                const loot = draft.loot[index];
                if (distance(player.position, loot.position) >=
                    rules.playerRadius + rules.pickupRange) continue;
                if (loot.lootType === 'healthKit' && player.health.current < player.health.max) {
                    collectLoot(draft, player, index, events);
                } else if (loot.lootType === 'orbGun' &&
                    !player.weapons.owned.includes('orbGun')) {
                    collectLoot(draft, player, index, events);
                }
            }
            const outsideZone = distance(player.position, draft.zone.center) >
                draft.zone.radius + rules.playerRadius;
            const phaseDamage = rules.zone.damagePerSecond[
                Math.min(draft.zone.phase, rules.zone.damagePerSecond.length - 1)
            ];
            if (outsideZone && phaseDamage > 0) {
                applyDamage(draft, player, phaseDamage * rules.tickMs / 1000, null, 'ZONE', events);
            }
        }
        advanceProjectiles(draft, events);
        const validation = validateGameState(draft);
        if (!validation.ok) {
            return makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validation.error.path });
        }
        const previousState = state;
        state = draft;
        const result = draft.timers.remainingMs === 0
            ? finishMatch('TIME_LIMIT')
            : null;
        if (result) {
            if (!result.ok) {
                state = previousState;
                return result;
            }
            return {
                ...result,
                events: deepFreeze([...events, ...result.events])
            };
        }
        return { ok: true, state: snapshot(), events: deepFreeze(events), result: null };
    }

    function execute(command) {
        const validation = validateGameCommand(command);
        if (!validation.ok) {
            const code = validation.error.code === 'INVALID_SEQUENCE'
                ? ENGINE_ERRORS.INVALID_SEQUENCE
                : validation.error.code === 'UNSUPPORTED_SCHEMA_VERSION'
                    ? ENGINE_ERRORS.UNSUPPORTED_SCHEMA_VERSION
                    : validation.error.code === 'INVALID_PAYLOAD'
                        ? ENGINE_ERRORS.INVALID_PAYLOAD
                        : ENGINE_ERRORS.INVALID_COMMAND;
            return makeEngineError(code, { path: validation.error.path });
        }
        if (command.matchId !== state.match.matchId) {
            return makeEngineError(ENGINE_ERRORS.INVALID_COMMAND, { reason: 'MATCH_MISMATCH' });
        }
        const sessionKey = command.sessionId;
        const commandKey = JSON.stringify([sessionKey, command.commandId]);
        const fingerprint = canonical(command);
        const cached = commandResults.get(commandKey);
        if (cached) {
            if (cached.fingerprint !== fingerprint) {
                return makeEngineError(ENGINE_ERRORS.COMMAND_ID_REUSE);
            }
            return { ...clone(cached.response), duplicate: true };
        }
        const boundActor = actorBySession.get(sessionKey);
        if (boundActor && boundActor !== command.actorId) {
            return makeEngineError(ENGINE_ERRORS.INVALID_COMMAND, { reason: 'SESSION_ACTOR_MISMATCH' });
        }
        if (!Object.hasOwn(state.players, command.actorId)) {
            return makeEngineError(ENGINE_ERRORS.PLAYER_NOT_FOUND);
        }
        const expectedSequence = (lastSequenceBySession.get(sessionKey) || 0) + 1;
        if (command.sequence !== expectedSequence) {
            return makeEngineError(ENGINE_ERRORS.INVALID_SEQUENCE, { expected: expectedSequence });
        }
        actorBySession.set(sessionKey, command.actorId);

        const draft = clone(state);
        const processed = processCommand(draft, command);
        lastSequenceBySession.set(sessionKey, command.sequence);
        let response;
        if (processed.error) {
            response = makeEngineError(processed.error.error.code, processed.error.error);
        } else {
            const events = processed.events;
            const validationAfter = validateGameState(draft);
            if (!validationAfter.ok) {
                response = makeEngineError(ENGINE_ERRORS.INVALID_STATE, { path: validationAfter.error.path });
            } else {
                state = draft;
                response = {
                    ok: true,
                    state: snapshot(),
                    events: deepFreeze(events),
                    result: null
                };
            }
        }
        commandResults.set(commandKey, { fingerprint, response: clone(response) });
        while (commandResults.size > maxCachedCommands) {
            commandResults.delete(commandResults.keys().next().value);
        }
        return clone(response);
    }

    return Object.freeze({
        execute,
        advanceTick,
        spawnLoot,
        addPlayer,
        removePlayer,
        transition,
        finishMatch,
        getState: () => snapshot()
    });
}

module.exports = Object.freeze({
    DEFAULT_RULES,
    ENGINE_ERRORS,
    createInitialGameState,
    createGameEngine
});
