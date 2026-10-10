'use strict';

const assert = require('node:assert/strict');
const { calculateAimAngle, findPath, hasLineOfSight } = require('../apps/server/game/bot_navigation');

const wall = { x: 220, y: 100, w: 40, h: 300, hp: 30 };
const start = { x: 150, y: 250 };
const goal = { x: 400, y: 250 };
const route = findPath(start, goal, [wall], 500, 22, 40);

assert.ok(Array.isArray(route) && route.length > 1, 'route goes around a blocking wall');
assert.ok(route.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    'route contains valid waypoint coordinates');
let previous = start;
for (const point of route) {
    assert.equal(hasLineOfSight(previous, point, [wall]), true,
        'smoothed route segments do not pass through solids');
    previous = point;
}
assert.equal(route.at(-1).x, goal.x, 'route ends at the requested x coordinate');
assert.equal(route.at(-1).y, goal.y, 'route ends at the requested y coordinate');

const fullBarrier = { x: 220, y: 0, w: 40, h: 500, hp: 30 };
assert.equal(findPath(start, goal, [fullBarrier], 500, 22, 40), null,
    'route reports unreachable goals instead of returning an invalid path');

assert.deepEqual(findPath(start, goal, [{ ...wall, hp: 0 }], 500, 22, 40), [goal],
    'destroyed obstacles no longer block bot routes');
assert.equal(hasLineOfSight(start, goal, [wall]), false,
    'solid cover blocks line of sight');
assert.equal(hasLineOfSight(start, { x: 200, y: 250 }, [wall]), true,
    'clear shots retain line of sight');

const bot = { id: 'bot', x: 100, y: 100, botObservedTargets: Object.create(null) };
const target = { id: 'player', x: 300, y: 100 };
const originalRandom = Math.random;
Math.random = () => 0.5;
try {
    const initialAim = calculateAimAngle(bot, target, 1000, 18, 'hunter');
    target.y = 120;
    const predictedAim = calculateAimAngle(bot, target, 1100, 18, 'hunter');
    assert.equal(Math.abs(initialAim) < 1e-9, true, 'stationary targets are aimed at directly');
    assert.ok(predictedAim > Math.atan2(target.y - bot.y, target.x - bot.x),
        'moving targets are led using their recent velocity');
} finally {
    Math.random = originalRandom;
}

console.log('OK bot navigation: obstacle routing, unreachable paths, line of sight, and predictive aim.');
