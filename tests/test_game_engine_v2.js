'use strict';

const assert = require('assert');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const { ENGINE_ERRORS, createGameEngine } = require('../packages/game-engine/v2');

function player(actorId, overrides = {}) {
    return {
        actorId,
        teamId: null,
        position: { x: 100, y: 100 },
        velocity: { x: 0, y: 0 },
        health: { current: 100, max: 100 },
        shield: 0,
        energy: 0,
        movement: { direction: { x: 0, y: 0 }, dashTicks: 0 },
        weapons: { equipped: 'pistol', owned: ['pistol'] },
        ammunition: { pistol: 15, orbGun: 3 },
        cooldowns: {},
        reload: { ticksRemaining: 0, weapon: null },
        inventory: { bombs: 0 },
        score: 0,
        kills: 0,
        deaths: 0,
        respawn: { eligible: false, availableAt: null },
        alive: true,
        ...overrides
    };
}

function initialState(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        match: {
            matchId: 'match-test',
            status: 'WAITING',
            rulesVersion: 'rules-test',
            startedAt: null
        },
        players: {
            p1: player('p1'),
            p2: player('p2', { position: { x: 150, y: 100 } })
        },
        teams: {},
        projectiles: [],
        loot: [],
        orbs: [],
        zone: { center: { x: 2500, y: 2500 }, radius: 4000, phase: 0 },
        bankZone: { center: { x: 2500, y: 2500 }, radius: 130 },
        timers: { elapsedMs: 0, remainingMs: 60000 },
        sequence: 0,
        ...overrides
    };
}

function command(actorId, sequence, type, payload, overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        commandId: `${actorId}-${sequence}`,
        sessionId: `session-${actorId}`,
        matchId: 'match-test',
        actorId,
        sequence,
        type,
        payload,
        ...overrides
    };
}

function createStartedEngine(state = initialState(), rules = {}, clock = () => 1000) {
    const engine = createGameEngine(state, rules, { clock });
    assert.strictEqual(engine.transition('READY').ok, true);
    assert.strictEqual(engine.transition('COUNTDOWN').ok, true);
    const start = engine.transition('RUNNING');
    assert.strictEqual(start.ok, true);
    return engine;
}

function eventOf(result, type) {
    return result.events.find((item) => item.type === type);
}

// Lifecycle transitions are server/application operations, not commands.
{
    const engine = createGameEngine(initialState({
        match: {
            matchId: 'match-test',
            status: 'WAITING',
            rulesVersion: 'rules-test',
            startedAt: null
        }
    }));
    assert.strictEqual(engine.transition('RUNNING').error.code, ENGINE_ERRORS.INVALID_STATE_TRANSITION);
    assert.strictEqual(engine.transition('READY').ok, true);
    assert.strictEqual(engine.transition('COUNTDOWN').ok, true);
    assert.strictEqual(eventOf(engine.transition('RUNNING'), 'MatchStarted').type, 'MatchStarted');
    assert.strictEqual(engine.execute(command('p1', 1, 'MovePlayer', {
        direction: { x: 1, y: 0 }
    })).ok, true);
}

// Movement is intent-based, bounded by the map, and a zero vector stops motion.
{
    const state = initialState({
        players: {
            p1: player('p1', { position: { x: 4979, y: 2500 } }),
            p2: player('p2')
        }
    });
    const engine = createStartedEngine(state);
    const moved = engine.execute(command('p1', 1, 'MovePlayer', {
        direction: { x: 1, y: 0 }
    }));
    assert.strictEqual(moved.ok, true);
    assert.strictEqual(moved.state.players.p1.position.x, 4979);
    const movementTick = engine.advanceTick();
    assert.strictEqual(movementTick.state.players.p1.position.x, 4978);
    assert.deepStrictEqual(eventOf(movementTick, 'PlayerMoved').payload.velocity, { x: 5.5, y: 0 });
    const stopped = engine.execute(command('p1', 2, 'MovePlayer', {
        direction: { x: 0, y: 0 }
    }));
    assert.strictEqual(stopped.ok, true);
    assert.strictEqual(stopped.state.players.p1.position.x, 4978);
    assert.strictEqual(engine.advanceTick().ok, true);
    assert.strictEqual(engine.getState().players.p1.position.x, 4978);
}

