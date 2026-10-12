'use strict';

const assert = require('node:assert/strict');
const {
    COLLECTION,
    PAGE_SIZE,
    buildMatchHistoryRecord,
    listPlayerMatchHistory
} = require('../apps/server/game/match_history');

const source = buildMatchHistoryRecord({
    gameId: 'room-1_100',
    roomId: 'room-1',
    roomName: 'Sala de prueba',
    mode: 'ffa',
    isPractice: true,
    finishedAt: 100,
    leaderboard: [
        { id: 'user-socket', uid: 'user-1', nick: 'Jugador', bankedScore: 209, eliminations: 19 },
        { id: 'bot-socket', nick: 'BOT 3', bankedScore: 90, eliminations: 10, isBot: true }
    ]
});
assert.deepEqual(source.participantUids, ['user-1']);
assert.deepEqual(source.leaderboard.map(({ position, nick, score }) => ({ position, nick, score })), [
    { position: 1, nick: 'Jugador', score: 209 },
    { position: 2, nick: 'BOT 3', score: 90 }
]);
assert.equal(source.leaderboard[0].uid, undefined, 'private user IDs are not copied into public leaderboard rows');
assert.equal(buildMatchHistoryRecord({
    gameId: 'guest-only',
    leaderboard: [{ id: 'guest', nick: 'Guest' }]
}), null, 'results without verified accounts are not written to private account history');

function createFirestore(records) {
    const collection = {
        where(field, operator, uid) {
            assert.equal(field, 'participantUids');
            assert.equal(operator, 'array-contains');
            let matching = records.filter((record) => record.data.participantUids.includes(uid));
            const query = {
                orderBy(name, direction) {
                    assert.equal(name, 'finishedAt');
                    assert.equal(direction, 'desc');
                    matching = matching.slice().sort((left, right) =>
                        right.data.finishedAt.getTime() - left.data.finishedAt.getTime() ||
                        left.id.localeCompare(right.id));
                    return query;
                },
                startAfter(cursor) {
                    const index = matching.findIndex((record) => record.id === cursor.id);
                    matching = matching.slice(index + 1);
                    return query;
                },
                limit(count) {
                    query.pageSize = count;
                    return query;
                },
                async get() {
                    const docs = matching.slice(0, query.pageSize).map((record) => ({
                        id: record.id,
                        data: () => record.data
                    }));
                    return { docs };
                }
            };
            return query;
        },
        doc(id) {
            return {
                async get() {
                    const record = records.find((candidate) => candidate.id === id);
                    return record
                        ? { id, exists: true, data: () => record.data }
                        : { id, exists: false, data: () => null };
                }
            };
        }
    };
    return { collection: (name) => {
        assert.equal(name, COLLECTION);
        return collection;
    } };
}

async function run() {
    const records = Array.from({ length: PAGE_SIZE + 3 }, (_, index) => ({
        id: `match-${index}`,
        data: {
            gameId: `match-${index}`,
            roomName: `Sala ${index}`,
            mode: 'ffa',
            isPractice: false,
            finishedAt: new Date(1000 + index),
            participantUids: index === PAGE_SIZE + 2 ? ['another-user'] : ['user-1'],
            leaderboard: [{
                nick: 'Jugador',
                score: index,
                eliminations: 1,
                position: 1
            }]
        }
    }));
    const db = createFirestore(records);
    const first = await listPlayerMatchHistory(db, 'user-1');
    assert.equal(first.matches.length, PAGE_SIZE);
    assert.equal(first.matches[0].gameId, 'match-21');
    assert.equal(first.nextCursor, 'match-2');
    assert.equal(first.matches[0].leaderboard[0].score, 21);
    assert.equal(first.matches[0].participantUids, undefined,
        'response does not disclose other participants account IDs');

    const second = await listPlayerMatchHistory(db, 'user-1', { cursorId: first.nextCursor });
    assert.deepEqual(second.matches.map((match) => match.gameId), ['match-1', 'match-0']);
    assert.equal(second.nextCursor, null);

    await assert.rejects(
        () => listPlayerMatchHistory(db, 'user-1', { cursorId: 'match-22' }),
        { name: 'TypeError' },
        'a cursor from another account cannot be used to page through history'
    );
    console.log('OK match history: verified-account filtering, complete leaderboard snapshots and pagination.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
