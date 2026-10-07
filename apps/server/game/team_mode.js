'use strict';

const TEAM_IDS = Object.freeze(['A', 'B']);
const TEAM_SIZE = 5;
const TEAM_START_COUNTDOWN_SECONDS = 30;

function createTeamProfiles() {
    return {
        A: { name: 'Equipo Azul', color: '#38bdf8', leaderId: null },
        B: { name: 'Equipo Rojo', color: '#fb7185', leaderId: null }
    };
}

function teamMemberCounts(players) {
    const counts = { A: 0, B: 0 };
    Object.values(players || {}).forEach((player) => {
        if (player && TEAM_IDS.includes(player.teamId)) counts[player.teamId]++;
    });
    return counts;
}

function isTeamLobbyFull(players) {
    const counts = teamMemberCounts(players);
    return counts.A === TEAM_SIZE && counts.B === TEAM_SIZE;
}

function canForceStartTeams(players) {
    const counts = teamMemberCounts(players);
    return counts.A > 0 && counts.B > 0;
}

function assignBalancedTeam(players, tieTeam = 'A') {
    const counts = teamMemberCounts(players);
    if (counts.A === counts.B) return tieTeam === 'B' ? 'B' : 'A';
    return counts.A < counts.B ? 'A' : 'B';
}

function validateTeamProfile(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const color = typeof input.color === 'string' ? input.color : '';
    if (!/^[\p{L}\p{N} _.-]{1,20}$/u.test(name) || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    return Object.freeze({ name, color: color.toLowerCase() });
}

function selectPlayerTeam(players, profiles, socketId, teamId, locked = false) {
    const player = players && players[socketId];
    if (locked || !player || !TEAM_IDS.includes(teamId)) return false;
    if (player.teamId === teamId) return true;
    if (!profiles || !profiles[teamId] || teamMemberCounts(players)[teamId] >= TEAM_SIZE) return false;

    const previousTeamId = player.teamId;
    player.teamId = teamId;
    if (TEAM_IDS.includes(previousTeamId) && profiles[previousTeamId].leaderId === socketId) {
        const nextLeader = Object.values(players).find((member) => member.teamId === previousTeamId);
        profiles[previousTeamId].leaderId = nextLeader ? nextLeader.id : null;
    }
    if (!profiles[teamId].leaderId) profiles[teamId].leaderId = socketId;
    return true;
}

function updateTeamProfile(players, profiles, socketId, input, locked = false) {
    const player = players && players[socketId];
    if (locked || !player || !TEAM_IDS.includes(player.teamId) ||
        profiles?.[player.teamId]?.leaderId !== socketId) return false;
    const profile = validateTeamProfile(input);
    if (!profile) return false;
    profiles[player.teamId] = { ...profiles[player.teamId], ...profile };
    return true;
}

function serializeTeamState(players, profiles) {
    const counts = teamMemberCounts(players);
    const teams = {};
    for (const teamId of TEAM_IDS) {
        const profile = profiles[teamId];
        teams[teamId] = {
            name: profile.name,
            color: profile.color,
            leaderId: profile.leaderId,
            count: counts[teamId],
            capacity: TEAM_SIZE,
            members: Object.values(players)
                .filter((player) => player.teamId === teamId)
                .map((player) => ({ id: player.id, nick: player.nick }))
        };
    }
    return teams;
}

function rankTeams(players) {
    const teams = new Map();
    Object.values(players || {}).forEach((player) => {
        if (!player || (player.teamId !== 'A' && player.teamId !== 'B')) return;
        let team = teams.get(player.teamId);
        if (!team) {
            team = {
                teamId: player.teamId,
                memberActorIds: [],
                aliveCount: 0,
                bankedScore: 0,
                eliminations: 0
            };
            teams.set(player.teamId, team);
        }
        team.memberActorIds.push(player.id);
        if (!player.isDead) team.aliveCount++;
        team.bankedScore += Math.max(0, Number(player.bankedScore) || 0);
        team.eliminations += Math.max(0, Number(player.eliminations) || 0);
    });
    return [...teams.values()]
        .map((team) => ({
            ...team,
            memberActorIds: team.memberActorIds.sort()
        }))
        .sort((a, b) =>
            b.aliveCount - a.aliveCount ||
            b.bankedScore - a.bankedScore ||
            b.eliminations - a.eliminations ||
            a.teamId.localeCompare(b.teamId));
}

function canDamagePlayer(mode, source, target) {
    return mode !== 'teams' || !source || source.id === target.id ||
        !source.teamId || source.teamId !== target.teamId;
}

function splitPrize(total, participants) {
    if (!Number.isFinite(total) || total < 0 || !Array.isArray(participants) || !participants.length) {
        throw new TypeError('A non-negative prize and at least one participant are required');
    }
    const recipients = [...new Map(participants
        .filter((player) => player && typeof player.uid === 'string' && player.uid.trim())
        .map((player) => [player.uid, player])).values()]
        .sort((a, b) => a.uid.localeCompare(b.uid));
    if (!recipients.length || recipients.length !== participants.length) {
        throw new TypeError('Every prize recipient must have a unique verified UID');
    }

    const cents = Math.round(total * 100);
    const share = Math.floor(cents / recipients.length);
    const remainder = cents % recipients.length;
    return recipients.map((player, index) => ({
        uid: player.uid,
        nick: player.nick,
        amount: (share + (index < remainder ? 1 : 0)) / 100
    }));
}

module.exports = Object.freeze({
    assignBalancedTeam,
    canDamagePlayer,
    canForceStartTeams,
    createTeamProfiles,
    isTeamLobbyFull,
    rankTeams,
    selectPlayerTeam,
    serializeTeamState,
    splitPrize,
    TEAM_START_COUNTDOWN_SECONDS,
    teamMemberCounts,
    updateTeamProfile,
    validateTeamProfile,
    TEAM_SIZE
});
