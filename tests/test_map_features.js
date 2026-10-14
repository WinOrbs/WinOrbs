'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const game = fs.readFileSync(path.join(root, 'public/game.html'), 'utf8');
const mapSize = Number((server.match(/const MAP_SIZE = (\d+);/) || [])[1]);
assert.equal(mapSize, 7000, 'the arena should be larger than the former 5000-unit map');
assert.match(server, /obs\.x \+ obs\.w \/ 2 - bomb\.currentX[\s\S]*?obs\.y \+ obs\.h \/ 2 - bomb\.currentY/,
    'bomb damage measures distance from the center of scaled obstacles');
const objectiveDefinitions = server.match(/const MATCH_OBJECTIVES = \[([\s\S]*?)\n\];/);
assert.ok(objectiveDefinitions, 'the server defines a set of round objectives');
const objectiveList = new Function(`return [${objectiveDefinitions[1]}];`)();
assert.equal(objectiveList.length, 3, 'each round can draw from three objective styles');
assert.ok(objectiveList.every(({ id, title, target }) =>
    typeof id === 'string' && typeof title === 'string' && target > 0
), 'every objective has an id, user-facing title, and positive target');
const objectivePickerStart = server.indexOf('    elegirObjetivoPartida() {');
const objectivePickerEnd = server.indexOf('\n    // Cadena de centros', objectivePickerStart);
assert.ok(objectivePickerStart >= 0 && objectivePickerEnd > objectivePickerStart,
    'the room has a round-objective picker');
const objectivePickerSource = server.slice(objectivePickerStart, objectivePickerEnd).trim()
    .replace(/^elegirObjetivoPartida/, 'function elegirObjetivoPartida');
const pickObjective = new Function('MATCH_OBJECTIVES', 'Math',
    `return (${objectivePickerSource});`)(objectiveList, Math);
const objectiveRoom = { lastMatchObjectiveId: objectiveList[0].id };
const previousObjectiveId = objectiveRoom.lastMatchObjectiveId;
const nextObjective = pickObjective.call(objectiveRoom);
assert.notEqual(nextObjective.id, previousObjectiveId,
    'consecutive rounds do not repeat the same objective');
assert.ok(objectiveList.some(({ id }) => id === nextObjective.id),
    'the selected objective comes from the supported objective list');

const methodStart = server.indexOf('    generateObstacles() {');
const methodEnd = server.indexOf('\n    // Muros simétricos', methodStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart, 'obstacle generator exists');
const methodSource = server.slice(methodStart, methodEnd).trim()
    .replace(/^generateObstacles/, 'function generateObstacles');
const obstacleTypesBlock = server.match(/const OBSTACULOS_TIPOS = \{[\s\S]*?\n\};/);
assert.ok(obstacleTypesBlock, 'obstacle type definitions exist');
const obstacleTypes = new Function(`${obstacleTypesBlock[0]}; return OBSTACULOS_TIPOS;`)();
const generateObstacles = new Function(
    'MAP_SIZE',
    'OBSTACULOS_TIPOS',
    'Math',
    `return (${methodSource});`
)(mapSize, obstacleTypes, Math);
const explodeStart = server.indexOf('    explotarObstaculo(obs, ownerId, comboId = null) {');
const explodeEnd = server.indexOf('\n    getSummary()', explodeStart);
assert.ok(explodeStart >= 0 && explodeEnd > explodeStart, 'explosive obstacle handler exists');
const explodeSource = server.slice(explodeStart, explodeEnd).trim()
    .replace(/^explotarObstaculo/, 'function explotarObstaculo');
const comboEvents = [];
const explodeObstacle = new Function(
    'OBSTACULOS_TIPOS',
    'BARRIL_CADENA_RADIO',
    'BARRIL_CADENA_TICKS',
    'io',
    `return (${explodeSource});`
)(obstacleTypes, 65, 6, {
    to: () => ({ emit: (event, payload) => {
        if (event === 'explosionCombo') comboEvents.push(payload);
    } })
});

function seededMath(seed) {
    let value = seed >>> 0;
    const math = Object.create(Math);
    math.random = () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x100000000;
    };
    return math;
}

for (let seed = 1; seed <= 8; seed++) {
    const math = seededMath(seed);
    const speedPads = Array.from({ length: 6 }, () => ({
        x: math.random() * (mapSize - 400) + 200,
        y: math.random() * (mapSize - 400) + 200,
        w: 80,
        h: 30
    }));
    const obstacles = generateObstacles.call({
        bankZone: { x: mapSize / 2, y: mapSize / 2, radius: 130 },
        speedPads
    });
    const counts = obstacles.reduce((out, obstacle) => {
        out[obstacle.tipo] = (out[obstacle.tipo] || 0) + 1;
        return out;
    }, {});
    assert.ok(counts.roca >= 20, `seed ${seed}: rocks populate the expanded arena`);
    assert.ok(counts.coche >= 8, `seed ${seed}: realistic car obstacles populate the arena`);
    assert.ok(counts.moto >= 8, `seed ${seed}: realistic motorcycle obstacles populate the arena`);
    assert.ok(counts.barril >= 28, `seed ${seed}: scattered barrels and four five-barrel clusters are generated`);
    assert.ok(obstacles.every((obstacle) =>
        obstacle.x >= 0 && obstacle.y >= 0 &&
        obstacle.x + obstacle.w <= mapSize && obstacle.y + obstacle.h <= mapSize
    ), `seed ${seed}: obstacles stay inside the map`);

    const barrels = obstacles.filter((obstacle) => obstacle.tipo === 'barril');
    const visited = new Set();
    const chainClusters = [];
    barrels.forEach((barrel, start) => {
        if (visited.has(start)) return;
        const component = [];
        const pending = [start];
        visited.add(start);
        while (pending.length) {
            const current = barrels[pending.pop()];
            component.push(current);
            barrels.forEach((candidate, index) => {
                if (visited.has(index)) return;
                const dx = candidate.x + candidate.w / 2 - current.x - current.w / 2;
                const dy = candidate.y + candidate.h / 2 - current.y - current.h / 2;
                if (Math.hypot(dx, dy) <= 225) {
                    visited.add(index);
                    pending.push(index);
                }
            });
        }
        if (component.length >= 5) chainClusters.push(component);
    });
    assert.ok(chainClusters.length >= 4, `seed ${seed}: four close barrel clusters can chain together`);
}

