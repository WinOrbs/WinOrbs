'use strict';

function segmentIntersectsRect(x1, y1, x2, y2, rect, margin = 0) {
    const minX = rect.x - margin;
    const minY = rect.y - margin;
    const maxX = rect.x + rect.w + margin;
    const maxY = rect.y + rect.h + margin;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let enter = 0;
    let exit = 1;

    for (const [origin, delta, min, max] of [
        [x1, dx, minX, maxX],
        [y1, dy, minY, maxY]
    ]) {
        if (Math.abs(delta) < 1e-9) {
            if (origin < min || origin > max) return false;
            continue;
        }
        const first = (min - origin) / delta;
        const second = (max - origin) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return false;
    }
    return exit >= 0 && enter <= 1;
}

function hasClearPath(from, to, obstacles, margin = 0) {
    return !obstacles.some((rect) => segmentIntersectsRect(
        from.x, from.y, to.x, to.y, rect, margin
    ));
}

function createMinHeap() {
    const values = [];
    return {
        get size() { return values.length; },
        push(item) {
            let index = values.length;
            values.push(item);
            while (index > 0) {
                const parent = Math.floor((index - 1) / 2);
                if (values[parent].priority <= item.priority) break;
                values[index] = values[parent];
                index = parent;
            }
            values[index] = item;
        },
        pop() {
            if (values.length === 0) return null;
            const first = values[0];
            const last = values.pop();
            if (values.length > 0) {
                let index = 0;
                while (true) {
                    const left = index * 2 + 1;
                    const right = left + 1;
                    if (left >= values.length) break;
                    const child = right < values.length &&
                        values[right].priority < values[left].priority ? right : left;
                    if (values[child].priority >= last.priority) break;
                    values[index] = values[child];
                    index = child;
                }
                values[index] = last;
            }
            return first;
        }
    };
}

function findNearestOpenCell(point, blocked, columns, rows, cellSize, maxRadius) {
    const originX = Math.max(0, Math.min(columns - 1, Math.floor(point.x / cellSize)));
    const originY = Math.max(0, Math.min(rows - 1, Math.floor(point.y / cellSize)));
    let best = null;
    let bestDistance = Infinity;

    for (let radius = 0; radius <= maxRadius; radius++) {
        for (let y = Math.max(0, originY - radius); y <= Math.min(rows - 1, originY + radius); y++) {
            for (let x = Math.max(0, originX - radius); x <= Math.min(columns - 1, originX + radius); x++) {
                if (Math.max(Math.abs(x - originX), Math.abs(y - originY)) !== radius) continue;
                const index = y * columns + x;
                if (blocked[index]) continue;
                const centerX = (x + 0.5) * cellSize;
                const centerY = (y + 0.5) * cellSize;
                const distance = (centerX - point.x) ** 2 + (centerY - point.y) ** 2;
                if (distance < bestDistance) {
                    best = index;
                    bestDistance = distance;
                }
            }
        }
        if (best !== null) return best;
    }
    return null;
}

function findPathWaypoint(start, goal, obstacles, mapSize = 5000, cellSize = 100, radius = 26) {
    if (hasClearPath(start, goal, obstacles, radius)) return { x: goal.x, y: goal.y };

    const columns = Math.ceil(mapSize / cellSize);
    const rows = columns;
    const blocked = new Uint8Array(columns * rows);
    for (const rect of obstacles) {
        const minX = Math.max(0, Math.floor((rect.x - radius) / cellSize));
        const minY = Math.max(0, Math.floor((rect.y - radius) / cellSize));
        const maxX = Math.min(columns - 1, Math.floor((rect.x + rect.w + radius) / cellSize));
        const maxY = Math.min(rows - 1, Math.floor((rect.y + rect.h + radius) / cellSize));
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const left = x * cellSize;
                const top = y * cellSize;
                if (left + cellSize >= rect.x - radius && left <= rect.x + rect.w + radius &&
                    top + cellSize >= rect.y - radius && top <= rect.y + rect.h + radius) {
                    blocked[y * columns + x] = 1;
                }
            }
        }
    }

    const startIndex = findNearestOpenCell(start, blocked, columns, rows, cellSize, 4);
    const goalIndex = findNearestOpenCell(goal, blocked, columns, rows, cellSize, 8);
    if (startIndex === null || goalIndex === null) return { x: goal.x, y: goal.y };
    if (startIndex === goalIndex) return { x: goal.x, y: goal.y };

    const count = columns * rows;
    const costs = new Float64Array(count);
    costs.fill(Infinity);
    const parents = new Int32Array(count);
    parents.fill(-1);
    const closed = new Uint8Array(count);
    const heap = createMinHeap();
    const goalX = goalIndex % columns;
    const goalY = Math.floor(goalIndex / columns);
    const heuristic = (x, y) => {
        const dx = Math.abs(goalX - x);
        const dy = Math.abs(goalY - y);
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    costs[startIndex] = 0;
    heap.push({ index: startIndex, priority: heuristic(startIndex % columns, Math.floor(startIndex / columns)) });
    let closestIndex = startIndex;
    let closestHeuristic = heuristic(startIndex % columns, Math.floor(startIndex / columns));

    while (heap.size > 0) {
        const current = heap.pop();
        const index = current.index;
        if (closed[index]) continue;
        if (index === goalIndex) {
            closestIndex = index;
            break;
        }
        closed[index] = 1;
        const x = index % columns;
        const y = Math.floor(index / columns);
        const remaining = heuristic(x, y);
        if (remaining < closestHeuristic) {
            closestHeuristic = remaining;
            closestIndex = index;
        }

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nextX = x + dx;
                const nextY = y + dy;
                if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) continue;
                const nextIndex = nextY * columns + nextX;
                if (blocked[nextIndex] || closed[nextIndex]) continue;
                if (dx !== 0 && dy !== 0 &&
                    (blocked[y * columns + nextX] || blocked[nextY * columns + x])) continue;
                const nextCost = costs[index] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
                if (nextCost >= costs[nextIndex]) continue;
                costs[nextIndex] = nextCost;
                parents[nextIndex] = index;
                heap.push({ index: nextIndex, priority: nextCost + heuristic(nextX, nextY) });
            }
        }
    }

    const path = [];
    for (let index = closestIndex; index !== -1; index = parents[index]) {
        path.push({
            x: ((index % columns) + 0.5) * cellSize,
            y: (Math.floor(index / columns) + 0.5) * cellSize
        });
        if (index === startIndex) break;
    }
    path.reverse();
    for (let index = path.length - 1; index >= 0; index--) {
        if (hasClearPath(start, path[index], obstacles, radius)) return path[index];
    }
    return path[1] || { x: goal.x, y: goal.y };
}

function getInterceptAngle(shooter, target, targetVelocity, projectileSpeed, maxTicks) {
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const vx = targetVelocity.x;
    const vy = targetVelocity.y;
    const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    const discriminant = b * b - 4 * a * c;
    let ticks = 0;

    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) > 1e-9) ticks = -c / b;
    } else if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
            .filter((value) => value > 0);
        if (candidates.length > 0) ticks = Math.min(...candidates);
    }

    ticks = Math.min(maxTicks, Math.max(0, ticks));
    return Math.atan2(dy + vy * ticks, dx + vx * ticks);
}

module.exports = {
    findPathWaypoint,
    getInterceptAngle,
    hasClearPath,
    segmentIntersectsRect
};
