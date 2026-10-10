'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    calculateAimAngle,
    createPathfinder,
    findPath: findBotPath,
    hasLineOfSight
} = require('../apps/server/game/bot_navigation');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const methodStart = source.indexOf('    updateBots() {');
const methodEnd = source.indexOf('    update() {', methodStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart, 'practice bot update method exists');
const methodSource = source.slice(methodStart, methodEnd);
const physicsStart = source.indexOf('            let moveX = 0, moveY = 0;', methodEnd);
const physicsEnd = source.indexOf('            p.isExtracting =', physicsStart);
assert.ok(physicsStart >= 0 && physicsEnd > physicsStart, 'server player movement physics exists');
const physicsSource = source.slice(physicsStart, physicsEnd);
const updateStart = source.indexOf('    update() {', methodEnd);
assert.ok(updateStart >= methodEnd &&
    source.indexOf('if (this.isPractice) this.updateBots();', updateStart) < updateStart + 200,
    'bot AI remains limited to SOLO practice rooms');

let now = 1_000_000;
class TestDate extends Date {
    static now() {
        return now;
    }
}

const sandbox = {
    Date: TestDate,
    Math,
    MAP_SIZE: 5000,
    ITEM_COSTOS: { medkit: 30, shield: 50, bomb: 40, orbGun: 100 },
    RECARGA_ORBES_COSTE: 25,
    createPathfinder,
    findBotPath,
    hasLineOfSight,
    calculateAimAngle
};
const Room = new Function('sandbox',
    'with (sandbox) { return class Room { ' + methodSource + ' }; }')(sandbox);
const applyServerMovement = new Function('sandbox',
    'with (sandbox) { return function (p) { ' + physicsSource + ' }; }')(sandbox);

function createPlayer(id, overrides = {}) {
    return {
        id,
        x: 0,
        y: 0,
        radius: 22,
        hp: 100,
        maxHp: 100,
        shield: 0,
        charge: 0,
        bombs: 0,
        hasOrbGun: false,
        currentWeapon: 1,
        ammo: 15,
        ammo2: 0,
        isDead: false,
        canRespawn: false,
        inputs: { w: false, a: false, s: false, d: false, angle: 0 },
        speed: 4.8,
        botPersonality: 'hunter',
        botTarget: null,
        botTargetPlayerId: null,
        botWanderAngle: 0,
        botPatrolSeed: 0,
        botStrafeDir: 1,
        botNextOrbitAt: 0,
        botOrbitAngle: null,
        botNextDecisionAt: 9_999_999,
        botLastMoveAt: now,
        botLastX: 0,
        botLastY: 0,
        botLastMoveAngle: null,
        botRoute: null,
        botObservedTargets: Object.create(null),
        botAI: { moving: false },
        botNextShotAt: 0,
        botNextBombAt: 0,
        botNextDashAt: 0,
        botNextPurchaseAt: 0,
        isReloading: false,
        ...overrides
    };
}

function createRoom(bot, human, wall) {
    const room = Object.assign(new Room(), {
        isPractice: true,
        gameStarted: true,
        tick: 0,
        players: { [bot.id]: bot, [human.id]: human },
        walls: wall ? [wall] : [],
        obstacles: [],
        speedPads: [],
        droppedEnergy: [],
        droppedHealthKits: [],
        zoneCx: 250,
        zoneCy: 250,
        zoneRadius: 250,
        zoneShrinking: false,
        bankZone: { x: 250, y: 250, radius: 30 },
        shots: [],
        dashes: [],
        respawned: [],
        purchases: []
    });
    room.handleRespawn = (id) => room.respawned.push(id);
    room.handleBuyItem = (id, item) => room.purchases.push({ id, item });
    room.handleSwitchWeapon = () => {};
    room.handleShoot = (id, shot) => room.shots.push({ id, shot });
    room.handleDash = (id) => room.dashes.push(id);
    room.lanzarBomba = () => {};
    room.handleReload = () => {};
    return room;
}

function advanceWithServerCollision(player, room) {
    if (player.isDead) return;
    applyServerMovement.call(room, player);
}

{
    const wall = { x: 220, y: 100, w: 40, h: 300, hp: 30 };
    const bot = createPlayer('bot', {
        isBot: true,
        x: 150,
        y: 250,
        botTarget: { x: 400, y: 250 },
        botLastX: 150,
        botLastY: 250
    });
    const human = createPlayer('human', { x: 50, y: 450, isDead: true });
    const room = createRoom(bot, human, wall);
    let clearedTheWall = false;
    let greatestTravel = 0;
    for (let tick = 0; tick < 140; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
        greatestTravel = Math.max(greatestTravel, Math.hypot(bot.x - 150, bot.y - 250));
        if (bot.x > 270 && (bot.y < 78 || bot.y > 422)) clearedTheWall = true;
    }
    assert.ok(greatestTravel > 250, 'bot advances substantially from its spawn point');
    assert.equal(clearedTheWall, true, 'bot routes around the obstacle instead of pushing into it');
}

