'use strict';

const assert = require('assert');
const {
    assignBalancedTeam,
    canForceStartTeams,
    canDamagePlayer,
    createTeamProfiles,
    isTeamLobbyFull,
    rankTeams,
    selectPlayerTeam,
    serializeTeamState,
    splitPrize,
    teamMemberCounts,
    TEAM_START_COUNTDOWN_SECONDS,
    validateTeamProfile,
    updateTeamProfile,
    TEAM_SIZE
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
assert.deepStrictEqual(teamMemberCounts(balanced), { A: 5, B: 5 });
assert.strictEqual(isTeamLobbyFull(balanced), true);
assert.strictEqual(isTeamLobbyFull({ ...balanced, p10: { teamId: 'A' } }), false);
assert.strictEqual(canForceStartTeams(balanced), true);
assert.strictEqual(canForceStartTeams({ a: { teamId: 'A' } }), false);
assert.strictEqual(canForceStartTeams({ a: { teamId: 'A' }, b: { teamId: 'B' } }), true);
assert.strictEqual(TEAM_SIZE, 5);
assert.strictEqual(TEAM_START_COUNTDOWN_SECONDS, 30);
const fullProfiles = createTeamProfiles();
fullProfiles.A.leaderId = 'p0';
fullProfiles.B.leaderId = 'p1';
assert.strictEqual(selectPlayerTeam(balanced, fullProfiles, 'p0', 'B'), false);
assert.deepStrictEqual(validateTeamProfile({ name: 'Lobos 7', color: '#FF0088' }), {
    name: 'Lobos 7',
    color: '#ff0088'
});
assert.strictEqual(validateTeamProfile({ name: '<script>', color: '#ff0088' }), null);
assert.strictEqual(validateTeamProfile({ name: 'Lobos', color: 'red' }), null);
const selectable = {
    leader: { id: 'leader', teamId: 'A', nick: 'Líder' },
    member: { id: 'member', teamId: 'A', nick: 'Miembro' },
    other: { id: 'other', teamId: 'B', nick: 'Otro' }
};
const profiles = createTeamProfiles();
profiles.A.leaderId = 'leader';
profiles.B.leaderId = 'other';
assert.strictEqual(selectPlayerTeam(selectable, profiles, 'leader', 'B'), true);
assert.strictEqual(profiles.A.leaderId, 'member');
assert.strictEqual(profiles.B.leaderId, 'other');
assert.strictEqual(selectPlayerTeam(selectable, profiles, 'leader', 'A', true), false);
assert.strictEqual(updateTeamProfile(selectable, profiles, 'other', {
    name: 'Lobos',
    color: '#123abc'
}), true);
assert.strictEqual(updateTeamProfile(selectable, profiles, 'leader', {
    name: 'No soy líder',
    color: '#123abc'
}), false);
assert.strictEqual(updateTeamProfile(selectable, profiles, 'other', {
    name: 'Bloqueado',
    color: '#123abc'
}, true), false);
assert.deepStrictEqual(serializeTeamState(selectable, profiles).B.members.map((member) => member.nick), [
    'Líder', 'Otro'
]);
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