const chainBarrels = Array.from({ length: 5 }, (_, index) => ({
    id: `barrel-${index}`,
    tipo: 'barril',
    x: 1000 + index * 40,
    y: 1000,
    w: 54,
    h: 54,
    hp: obstacleTypes.barril.hp
}));
const chainRoom = {
    id: 'chain-test',
    obstacles: chainBarrels,
    explosions: [],
    explosionChain: [],
    explosionComboCounts: {},
    nextExplosionComboId: 0,
    matchObjective: { id: 'combo', target: 4 },
    objectiveProgress: {},
    players: { player: { id: 'player', teamId: 'A' } },
    bestExplosionCombos: {},
    bestTeamExplosionCombos: {},
    damagePlayer: () => {}
};
explodeObstacle.call(chainRoom, chainBarrels[0], 'player');
assert.equal(chainRoom.obstacles.length, 4, 'the first barrel is removed when it explodes');
assert.equal(chainRoom.explosionChain.length, 4, 'the explosion queues the four nearby barrels');
assert.deepEqual(chainRoom.explosionChain.map(({ ticks }) => ticks), [6, 12, 18, 24],
    'nearby barrels detonate in a visible staggered cascade');
while (chainRoom.explosionChain.length) {
    const next = chainRoom.explosionChain.shift();
    explodeObstacle.call(chainRoom, next.obs, next.ownerId, next.comboId);
}
assert.equal(chainRoom.obstacles.length, 0, 'the chain eventually consumes the whole barrel cluster');
assert.equal(chainRoom.explosions.length, 5, 'each barrel produces one explosion');
assert.deepEqual(comboEvents.map(({ count }) => count), [1, 2, 3, 4, 5],
    'chain explosions emit an authoritative, increasing combo count');
assert.equal(chainRoom.objectiveProgress.player, 5,
    'the server tracks the player’s best chain for the round objective');
assert.equal(chainRoom.bestExplosionCombos.player, 5,
    'the server keeps a separate personal record for the match');
assert.equal(chainRoom.bestTeamExplosionCombos.A, 5,
    'team mode can report its best individual chain for each team');
assert.match(server, /bestCombos: \{ \.\.\.this\.bestExplosionCombos \}[\s\S]*?bestTeamCombos,/,
    'the final results payload includes personal and team combo records');

assert.match(game, /if \(k === 'm' && !e\.repeat && !editableTarget\)/,
    'M toggles the map without repeating while held or hijacking text input');
assert.match(game, /#minimap\.expanded\s*\{[\s\S]*?opacity:\s*0\.76[\s\S]*?pointer-events:\s*none/,
    'the enlarged map stays translucent and does not block gameplay');
assert.match(game, /miniCanvas\.addEventListener\('click', \(\) => cambiarMapaExpandido\(!mapaExpandido\)\)/,
    'the compact map can be expanded by touch or click');
assert.match(game, /map-close-btn'\)\.addEventListener\('click', \(\) => cambiarMapaExpandido\(false\)\)/,
    'the expanded map can be closed by touch or click');
assert.match(game, /TAMANO_MAPA_EXPANDIDO = 700/,
    'the map expands at high internal resolution for legibility');
assert.match(game, /const mapConfigCurrent = roomConfig[\s\S]*?Array\.isArray\(roomConfig\.obstacles\)/,
    'the map overlay reads static obstacle geometry from roomConfig');
assert.match(game, /const mapObstacles = mapConfigCurrent\s*\?\s*combinarMapa\(roomConfig\.obstacles, gameState\.obstaculosHp\)/,
    'the map overlay hides destroyed obstacles using the shared live-geometry helper');
assert.match(game, /socket\.on\('explosionCombo'[\s\S]*?COMBO x\$\{combo\.count\}/,
    'the client shows a visual combo banner to the player who triggered it');
assert.match(game, /id="match-objective"[\s\S]*?id="match-objective-fill"/,
    'the HUD includes a progress card for the current round objective');
assert.match(game, /gameState\.matchObjective[\s\S]*?objectiveProgress\?\.\[myPlayerId\]/,
    'the objective card displays server-authoritative personal progress');
assert.match(game, /bestCombo > 0 \? ` · mejor combo x\$\{bestCombo\}`/,
    'the final standings show each player’s best chain');
assert.match(game, /MEJOR COMBO POR EQUIPO/,
    'team results highlight each team’s best chain');

console.log('OK map features: 7000-unit arena, realistic obstacle scale, chain-barrel clusters and translucent M map.');