// Sequence ordering, duplicate replay and command-ID reuse are explicit.
{
    const engine = createStartedEngine();
    assert.strictEqual(engine.execute(command('__proto__', 1, 'Dash', {})).error.code,
        ENGINE_ERRORS.PLAYER_NOT_FOUND);
    const firstCommand = command('p1', 1, 'MovePlayer', { direction: { x: 1, y: 0 } });
    const first = engine.execute(firstCommand);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(engine.execute(firstCommand).duplicate, true);
    assert.strictEqual(engine.execute(command('p1', 3, 'Dash', {})).error.code,
        ENGINE_ERRORS.INVALID_SEQUENCE);
    assert.strictEqual(engine.execute(command('p1', 1, 'Dash', {}, {
        commandId: firstCommand.commandId
    })).error.code, ENGINE_ERRORS.COMMAND_ID_REUSE);
    assert.strictEqual(engine.execute(command('p2', 1, 'Dash', {}, {
        sessionId: firstCommand.sessionId
    })).error.code, ENGINE_ERRORS.INVALID_COMMAND);
}

// Dash and weapon selection change only match-local movement/equipment state.
{
    const state = initialState({
        players: {
            p1: player('p1', {
                weapons: { equipped: 'pistol', owned: ['pistol', 'orbGun'] }
            }),
            p2: player('p2')
        }
    });
    const before = JSON.stringify(state);
    const engine = createStartedEngine(state);
    assert.strictEqual(engine.execute(command('p1', 1, 'Dash', {})).ok, true);
    assert.strictEqual(engine.getState().players.p1.movement.dashTicks, 15);
    assert.strictEqual(engine.execute(command('p1', 2, 'Dash', {})).error.code,
        ENGINE_ERRORS.WEAPON_COOLDOWN);
    const switched = engine.execute(command('p1', 3, 'SwitchWeapon', { weapon: 2 }));
    assert.strictEqual(switched.ok, true);
    assert.strictEqual(switched.state.players.p1.weapons.equipped, 'orbGun');
    engine.execute(command('p1', 4, 'MovePlayer', { direction: { x: 1, y: 0 } }));
    assert.strictEqual(engine.advanceTick().state.players.p1.position.x, 116.5);
    assert.strictEqual(JSON.stringify(state), before);
}

// Pistol projectiles, cooldowns, shield damage and elimination are server-derived.
{
    let now = 1000;
    const state = initialState({
        players: {
            p1: player('p1'),
            p2: player('p2', {
                position: { x: 150, y: 100 },
                health: { current: 10, max: 100 },
                shield: 10,
                energy: 100
            })
        }
    });
    const engine = createStartedEngine(state, {}, () => now);
    const shot = engine.execute(command('p1', 1, 'Shoot', { angle: 0 }));
    assert.strictEqual(shot.ok, true);
    assert.strictEqual(shot.state.players.p1.ammunition.pistol, 14);
    assert.strictEqual(eventOf(shot, 'ShotFired').payload.weapon, 'pistol');
    const tooSoon = engine.execute(command('p1', 2, 'Shoot', { angle: 0 }));
    assert.strictEqual(tooSoon.error.code, ENGINE_ERRORS.WEAPON_COOLDOWN);
    now += 121;
    assert.strictEqual(engine.execute(command('p1', 3, 'Shoot', { angle: 0 })).ok, true);
    const tick = engine.advanceTick();
    assert.strictEqual(eventOf(tick, 'DamageApplied').payload.absorbed, 10);
    assert.ok(eventOf(tick, 'PlayerDied'));
    assert.ok(eventOf(tick, 'PlayerKilled'));
    assert.ok(eventOf(tick, 'OrbDropped'));
    assert.strictEqual(tick.state.players.p1.kills, 1);
    assert.strictEqual(tick.state.players.p1.score, 5);
    assert.strictEqual(tick.state.players.p2.energy, 80);
    assert.strictEqual(tick.state.players.p2.respawn.eligible, true);
}

// Orb collection and banking affect only match-local energy and score.
{
    const engine = createStartedEngine(initialState({
        players: {
            p1: player('p1', { position: { x: 2500, y: 2500 } }),
            p2: player('p2', { position: { x: 100, y: 100 } })
        },
        orbs: [{ orbId: 'orb-1', position: { x: 2501, y: 2500 }, amount: 25 }]
    }));
    const collected = engine.advanceTick();
    assert.ok(eventOf(collected, 'OrbCollected'));
    assert.strictEqual(collected.state.players.p1.energy, 25);
    assert.strictEqual(collected.state.players.p1.score, 0);
    const banked = engine.advanceTick();
    assert.strictEqual(banked.state.players.p1.energy, 0);
    assert.strictEqual(banked.state.players.p1.score, 25);
    assert.ok(eventOf(banked, 'ScoreUpdated'));
    assert.ok(!Object.hasOwn(banked.state.players.p1, 'wallet'));
}

