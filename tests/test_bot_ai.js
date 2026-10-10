'use strict';

const assert = require('assert');
const {
    findPathWaypoint,
    getInterceptAngle,
    hasClearPath
} = require('../apps/server/game/bot_ai');

const wall = { x: 100, y: 0, w: 100, h: 200 };
assert.strictEqual(hasClearPath({ x: 20, y: 100 }, { x: 280, y: 100 }, [wall]), false);
assert.strictEqual(hasClearPath({ x: 20, y: 240 }, { x: 280, y: 240 }, [wall]), true);
assert.strictEqual(hasClearPath({ x: 20, y: 225 }, { x: 280, y: 225 }, [wall], 30), false);

const start = { x: 20, y: 100 };
const goal = { x: 280, y: 100 };
const waypoint = findPathWaypoint(start, goal, [wall], 400, 40, 10);
assert.notDeepStrictEqual(waypoint, goal);
assert.strictEqual(hasClearPath(start, waypoint, [wall], 10), true);

const directGoal = { x: 350, y: 350 };
assert.deepStrictEqual(
    findPathWaypoint({ x: 20, y: 20 }, directGoal, [], 400),
    directGoal
);

const leadAngle = getInterceptAngle(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 1 },
    10,
    55
);
assert.ok(leadAngle > 0.09 && leadAngle < 0.11);

const unreachableWaypoint = findPathWaypoint(
    { x: 40, y: 100 },
    { x: 360, y: 100 },
    [{ x: 190, y: 0, w: 20, h: 400 }],
    400,
    40,
    10
);
assert.ok(Number.isFinite(unreachableWaypoint.x));
assert.ok(Number.isFinite(unreachableWaypoint.y));

console.log('OK bot AI: pathfinding avoids solids and aim prediction leads moving targets.');