{
    const wall = { x: 220, y: 100, w: 40, h: 300, hp: 30 };
    const bot = createPlayer('bot', { isBot: true, x: 100, y: 250 });
    const human = createPlayer('human', { x: 400, y: 250 });
    const room = createRoom(bot, human, wall);
    room.updateBots();
    assert.equal(room.shots.length, 0, 'bot does not waste shots through solid cover');
    assert.equal(bot.botAI.mode, 'engage', 'bot still seeks an enemy behind cover');
    for (let tick = 0; tick < 140; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
    }
    assert.ok(Math.hypot(bot.x - 100, bot.y - 250) > 200,
        'bot travels around cover when it cannot see its target');
    assert.equal(hasLineOfSight(bot, human, room.walls), true,
        'bot reaches a position with a valid line of sight around cover');

    human.y = 700;
    now += 1000;
    room.updateBots();
    assert.ok(room.shots.length > 0, 'bot fires when the target becomes visible');
}

{
    const bot = createPlayer('bot', { isBot: true, x: 150, y: 250 });
    const human = createPlayer('human', { x: 1400, y: 250 });
    const room = createRoom(bot, human, null);
    const rivalBot = createPlayer('nearby-bot', { isBot: true, x: 190, y: 250 });
    room.players[rivalBot.id] = rivalBot;
    room.practiceOwnerId = human.id;

    room.updateBots();

    assert.equal(bot.botAI.targetId, human.id, 'practice bots prioritize the owner over nearby bots');
    assert.equal(bot.botAI.mode, 'engage', 'practice bots pursue the owner at any map distance');
    assert.equal(bot.botAI.moving, true, 'distant pursuit does not leave the bot idle');
    assert.equal(bot.inputs.d, true, 'distant pursuit moves toward the owner');
    assert.ok(room.dashes.includes(bot.id), 'bots dash to close the distance to their target');
    for (let tick = 0; tick < 150; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
    }
    assert.ok(bot.x > 700, 'bot keeps advancing toward the owner instead of stopping after spawning');
}

