'use strict';

const DEFAULT_CELL_SIZE = 80;
const DIRECTIONS = [
    [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
    [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]
];

function pointIsClear(point, solids, clearance, mapSize) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < clearance || point.y < clearance ||
        point.x > mapSize - clearance || point.y > mapSize - clearance) return false;

    const clearanceSquared = clearance * clearance;
    for (const solid of solids) {
        if (!solid || solid.hp <= 0) continue;
        const nearestX = Math.max(solid.x, Math.min(point.x, solid.x + solid.w));
        const nearestY = Math.max(solid.y, Math.min(point.y, solid.y + solid.h));
        const dx = point.x - nearestX;
        const dy = point.y - nearestY;
        if (dx * dx + dy * dy < clearanceSquared) return false;
    }
    return true;
}

function hasLineOfSight(from, to, solids) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (const solid of solids) {
        if (!solid || solid.hp <= 0) continue;
        let tMin = 0;
        let tMax = 1;
        for (const [origin, delta, min, max] of [
            [from.x, dx, solid.x, solid.x + solid.w],
            [from.y, dy, solid.y, solid.y + solid.h]
        ]) {
            if (Math.abs(delta) < 1e-9) {
                if (origin < min || origin > max) {
                    tMin = 2;
                    break;
                }
                continue;
            }
            let near = (min - origin) / delta;
            let far = (max - origin) / delta;
            if (near > far) [near, far] = [far, near];
            tMin = Math.max(tMin, near);
            tMax = Math.min(tMax, far);
            if (tMin > tMax) break;
        }
        if (tMin <= tMax && tMax >= 0 && tMin <= 1) return false;
    }
    return true;
}

function createMinHeap() {
    const values = [];
    return {
        push(item) {
            values.push(item);
            let index = values.length - 1;
            while (index > 0) {
                const parent = (index - 1) >> 1;
                if (values[parent].score <= item.score) break;
                values[index] = values[parent];
                index = parent;
            }
            values[index] = item;
        },
        pop() {
            if (!values.length) return null;
            const first = values[0];
            const last = values.pop();
            if (values.length) {
                let index = 0;
                while (true) {
                    const left = index * 2 + 1;
                    const right = left + 1;
                    if (left >= values.length) break;
                    const child = right < values.length && values[right].score < values[left].score
                        ? right : left;
                    if (values[child].score >= last.score) break;
                    values[index] = values[child];
                    index = child;
                }
                values[index] = last;
            }
            return first;
        },
        get size() {
            return values.length;
        }
    };
}