// Loot pickup validates existence/range, consumes once and applies supported effects.
{
    const engine = createStartedEngine(initialState({
        players: {
            p1: player('p1', { health: { current: 50, max: 100 } }),
            p2: player('p2', { position: { x: 1000, y: 1000 } })
        },
        loot: [
            { lootId: 'kit', lootType: 'healthKit', position: { x: 105, y: 100 }, quantity: 40 },
            { lootId: 'far-kit', lootType: 'healthKit', position: { x: 500, y: 500 }, quantity: 40 }
        ]
    }));
    const far = engine.execute(command('p1', 1, 'PickupLoot', { lootId: 'far-kit' }));
    assert.strictEqual(far.error.code, ENGINE_ERRORS.OUT_OF_RANGE);
    const picked = engine.execute(command('p1', 2, 'PickupLoot', { lootId: 'kit' }));
    assert.strictEqual(picked.ok, true);
    assert.strictEqual(picked.state.players.p1.health.current, 90);
    assert.ok(eventOf(picked, 'LootCollected'));
    assert.strictEqual(picked.state.loot.length, 1);
    assert.strictEqual(engine.execute(command('p1', 3, 'PickupLoot', { lootId: 'kit' }))
        .error.code, ENGINE_ERRORS.INVALID_TARGET);
}

// Loot spawns are trusted engine/application operations, not client commands.
{
    const engine = createStartedEngine(initialState({
        players: {
            p1: player('p1', { health: { current: 50, max: 100 } }),
            p2: player('p2')
        },
        loot: [{
            lootId: 'orb-gun-drop',
            lootType: 'orbGun',
            position: { x: 100, y: 100 },
            quantity: 1
        }]
    }));
    const spawned = engine.spawnLoot({
        lootId: 'spawned-kit',
        lootType: 'healthKit',
        position: { x: 100, y: 100 },
        quantity: 40
    });
    assert.strictEqual(spawned.ok, true);
    assert.ok(eventOf(spawned, 'LootSpawned'));
    assert.strictEqual(engine.spawnLoot({
        lootId: 'spawned-kit',
        lootType: 'healthKit',
        position: { x: 100, y: 100 },
        quantity: 40
    }).ok, false);
    const pickupTick = engine.advanceTick();
    assert.strictEqual(pickupTick.state.players.p1.health.current, 90);
    assert.strictEqual(pickupTick.state.players.p1.weapons.equipped, 'orbGun');
    assert.strictEqual(pickupTick.state.loot.length, 0);
    assert.strictEqual(pickupTick.events.filter((item) => item.type === 'LootCollected').length, 2);
}

// Reloading, weapon switching, bombs and respawn follow configured match rules.
{
    const now = { value: 1000 };
    const state = initialState({
        players: {
            p1: player('p1', {
                ammunition: { pistol: 1, orbGun: 0 },
                energy: 25,
                weapons: { equipped: 'orbGun', owned: ['pistol', 'orbGun'] },
                inventory: { bombs: 1 }
            }),
            p2: player('p2', { position: { x: 374, y: 100 } })
        }
    });
    const engine = createStartedEngine(state, {}, () => now.value);
    assert.strictEqual(engine.execute(command('p1', 1, 'Reload', {})).ok, true);
    assert.strictEqual(engine.getState().players.p1.reload.ticksRemaining, 150);
    for (let i = 0; i < 150; i++) {
        now.value += 17;
        engine.advanceTick();
    }
    assert.strictEqual(engine.getState().players.p1.energy, 0);
    assert.strictEqual(engine.getState().players.p1.ammunition.orbGun, 3);

    const bomb = engine.execute(command('p1', 2, 'ThrowBomb', { angle: 0 }));
    assert.strictEqual(bomb.ok, true);
    assert.strictEqual(bomb.state.players.p1.inventory.bombs, 0);
    assert.strictEqual(bomb.state.projectiles[0].kind, 'bomb');
    for (let i = 0; i < 90; i++) {
        now.value += 17;
        engine.advanceTick();
    }
    assert.ok(engine.getState().players.p2.health.current < 100);
}

