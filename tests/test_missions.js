'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const game = fs.readFileSync('public/game.html', 'utf8');
const tasksBlock = server.match(/const MISSION_TASKS = \[([\s\S]*?)\n\];/);
assert.ok(tasksBlock, 'the server defines mission checklist tasks');
const tasks = new Function(`return [${tasksBlock[1]}];`)();
assert.equal(tasks.length, 12, 'the mission pool has enough variety for randomized checklists');
assert.ok(tasks.every((task) =>
    task.id && task.title && Number.isInteger(task.target) && task.target > 0
), 'each mission task has a server id, label, and positive target');
assert.match(server, /MISSION_DROP_PROBABILITY = 0\.1/,
    'destructible cover has the agreed 10% mission drop chance');
assert.match(server, /MISSION_TASK_REWARD = 70/,
    'each completed checklist task awards 70 match points');

function extractMethod(name, nextName, dependencies) {
    const start = server.indexOf(`    ${name}(`);
    const end = server.indexOf(`\n    ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, `${name} method exists`);
    const source = server.slice(start, end).trim()
        .replace(new RegExp(`^${name}`), `function ${name}`);
    return new Function(...Object.keys(dependencies), `return (${source});`)(
        ...Object.values(dependencies)
    );
}

const missionScopeKey = extractMethod('missionScopeKey', 'notificarMision', {});
const createMission = extractMethod('crearMision', 'avanzarMision', {
    MISSION_TASKS: tasks,
    Math,
    randID: () => 'mission-test'
});
const advanceMission = extractMethod('avanzarMision', 'soltarMision', {
    MISSION_TASK_REWARD: 70
});

let seed = 1;
const deterministicMath = Object.create(Math);
deterministicMath.random = () => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed / 0x7fffffff;
};
const owner = { id: 'owner', teamId: 'A', charge: 0, isDead: false };
const teammate = { id: 'teammate', teamId: 'A', charge: 0, isDead: false };
const events = [];
const room = {
    mode: 'teams',
    players: { owner, teammate },
    activeMissions: {},
    missionScopeKey,
    notificarMision: (mission, message) => events.push({ missionId: mission.id, message })
};
const createWithSeed = new Function('MISSION_TASKS', 'Math', 'randID',
    `return (${server.slice(
        server.indexOf('    crearMision(player) {'),
        server.indexOf('\n    avanzarMision(', server.indexOf('    crearMision(player) {'))
    ).trim().replace(/^crearMision/, 'function crearMision')});`)(
        tasks,
        deterministicMath,
        () => 'mission-test'
    );
const mission = createWithSeed.call(room, owner);
assert.equal(mission.tasks.length, 10, 'every accepted mission contains exactly ten checklist tasks');
assert.equal(new Set(mission.tasks.map((task) => task.id)).size, 10,
    'one checklist never repeats a task');
assert.equal(mission.teamId, 'A', 'team-mode missions are scoped to the assigned team');
room.activeMissions['team:A'] = mission;

const advanceWithSeed = new Function('MISSION_TASK_REWARD',
    `return (${server.slice(
        server.indexOf('    avanzarMision(player, taskId, amount = 1) {'),
        server.indexOf('\n    soltarMision(', server.indexOf('    avanzarMision(player, taskId, amount = 1) {'))
    ).trim().replace(/^avanzarMision/, 'function avanzarMision')});`)(70);
mission.tasks.forEach((task) => {
    advanceWithSeed.call(room, teammate, task.id, task.target);
});
assert.equal(mission.completedCount, 10, 'team members can advance the shared checklist');
assert.equal(mission.completed, true, 'the mission completes after its tenth task');
assert.equal(teammate.charge, 700, 'ten tasks award exactly 700 unsecured points to the contributors');
assert.equal(owner.charge, 0, 'shared team progress does not duplicate the same points to every member');
assert.ok(events.some(({ message }) => message.includes('¡Misión completada!')),
    'finishing all ten checklist tasks produces a completion notice');
assert.match(server, /mission\.teamId[\s\S]*?¡Misión secundaria del equipo iniciada!/,
    'starting a team mission produces a team-facing notice');

assert.match(server, /this\.registrarObstaculoDestruido\(obs, ownerId\)/,
    'explosive obstacles and their chains can drop missions');
assert.match(server, /this\.registrarObstaculoDestruido\(obs, bomb\.ownerId\)/,
    'bomb-destroyed non-explosive obstacles can drop missions too');
assert.match(server, /this\.soltarMision\(wl\.x \+ wl\.w \/ 2, wl\.y \+ wl\.h \/ 2, b\.ownerId\)/,
    'destroyed walls can drop missions at their location');
assert.match(server, /drop\.ownerId !== player\.id/,
    'only the player who destroyed the cover can claim its mission drop');
assert.match(server, /this\.mode === 'teams' && player\.teamId[\s\S]*?team:\$\{player\.teamId\}/,
    'team members share a single active checklist');
assert.match(server, /bankMatchOrbs\(p\);[\s\S]*?this\.avanzarMision\(p, 'bank_points', deposited\)/,
    'mission points remain unbanked until the player deposits at the bank');
assert.match(server, /socket\.on\('abandonMission'/,
    'players can abandon an active checklist');
assert.match(game, /id="mission-checklist"[\s\S]*?id="mission-task-list"/,
    'the HUD presents the ten tasks as a visible checklist');
assert.match(game, /mission\.tasks\.forEach\(\(task\) => \{[\s\S]*?mission-task-check/,
    'the checklist reflects completed tasks and their progress');
assert.match(game, /socket\.on\('missionState'[\s\S]*?missionState = state/,
    'the client receives mission checklists and private drops on the dedicated event');
assert.match(game, /missionState\.drops[\s\S]*?drop\.x, drop\.y/,
    'mission drops are rendered from the dedicated state');
assert.doesNotMatch(server.match(/getState\(\) \{[\s\S]*?\n    \}\n\}/)?.[0] || '',
    /missionDrops|activeMissions/,
    'mission details are not duplicated in the high-frequency game state');

console.log('OK missions: 10-task randomized checklist, team sharing, 700 unsecured points and private drops.');