function findPath(start, goal, solids, mapSize, radius, cellSize = DEFAULT_CELL_SIZE, walkableCache) {
    if (!start || !goal || !Array.isArray(solids) ||
        !Number.isFinite(mapSize) || !Number.isFinite(radius) ||
        !Number.isFinite(cellSize) || cellSize <= 0) return null;

    const clearance = radius + 2;
    const columns = Math.ceil(mapSize / cellSize);
    const rows = columns;
    const total = columns * rows;
    const center = (x, y) => ({
        x: Math.min(mapSize - clearance, (x + 0.5) * cellSize),
        y: Math.min(mapSize - clearance, (y + 0.5) * cellSize)
    });
    const cellId = (x, y) => y * columns + x;
    const cellOf = (point) => ({
        x: Math.max(0, Math.min(columns - 1, Math.floor(point.x / cellSize))),
        y: Math.max(0, Math.min(rows - 1, Math.floor(point.y / cellSize)))
    });
    const walkable = walkableCache || new Uint8Array(total);
    if (!walkableCache) {
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                walkable[cellId(x, y)] = pointIsClear(center(x, y), solids, clearance, mapSize) ? 1 : 0;
            }
        }
    }

    const nearestWalkable = (point, excludedId = -1) => {
        const origin = cellOf(point);
        const maxRadius = Math.max(columns, rows);
        for (let distance = 0; distance <= maxRadius; distance++) {
            let best = null;
            let bestDistance = Infinity;
            for (let y = Math.max(0, origin.y - distance); y <= Math.min(rows - 1, origin.y + distance); y++) {
                for (let x = Math.max(0, origin.x - distance); x <= Math.min(columns - 1, origin.x + distance); x++) {
                    const id = cellId(x, y);
                    if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== distance ||
                        id === excludedId || !walkable[id]) continue;
                    const candidate = center(x, y);
                    const candidateDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
                    if (candidateDistance < bestDistance) {
                        best = { x, y };
                        bestDistance = candidateDistance;
                    }
                }
            }
            if (best) return best;
        }
        return null;
    };

    if (pointIsClear(start, solids, clearance, mapSize) &&
        pointIsClear(goal, solids, clearance, mapSize) &&
        hasLineOfSight(start, goal, solids) &&
        lineClearForPlayer(start, goal, solids, clearance, mapSize)) {
        return [{ x: goal.x, y: goal.y }];
    }

    const startCell = nearestWalkable(start);
    let goalCell = nearestWalkable(goal);
    if (!startCell || !goalCell) return null;
    const startId = cellId(startCell.x, startCell.y);
    let goalId = cellId(goalCell.x, goalCell.y);
    if (startId === goalId) {
        goalCell = nearestWalkable(goal, startId);
        if (!goalCell) return null;
        goalId = cellId(goalCell.x, goalCell.y);
    }

    const gScore = new Float64Array(total);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(total);
    cameFrom.fill(-1);
    const closed = new Uint8Array(total);
    const heuristic = (x, y) => {
        const dx = Math.abs(goalCell.x - x);
        const dy = Math.abs(goalCell.y - y);
        return 14 * Math.min(dx, dy) + 10 * Math.abs(dx - dy);
    };
    const open = createMinHeap();
    gScore[startId] = 0;
    open.push({ id: startId, x: startCell.x, y: startCell.y, score: heuristic(startCell.x, startCell.y) });

    while (open.size) {
        const current = open.pop();
        if (closed[current.id]) continue;
        if (current.id === goalId) break;
        closed[current.id] = 1;

        for (const [dx, dy, cost] of DIRECTIONS) {
            const x = current.x + dx;
            const y = current.y + dy;
            if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
            const id = cellId(x, y);
            if (!walkable[id] || closed[id]) continue;
            if (dx && dy &&
                (!walkable[cellId(current.x + dx, current.y)] ||
                    !walkable[cellId(current.x, current.y + dy)])) continue;
            const tentative = gScore[current.id] + cost;
            if (tentative >= gScore[id]) continue;
            cameFrom[id] = current.id;
            gScore[id] = tentative;
            open.push({ id, x, y, score: tentative + heuristic(x, y) });
        }
    }

    if (startId !== goalId && cameFrom[goalId] === -1) return null;
    const rawPath = [];
    for (let id = goalId; id !== startId; id = cameFrom[id]) {
        if (id < 0) return null;
        rawPath.push(center(id % columns, Math.floor(id / columns)));
    }
    rawPath.reverse();

    const route = [];
    let anchor = start;
    let index = 0;
    while (index < rawPath.length) {
        let farthest = index;
        for (let candidate = rawPath.length - 1; candidate > index; candidate--) {
            if (hasLineOfSight(anchor, rawPath[candidate], solids) &&
                lineClearForPlayer(anchor, rawPath[candidate], solids, clearance, mapSize)) {
                farthest = candidate;
                break;
            }
        }
        route.push(rawPath[farthest]);
        anchor = rawPath[farthest];
        index = farthest + 1;
    }

    if (pointIsClear(goal, solids, clearance, mapSize) &&
        lineClearForPlayer(anchor, goal, solids, clearance, mapSize)) {
        route.push({ x: goal.x, y: goal.y });
    }
    return route;
}