// Respawn waits for the configured delay and resets only match combat state.
{
    let now = 1000;
    const dead = player('p1', {
        alive: false,
        health: { current: 0, max: 100 },
        energy: 80,
        deaths: 1,
        score: 12,
        kills: 2,
        respawn: { eligible: true, availableAt: 1500 }
    });
    const engine = createStartedEngine(initialState({
        players: { p1: dead, p2: player('p2') },
        orbs: [{ orbId: 'drop', position: { x: 100, y: 100 }, amount: 20 }]
    }), {}, () => now);
    assert.strictEqual(engine.execute(command('p1', 1, 'Respawn', {})).error.code,
        ENGINE_ERRORS.RESPAWN_NOT_READY);
    now = 1500;
    const respawned = engine.execute(command('p1', 2, 'Respawn', {}));
    assert.strictEqual(respawned.ok, true);
    assert.ok(eventOf(respawned, 'PlayerRespawned'));
    assert.strictEqual(respawned.state.players.p1.health.current, 100);
    assert.strictEqual(respawned.state.players.p1.energy, 0);
    assert.strictEqual(respawned.state.players.p1.score, 12);
}

// Finalization is server-side, immutable in shape, deterministic and money-free.
{
    function run() {
        const engine = createStartedEngine(initialState(), {}, () => 2000);
        engine.execute(command('p1', 1, 'MovePlayer', { direction: { x: 1, y: 0 } }));
        return engine.finishMatch('TIME_LIMIT');
    }
    const a = run();
    const b = run();
    assert.strictEqual(a.ok, true);
    assert.strictEqual(a.state.match.status, 'RESULT_LOCKED');
    assert.ok(eventOf(a, 'MatchFinished'));
    assert.deepStrictEqual(a.state, b.state);
    assert.deepStrictEqual(a.events, b.events);
    assert.deepStrictEqual(a.result, b.result);
    assert.strictEqual(Object.isFrozen(a.result), true);
    assert.strictEqual(Object.hasOwn(a.result, 'prize'), false);
    assert.strictEqual(a.result.resultHash.length, 64);
}

// Zone damage, zone events and time-limit finalization use injected rules and clock.
{
    let now = 2000;
    const state = initialState({
        players: {
            p1: player('p1', { position: { x: 100, y: 100 } }),
            p2: player('p2', { position: { x: 200, y: 200 } })
        },
        zone: { center: { x: 2500, y: 2500 }, radius: 100, phase: 0 },
        timers: { elapsedMs: 0, remainingMs: 5 }
    });
    const engine = createStartedEngine(state, {
        tickMs: 10,
        zone: {
            closeSpeed: 0,
            centerSpeed: 0,
            damagePerSecond: [60],
            phases: [{ remainingMs: 0, radius: 100, center: { x: 2500, y: 2500 } }]
        }
    }, () => now);
    now += 10;
    const finished = engine.advanceTick();
    assert.strictEqual(finished.ok, true);
    assert.strictEqual(finished.state.match.status, 'RESULT_LOCKED');
    assert.strictEqual(finished.result.finishReason, 'TIME_LIMIT');
    assert.ok(eventOf(finished, 'DamageApplied'));
    assert.ok(eventOf(finished, 'MatchFinished'));
}

// Invalid structures, authoritative client fields and illegal lifecycle operations fail closed.
{
    const engine = createStartedEngine();
    const invalid = engine.execute(command('p1', 1, 'Shoot', { angle: Infinity }));
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.error.code, ENGINE_ERRORS.INVALID_PAYLOAD);
    assert.strictEqual(engine.execute(command('p1', 1, 'MovePlayer', {
        direction: { x: 1, y: 0 },
        score: 999
    })).ok, false);
    for (const field of ['damage', 'health', 'shield', 'kills', 'wallet', 'balance', 'prize', 'payout', 'xp', 'level']) {
        const forged = command('p1', 1, 'Shoot', { angle: 0 });
        forged[field] = 1;
        assert.strictEqual(engine.execute(forged).ok, false, `accepted client-authored ${field}`);
    }
    assert.strictEqual(engine.transition('SETTLING').error.code, ENGINE_ERRORS.INVALID_STATE_TRANSITION);
    assert.strictEqual(engine.finishMatch('UNKNOWN').error.code, ENGINE_ERRORS.INVALID_STATE_TRANSITION);
    assert.strictEqual(engine.advanceTick().ok, true);
}

console.log('OK game engine v2: deterministic commands, ticks, combat, match resources and results.');