{
    const bot = createPlayer('bot', {
        isBot: true,
        x: 600,
        y: 600,
        botLastX: 600,
        botLastY: 600
    });
    const human = createPlayer('human', { x: 805, y: 600 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;

    room.updateBots();
    assert.equal(bot.botAI.canShoot, true, 'bot can shoot while at its preferred combat range');
    assert.equal(bot.botAI.moving, true, 'bot keeps orbiting instead of stopping at its ideal range');
    assert.ok(bot.inputs.w || bot.inputs.a || bot.inputs.s || bot.inputs.d,
        'combat movement produces directional input while firing');

    for (let tick = 0; tick < 60; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
    }
    assert.ok(Math.hypot(bot.x - 600, bot.y - 600) > 100,
        'bot continues moving while it remains in firing range');
    const finalDistance = Math.hypot(bot.x - human.x, bot.y - human.y);
    assert.ok(finalDistance >= 150 && finalDistance <= 270,
        'bot orbits the target instead of standing still or blindly closing in');
}

{
    const bot = createPlayer('bot', {
        isBot: true,
        x: 600,
        y: 600,
        botLastX: 600,
        botLastY: 600,
        botAI: { moving: false },
        botLastMoveAt: now - 1000,
        botRoute: {
            key: 'engage:human',
            goalX: 645.6,
            goalY: 471.1,
            waypoints: [{ x: 600, y: 600 }],
            index: 0,
            computedAt: now
        }
    });
    const human = createPlayer('human', { x: 805, y: 600 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;

    room.updateBots();
    assert.equal(bot.botAI.moving, true,
        'combat orbit is not cancelled when a stale path ends short of the goal');
    assert.equal(bot.botStrafeDir, -1, 'stuck recovery reverses the orbit direction');
    assert.ok(bot.inputs.w || bot.inputs.a || bot.inputs.s || bot.inputs.d,
        'stuck combat bot emits a new movement direction');
    const start = { x: bot.x, y: bot.y };
    advanceWithServerCollision(bot, room);
    assert.ok(Math.hypot(bot.x - start.x, bot.y - start.y) > 0,
        'stuck combat recovery results in actual physical displacement');
}

{
    const bot = createPlayer('bot', { isBot: true, x: 600, y: 600 });
    const human = createPlayer('human', { x: 1200, y: 600 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;
    room.updateBots();
    room.botNavigation.pathfinder = { findPath: () => null };
    bot.botRoute = null;
    const start = { x: bot.x, y: bot.y };

    for (let tick = 0; tick < 60; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
    }

    assert.ok(Math.hypot(bot.x - start.x, bot.y - start.y) > 200,
        'empty navigation results fall back to direct safe movement instead of idling');
}

{
    const human = createPlayer('human', { x: 2500, y: 2500 });
    const bots = [
        createPlayer('bot-east', { isBot: true, x: 1500, y: 2500 }),
        createPlayer('bot-west', { isBot: true, x: 3500, y: 2500 }),
        createPlayer('bot-north', { isBot: true, x: 2500, y: 1500 }),
        createPlayer('bot-south', { isBot: true, x: 2500, y: 3500 }),
        createPlayer('bot-diagonal', { isBot: true, x: 1800, y: 1800 })
    ];
    const room = createRoom(bots[0], human, {
        id: 'wall-pursuit',
        x: 1950,
        y: 2300,
        w: 80,
        h: 400,
        hp: 100
    });
    bots.slice(1).forEach((bot) => {
        room.players[bot.id] = bot;
        bot.botLastX = bot.x;
        bot.botLastY = bot.y;
    });
    room.practiceOwnerId = human.id;
    room.obstacles = [{
        id: 'obstacle-pursuit',
        x: 2380,
        y: 2050,
        w: 110,
        h: 130,
        hp: 100
    }];
    const samples = new Map(bots.map((bot) => [bot.id, {
        start: { x: bot.x, y: bot.y },
        distance: 0,
        stillTicks: 0,
        maxStillTicks: 0
    }]));

    for (let tick = 0; tick < 600; tick++) {
        now += 1000 / 60;
        room.tick++;
        room.updateBots();
        for (const bot of bots) {
            const sample = samples.get(bot.id);
            const before = { x: bot.x, y: bot.y };
            advanceWithServerCollision(bot, room);
            const stepDistance = Math.hypot(bot.x - before.x, bot.y - before.y);
            sample.distance += stepDistance;
            sample.stillTicks = stepDistance < 0.01 ? sample.stillTicks + 1 : 0;
            sample.maxStillTicks = Math.max(sample.maxStillTicks, sample.stillTicks);
        }
    }

    const report = bots.map((bot) => {
        const sample = samples.get(bot.id);
        return {
            id: bot.id,
            start: sample.start,
            end: { x: bot.x, y: bot.y },
            distance: Math.round(sample.distance),
            maxStillTicks: sample.maxStillTicks
        };
    });
    console.log('Five-bot 600-tick movement simulation:', JSON.stringify(report));
    for (const result of report) {
        assert.ok(result.distance > 300, `${result.id} accumulates real movement over 600 ticks`);
        assert.ok(result.maxStillTicks < 90, `${result.id} does not remain stuck for 1.5 seconds`);
    }
    for (const bot of bots) {
        for (const solid of [...room.walls, ...room.obstacles]) {
            const nearestX = Math.max(solid.x, Math.min(bot.x, solid.x + solid.w));
            const nearestY = Math.max(solid.y, Math.min(bot.y, solid.y + solid.h));
            assert.ok(Math.hypot(bot.x - nearestX, bot.y - nearestY) >= bot.radius - 0.01,
                `${bot.id} remains outside solid collision geometry`);
        }
    }
}

{
    const bot = createPlayer('bot', { isBot: true, x: 150, y: 250 });
    const human = createPlayer('human', { x: 1200, y: 250 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;
    room.droppedEnergy = [{ id: 'orb-near-route', x: 230, y: 250, val: 10 }];

    room.updateBots();

    assert.equal(bot.botAI.mode, 'loot', 'bots collect nearby orbs that lie on the pursuit route');
    assert.equal(bot.botAI.moving, true, 'bot keeps moving toward a useful orb');

    bot.x = 450;
    bot.y = 250;
    bot.charge = 70;
    bot.botRoute = null;
    room.droppedEnergy = [];
    room.updateBots();

    assert.equal(bot.botAI.mode, 'bank', 'bots divert briefly to deposit carried orbs');
    assert.equal(bot.botBankingOrbs, true, 'the bot keeps its banking objective until it reaches the bank');
    for (let tick = 0; tick < 100 &&
        Math.hypot(bot.x - room.bankZone.x, bot.y - room.bankZone.y) > room.bankZone.radius * 0.8;
        tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
    }
    now += 17;
    room.tick++;
    room.updateBots();
    assert.equal(bot.botAI.moving, false, 'bot stops inside the bank instead of immediately leaving');
    bot.charge = 0;
    now += 17;
    room.updateBots();
    assert.equal(bot.botBankingOrbs, false, 'bot resumes hunting after depositing its orbs');
    assert.equal(bot.botAI.mode, 'engage', 'bot returns to the owner after banking');
}

{
    const bot = createPlayer('bot', {
        isBot: true,
        isDead: true,
        canRespawn: true,
        inputs: { w: true, a: false, s: false, d: false, angle: 0 }
    });
    const room = createRoom(bot, createPlayer('human'), null);
    bot.x = 600;
    bot.y = 600;
    room.updateBots();
    assert.deepEqual(room.respawned, ['bot'], 'eligible practice bots use the existing respawn flow');
    advanceWithServerCollision(bot, room);
    assert.deepEqual({ x: bot.x, y: bot.y }, { x: 600, y: 600 },
        'dead bots do not move even if stale directional input remains');
}

console.log('OK practice bots: sustained movement, obstacle navigation, cover-aware combat, and respawn.');