function lineClearForPlayer(from, to, solids, clearance, mapSize) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / 16));
    const minX = Math.min(from.x, to.x) - clearance;
    const maxX = Math.max(from.x, to.x) + clearance;
    const minY = Math.min(from.y, to.y) - clearance;
    const maxY = Math.max(from.y, to.y) + clearance;
    const relevantSolids = solids.filter((solid) => solid && solid.hp > 0 &&
        solid.x <= maxX && solid.x + solid.w >= minX &&
        solid.y <= maxY && solid.y + solid.h >= minY);
    for (let step = 1; step <= steps; step++) {
        const progress = step / steps;
        if (!pointIsClear({
            x: from.x + (to.x - from.x) * progress,
            y: from.y + (to.y - from.y) * progress
        }, relevantSolids, clearance, mapSize)) return false;
    }
    return true;
}

function calculateAimAngle(bot, target, now, projectileSpeed, personality) {
    if (!bot.botObservedTargets) bot.botObservedTargets = Object.create(null);
    const previous = bot.botObservedTargets[target.id];
    let velocityX = 0;
    let velocityY = 0;
    if (previous) {
        const elapsed = (now - previous.at) / 1000;
        if (elapsed >= 0.05) {
            if (elapsed <= 0.5) {
                velocityX = Math.max(-12, Math.min(12, (target.x - previous.x) / elapsed));
                velocityY = Math.max(-12, Math.min(12, (target.y - previous.y) / elapsed));
            }
            bot.botObservedTargets[target.id] = { x: target.x, y: target.y, at: now };
        }
    } else {
        bot.botObservedTargets[target.id] = { x: target.x, y: target.y, at: now };
    }

    const relX = target.x - bot.x;
    const relY = target.y - bot.y;
    const distance = Math.hypot(relX, relY);
    const a = velocityX * velocityX + velocityY * velocityY - projectileSpeed * projectileSpeed;
    const b = 2 * (relX * velocityX + relY * velocityY);
    const c = distance * distance;
    const discriminant = b * b - 4 * a * c;
    const roots = discriminant >= 0 && Math.abs(a) > 1e-6
        ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]
        : [];
    const interceptTime = Math.max(0, Math.min(0.85,
        roots.filter((time) => time > 0).sort((left, right) => left - right)[0] ||
        distance / projectileSpeed));
    const accuracy = { hunter: 0.65, collector: 1.05, evader: 1.2, skirmisher: 0.8 }[personality] || 0.9;
    const spread = (0.025 + distance / 700 * 0.1) * accuracy;
    return Math.atan2(
        relY + velocityY * interceptTime,
        relX + velocityX * interceptTime
    ) + (Math.random() - 0.5) * spread;
}

function createPathfinder(solids, mapSize, radius, cellSize = DEFAULT_CELL_SIZE) {
    const columns = Math.ceil(mapSize / cellSize);
    const rows = columns;
    const clearance = radius + 2;
    const walkable = new Uint8Array(columns * rows);
    const center = (x, y) => ({
        x: Math.min(mapSize - clearance, (x + 0.5) * cellSize),
        y: Math.min(mapSize - clearance, (y + 0.5) * cellSize)
    });
    walkable.fill(1);
    for (const solid of solids) {
        if (!solid || solid.hp <= 0) continue;
        const minX = Math.max(0, Math.floor((solid.x - clearance) / cellSize) - 1);
        const maxX = Math.min(columns - 1, Math.ceil((solid.x + solid.w + clearance) / cellSize) + 1);
        const minY = Math.max(0, Math.floor((solid.y - clearance) / cellSize) - 1);
        const maxY = Math.min(rows - 1, Math.ceil((solid.y + solid.h + clearance) / cellSize) + 1);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const point = center(x, y);
                const nearestX = Math.max(solid.x, Math.min(point.x, solid.x + solid.w));
                const nearestY = Math.max(solid.y, Math.min(point.y, solid.y + solid.h));
                const dx = point.x - nearestX;
                const dy = point.y - nearestY;
                if (dx * dx + dy * dy < clearance * clearance) {
                    walkable[y * columns + x] = 0;
                }
            }
        }
    }
    return {
        findPath(start, goal) {
            return findPath(start, goal, solids, mapSize, radius, cellSize, walkable);
        }
    };
}

module.exports = { createPathfinder, findPath, hasLineOfSight, calculateAimAngle };
