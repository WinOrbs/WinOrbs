'use strict';

const COLLECTION = 'historialPartidas';
const PAGE_SIZE = 20;

function buildMatchHistoryRecord({
    gameId,
    roomId,
    roomName,
    mode,
    isPractice,
    finishedAt,
    leaderboard
}) {
    const players = Array.isArray(leaderboard) ? leaderboard : [];
    const participantUids = [...new Set(players
        .map((player) => typeof player.uid === 'string' ? player.uid : '')
        .filter(Boolean))];
    if (!gameId || !participantUids.length) return null;

    return {
        gameId: String(gameId),
        roomId: String(roomId || ''),
        roomName: String(roomName || ''),
        mode: String(mode || 'ffa'),
        isPractice: isPractice === true,
        finishedAt: new Date(finishedAt),
        participantUids,
        leaderboard: players.map((player, index) => ({
            playerId: String(player.id || ''),
            nick: String(player.nick || 'Jugador'),
            score: Math.max(0, Number(player.bankedScore) || 0),
            eliminations: Math.max(0, Number(player.eliminations) || 0),
            position: index + 1,
            isBot: player.isBot === true
        }))
    };
}

async function listPlayerMatchHistory(firestore, uid, { cursorId = null } = {}) {
    if (!firestore || typeof uid !== 'string' || !uid) {
        throw new TypeError('Firestore and a verified user ID are required');
    }

    const collection = firestore.collection(COLLECTION);
    let query = collection
        .where('participantUids', 'array-contains', uid)
        .orderBy('finishedAt', 'desc');
    if (cursorId) {
        if (typeof cursorId !== 'string' || cursorId.length > 200 || cursorId.includes('/')) {
            throw new TypeError('Invalid match history cursor');
        }
        const cursor = await collection.doc(cursorId).get();
        const participants = cursor.exists ? cursor.data()?.participantUids : null;
        if (!Array.isArray(participants) || !participants.includes(uid)) {
            throw new TypeError('Invalid match history cursor');
        }
        query = query.startAfter(cursor);
    }

    const snapshot = await query.limit(PAGE_SIZE + 1).get();
    const hasMore = snapshot.docs.length > PAGE_SIZE;
    const docs = snapshot.docs.slice(0, PAGE_SIZE);
    return {
        matches: docs.map((document) => {
            const data = document.data() || {};
            const finishedAt = data.finishedAt?.toDate
                ? data.finishedAt.toDate().getTime()
                : new Date(data.finishedAt).getTime();
            return {
                gameId: String(data.gameId || document.id),
                roomName: String(data.roomName || ''),
                mode: String(data.mode || 'ffa'),
                isPractice: data.isPractice === true,
                finishedAt: Number.isFinite(finishedAt) ? finishedAt : null,
                leaderboard: Array.isArray(data.leaderboard)
                    ? data.leaderboard.map((player, index) => ({
                        nick: String(player.nick || 'Jugador'),
                        score: Math.max(0, Number(player.score) || 0),
                        eliminations: Math.max(0, Number(player.eliminations) || 0),
                        position: Number.isInteger(player.position) ? player.position : index + 1,
                        isBot: player.isBot === true
                    }))
                    : []
            };
        }),
        nextCursor: hasMore ? docs[docs.length - 1].id : null
    };
}

module.exports = Object.freeze({
    COLLECTION,
    PAGE_SIZE,
    buildMatchHistoryRecord,
    listPlayerMatchHistory
});
