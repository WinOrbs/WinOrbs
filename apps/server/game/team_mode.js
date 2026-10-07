'use strict';

function assignBalancedTeam(players, tieTeam = 'A') {
    const counts = { A: 0, B: 0 };
    Object.values(players || {}).forEach((player) => {
        if (player && (player.teamId === 'A' || player.teamId === 'B')) {
            counts[player.teamId]++;
        }
    });
    if (counts.A === counts.B) return tieTeam === 'B' ? 'B' : 'A';
    return counts.A < counts.B ? 'A' : 'B';
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
    rankTeams,
    splitPrize
});
