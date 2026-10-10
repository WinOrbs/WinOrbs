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
const { choosePracticeBotIntent } = require('../apps/server/game/bot_ai');
const { bankMatchOrbs } = require('../apps/server/game/score');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const methodStart = source.indexOf('    updateBots() {');
const methodEnd = source.indexOf('    update() {', methodStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart, 'practice bot update method exists');
const methodSource = source.slice(methodStart, methodEnd);
const emptyAmmoStart = source.indexOf('    avisarSinMunicion(p, texto) {');
const shootStart = source.indexOf('    handleShoot(socketId, shootData) {');
const shootEnd = source.indexOf('    lanzarBomba(', shootStart);
assert.ok(emptyAmmoStart >= 0 && shootStart > emptyAmmoStart && shootEnd > shootStart,
    'normal server shooting and empty-ammo handlers exist');
const emptyAmmoSource = source.slice(emptyAmmoStart, shootStart);
const shootSource = source.slice(shootStart, shootEnd);
const physicsStart = source.indexOf('            let moveX = 0, moveY = 0;', methodEnd);
const physicsEnd = source.indexOf('            p.isExtracting =', physicsStart);
assert.ok(physicsStart >= 0 && physicsEnd > physicsStart, 'server player movement physics exists');
const physicsSource = source.slice(physicsStart, physicsEnd);
const orbScoringEnd = source.indexOf('            // Botiquines:', physicsEnd);
const healthPickupEnd = source.indexOf('            // Lanza-Orbes', orbScoringEnd);
assert.ok(orbScoringEnd > physicsEnd && healthPickupEnd > orbScoringEnd,
    'normal orb banking and health pickup handlers exist');
const orbScoringSource = source.slice(physicsEnd, orbScoringEnd);
const healthPickupSource = source.slice(orbScoringEnd, healthPickupEnd);
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
    calculateAimAngle,
    choosePracticeBotIntent,
    bankMatchOrbs,
    validateShoot: () => ({ ok: true }),
    SHOOT_COOLDOWN: { 1: 120, 2: 120 },
    io: {
        to: () => ({ emit: () => {} }),
        sockets: { sockets: { get: () => null } }
    }
};
const Room = new Function('sandbox',
    'with (sandbox) { return class Room { ' + methodSource + emptyAmmoSource + shootSource + ' }; }')(sandbox);
const applyServerMovement = new Function('sandbox',
    'with (sandbox) { return function (p) { ' + physicsSource + ' }; }')(sandbox);
const applyServerOrbScoring = new Function('sandbox',
    'with (sandbox) { return function (p) { ' + orbScoringSource + ' }; }')(sandbox);
