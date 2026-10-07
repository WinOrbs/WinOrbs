'use strict';

const assert = require('assert');
const {
    assignBalancedTeam,
    canDamagePlayer,
    rankTeams,
    splitPrize
} = require('../apps/server/game/team_mode');

const players = {};
assert.strictEqual(assignBalancedTeam(players), 'A');
players.a = { id: 'a', teamId: 'A', isDead: false, bankedScore: 10, eliminations: 1 };
assert.strictEqual(assignBalancedTeam(players), 'B');
players.b = { id: 'b', teamId: 'B', isDead: false, bankedScore: 20, eliminations: 0 };
assert.strictEqual(assignBalancedTeam(players, 'B'), 'B');
assert.strictEqual(canDamagePlayer('teams', { id: 'a', teamId: 'A' }, { id: 'a2', teamId: 'A' }), false);
assert.strictEqual(canDamagePlayer('teams', { id: 'a', teamId: 'A' }, { id: 'b', teamId: 'B' }), true);
assert.strictEqual(canDamagePlayer('teams', { id: 'a', teamId: 'A' }, { id: 'a', teamId: 'A' }), true);
assert.strictEqual(canDamagePlayer('ffa', { id: 'a', teamId: 'A' }, { id: 'a2', teamId: 'A' }), true);
const balanced = {};
let tieTeam = 'A';
for (let index = 0; index < 10; index++) {
    const teamId = assignBalancedTeam(balanced, tieTeam);
    balanced[`p${index}`] = { teamId };
    tieTeam = teamId === 'A' ? 'B' : 'A';
    const sizes = ['A', 'B'].map((id) => Object.values(balanced).filter((p) => p.teamId === id).length);
    assert.ok(Math.abs(sizes[0] - sizes[1]) <= 1);
}
assert.deepStrictEqual(
    ['A', 'B'].map((id) => Object.values(balanced).filter((p) => p.teamId === id).length),
    [5, 5]
);
players.a2 = { id: 'a2', teamId: 'A', isDead: true, bankedScore: 30, eliminations: 2 };

assert.deepStrictEqual(
    rankTeams(players).map(({ teamId, aliveCount }) => [teamId, aliveCount]),
    [['A', 1], ['B', 1]]
);
assert.deepStrictEqual(
    splitPrize(10, [
        { uid: 'c', nick: 'C' },
        { uid: 'a', nick: 'A' },
        { uid: 'b', nick: 'B' }
    ]).map(({ uid, amount }) => [uid, amount]),
    [['a', 3.34], ['b', 3.33], ['c', 3.33]]
);
assert.throws(() => splitPrize(1, [{ nick: 'Guest' }]), /verified UID/);

console.log('OK team mode: balanced assignment, standings and exact cent-based prize split.');
