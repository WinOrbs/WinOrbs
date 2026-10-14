'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const serverSource = fs.readFileSync('server.js', 'utf8');
const gameSource = fs.readFileSync('public/game.html', 'utf8');
const {
    TROPHY_DEFINITIONS,
    getGlobalTrophyRecords,
    updateGlobalTrophyRecord
} = require('../apps/server/game/trophy_records');

function createFirestoreMock() {
    let document = null;
    const reference = {
        get: async () => ({
            exists: !!document,
            data: () => document
        })
    };
    const firestore = {
        collection(name) {
            assert.equal(name, 'trofeosGlobales');
            return {
                doc(id) {
                    assert.equal(id, 'records');
                    return reference;
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get: async () => ({
                    exists: !!document,
                    data: () => document
                }),
                set: (ref, value) => {
                    assert.equal(ref, reference);
                    document = {
                        ...document,
                        ...value,
                        records: { ...(document?.records || {}), ...value.records }
                    };
                }
            });
        }
    };
    return { firestore, readDocument: () => document };
}

async function main() {
    assert.deepEqual(
        TROPHY_DEFINITIONS.map(({ id, threshold }) => [id, threshold]),
        [
            ['kill_streak', 10],
            ['multikill', 3],
            ['explosion_chain', 5]
        ],
        'the trophy room exposes the agreed epic-record thresholds'
    );

    const { firestore, readDocument } = createFirestoreMock();
    const initialRecords = await getGlobalTrophyRecords(firestore);
    assert.equal(initialRecords.length, 3);
    assert.ok(initialRecords.every((trophy) => trophy.record === null));

    await assert.rejects(
        () => updateGlobalTrophyRecord(firestore, {
            achievementId: 'kill_streak',
            value: 9,
            uid: 'user-1',
            nick: 'Jugador'
        }),
        /valid trophy record/
    );
    assert.equal(readDocument(), null, 'below-threshold values are rejected without a write');

    const first = await updateGlobalTrophyRecord(firestore, {
        achievementId: 'kill_streak',
        value: 10,
        uid: 'user-1',
        nick: '<Campeón>',
        achievedAt: 1234
    });
    assert.equal(first.updated, true);
    assert.deepEqual(first.record, {
        value: 10,
        holderName: 'Campeón',
        achievedAt: 1234
    });

    const tied = await updateGlobalTrophyRecord(firestore, {
        achievementId: 'kill_streak',
        value: 10,
        uid: 'user-2',
        nick: 'Empate'
    });
    assert.equal(tied.updated, false, 'ties preserve the existing trophy holder');

    const surpassed = await updateGlobalTrophyRecord(firestore, {
        achievementId: 'kill_streak',
        value: 11,
        uid: 'user-2',
        nick: 'Nuevo récord'
    });
    assert.equal(surpassed.updated, true);
    assert.equal(surpassed.record.value, 11);
    assert.equal(surpassed.record.holderName, 'Nuevo récord');

    await updateGlobalTrophyRecord(firestore, {
        achievementId: 'multikill',
        value: 3,
        uid: 'user-3',
        nick: 'Ráfaga'
    });
    const board = await getGlobalTrophyRecords(firestore);
    assert.equal(board.find((trophy) => trophy.id === 'multikill').record.value, 3);
    assert.equal(board.find((trophy) => trophy.id === 'explosion_chain').record, null);
    assert.ok(board.every((trophy) => !Object.hasOwn(trophy.record || {}, 'holderUid')),
        'public trophy records do not expose account IDs');

    assert.match(serverSource, /this\.isPractice[\s\S]*?humanPlayers\.length < 2/,
        'practice and solo rooms cannot establish global records');
    assert.match(serverSource, /!player\.verifiedAccount/,
        'only signed-in accounts can become persistent trophy holders');
    assert.match(serverSource, /killer\.isBot \|\| victim\.isBot/,
        'bot eliminations do not contribute to kill-based records');
    assert.match(serverSource, /p\.humanKillStreak = 0/,
        'a death resets the consecutive elimination streak');
    assert.match(gameSource, /id="trophy-room-dialog"[\s\S]*?id="trophy-record-list"/,
        'the game exposes a dedicated trophy room');

    console.log('OK trophy records: thresholds, persistent holders, eligibility and public privacy.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