const applyServerHealthPickup = new Function('sandbox',
    'with (sandbox) { return function (p) { ' + healthPickupSource + ' }; }')(sandbox);

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
        botStuckTicks: 0,
        botRecoveryCooldownTicks: 0,
        botLastMoveAngle: null,
        botObjective: null,
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
        bullets: [],
        dashes: [],
        respawned: [],
        purchases: []
    });
    room.handleRespawn = (id) => room.respawned.push(id);
    room.handleBuyItem = (id, item) => room.purchases.push({ id, item });
    room.handleSwitchWeapon = () => {};
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
    assert.equal(room.bullets.length, 0, 'bot does not waste shots through solid cover');
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
    assert.ok(room.bullets.length > 0, 'bot uses the normal server shooting handler when visible');
    assert.ok(bot.ammo < 15, 'normal firing consumes the bot’s ordinary ammunition');
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
        y: 600
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
        botAI: { moving: true },
        botStuckTicks: 45,
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
    const bot = createPlayer('bot', {
        isBot: true,
        x: 600,
        y: 600,
        botRoute: {
            key: 'loot:partial-orb',
            goalX: 750,
            goalY: 600,
            waypoints: [{ x: 600, y: 600 }],
            index: 0,
            computedAt: now
        }
    });
    const human = createPlayer('human', { x: 1200, y: 600 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;
    room.droppedEnergy = [{ id: 'partial-orb', x: 750, y: 600, val: 10 }];

    room.updateBots();
    assert.equal(bot.botAI.mode, 'loot', 'bot retains the valid resource objective');
    assert.equal(bot.botAI.moving, true,
        'an exhausted partial route cannot cancel movement toward a reachable resource');
    const start = { x: bot.x, y: bot.y };
    advanceWithServerCollision(bot, room);
    assert.ok(Math.hypot(bot.x - start.x, bot.y - start.y) > 0,
        'the fallback from a partial route reaches the real movement loop');
}

{
    const bot = createPlayer('bot', {
        isBot: true,
        x: 600,
        y: 600,
        botAI: { moving: true },
        inputs: { w: false, a: false, s: false, d: true, angle: 0 }
    });
    const human = createPlayer('human', { x: 1200, y: 600 });
    const room = createRoom(bot, human, {
        id: 'blocking-wall',
        x: 622,
        y: 560,
        w: 60,
        h: 80,
        hp: 100
    });
    room.practiceOwnerId = human.id;

    for (let tick = 0; tick < 45; tick++) advanceWithServerCollision(bot, room);
    assert.equal(bot.botStuckTicks, 45,
        'the real post-collision movement loop counts consecutive zero-displacement ticks');

    room.updateBots();
    assert.equal(bot.botStuckTicks, 0, 'stuck recovery clears the measured no-progress counter');
    assert.equal(bot.botRecoveryCooldownTicks, 90, 'recovery uses a bounded 90-tick cooldown');
    const beforeRecoveryStep = { x: bot.x, y: bot.y };
    advanceWithServerCollision(bot, room);
    assert.ok(Math.hypot(bot.x - beforeRecoveryStep.x, bot.y - beforeRecoveryStep.y) >= 0.5,
        'the recovered direction produces real movement around the blocking wall');
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
        maxStillTicks: 0,
        scoreStart: bot.bankedScore || 0
    }]));
    const simulationStartedAt = performance.now();

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
    const simulationDurationMs = performance.now() - simulationStartedAt;

    const report = bots.map((bot) => {
        const sample = samples.get(bot.id);
        return {
            id: bot.id,
            start: sample.start,
            end: { x: bot.x, y: bot.y },
            distance: Math.round(sample.distance),
            maxStillTicks: sample.maxStillTicks,
            state: bot.botAI?.mode || null,
            targetId: bot.botAI?.targetId || null,
            scoreStart: sample.scoreStart,
            scoreEnd: bot.bankedScore || 0
        };
    });
    console.log('Five-bot 600-tick movement simulation:', JSON.stringify({
        durationMs: Math.round(simulationDurationMs),
        bots: report
    }));
    assert.ok(simulationDurationMs < 5000, 'multi-bot simulation completes within the performance budget');
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
    const bot = createPlayer('bot', { isBot: true, x: 100, y: 250 });
    const human = createPlayer('human', { x: 1200, y: 250 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;
    room.droppedEnergy = [
        { id: 'committed-orb', x: 200, y: 250, val: 10 },
        { id: 'new-nearer-orb', x: 280, y: 250, val: 10 }
    ];

    room.updateBots();
    assert.equal(bot.botObjective.resourceId, 'committed-orb',
        'bot commits to the first worthwhile resource');
    room.droppedEnergy[1].x = 110;
    room.updateBots();
    assert.equal(bot.botObjective.resourceId, 'committed-orb',
        'a newly nearer resource does not make the bot switch objectives every tick');

    human.x = bot.x + 200;
    room.updateBots();
    assert.equal(bot.botAI.mode, 'engage',
        'a nearby combat threat preempts resource collection');
}

{
    const bot = createPlayer('bot', {
        isBot: true,
        x: 400,
        y: 250,
        bankedScore: 0
    });
    const human = createPlayer('human', { x: 1500, y: 250 });
    const room = createRoom(bot, human, null);
    room.practiceOwnerId = human.id;
    room.droppedEnergy = [{ id: 'bank-test-orb', x: bot.x, y: bot.y, val: 70 }];
    const start = { x: bot.x, y: bot.y };

    applyServerOrbScoring.call(room, bot);
    assert.equal(bot.charge, 70, 'bots collect match energy through the normal player pickup loop');
    assert.equal(bot.bankedScore, 0, 'collecting unbanked energy does not award points yet');
    assert.equal(room.droppedEnergy.length, 0, 'the normal pickup loop removes the collected orb');

    room.updateBots();
    assert.equal(bot.botAI.mode, 'bank', 'the state machine selects the existing bank objective');
    for (let tick = 0; tick < 80 && bot.bankedScore === 0; tick++) {
        now += 17;
        room.tick++;
        room.updateBots();
        advanceWithServerCollision(bot, room);
        applyServerOrbScoring.call(room, bot);
    }
    assert.equal(bot.charge, 0, 'the normal bank loop consumes carried energy');
    assert.equal(bot.bankedScore, 70, 'the normal bankMatchOrbs rule awards the points');
    console.log('Bot scoring simulation:', JSON.stringify({
        start,
        end: { x: bot.x, y: bot.y },
        distance: Math.round(Math.hypot(bot.x - start.x, bot.y - start.y)),
        state: bot.botAI.mode,
        targetId: bot.botAI.targetId,
        scoreStart: 0,
        scoreEnd: bot.bankedScore
    }));

    bot.hp = 40;
    room.droppedHealthKits = [{ id: 'health-test-kit', x: bot.x, y: bot.y, val: 30 }];
    applyServerHealthPickup.call(room, bot);
    assert.equal(bot.hp, 70, 'bots collect useful health kits through the normal pickup loop');
    assert.equal(room.droppedHealthKits.length, 0, 'the normal health pickup loop consumes the kit');
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
