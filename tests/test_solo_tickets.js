'use strict';

const assert = require('assert');
const {
    SOLO_WINS_PER_TICKET,
    isEligibleSoloTicketRoom,
    recordSoloVictory,
    redeemSoloTicket,
    refundSoloTicket,
    entryReceiptId,
    isEligibleSoloWinner,
    soloTicketProgress
} = require('../apps/server/platform/solo_tickets');

class MemoryFirestore {
    constructor() {
        this.documents = new Map();
    }

    collection(name) {
        return {
            doc: (id) => ({ path: `${name}/${id}`, id })
        };
    }

    async runTransaction(callback) {
        const writes = [];
        const transaction = {
            get: async (ref) => {
                const data = this.documents.get(ref.path);
                return {
                    exists: data !== undefined,
                    data: () => data && { ...data }
                };
            },
            update: (ref, value) => writes.push({ operation: 'update', ref, value }),
            set: (ref, value) => writes.push({ operation: 'set', ref, value }),
            create: (ref, value) => writes.push({ operation: 'create', ref, value })
        };
        const result = await callback(transaction);
        for (const write of writes) {
            if (write.operation === 'create' && this.documents.has(write.ref.path)) {
                throw new Error('ALREADY_EXISTS');
            }
            if (write.operation === 'update' && !this.documents.has(write.ref.path)) {
                throw new Error('NOT_FOUND');
            }
            const current = this.documents.get(write.ref.path) || {};
            if (write.operation === 'update') {
                this.documents.set(write.ref.path, { ...current, ...write.value });
            } else {
                this.documents.set(write.ref.path, { ...write.value });
            }
        }
        return result;
    }

    seed(collection, id, value) {
        this.documents.set(`${collection}/${id}`, { ...value });
    }

    read(collection, id) {
        return this.documents.get(`${collection}/${id}`);
    }
}

async function run() {
    assert.strictEqual(SOLO_WINS_PER_TICKET, 10);
    assert.deepStrictEqual(soloTicketProgress({
        soloWins: 23,
        soloTickets: 2
    }), { wins: 23, winsTowardTicket: 3, tickets: 2 });
    assert.deepStrictEqual(soloTicketProgress({
        soloWins: -1,
        soloTickets: 1.5
    }), { wins: 0, winsTowardTicket: 0, tickets: 0 });

    const lowestRoom = {
        id: 'p05_1',
        mode: 'ffa',
        entryFee: 0.5,
        isPrivate: false,
        isPractice: false
    };
    assert.strictEqual(isEligibleSoloTicketRoom(lowestRoom, 0.5), true);
    assert.strictEqual(isEligibleSoloTicketRoom({ ...lowestRoom, mode: 'teams' }, 0.5), false);
    assert.strictEqual(isEligibleSoloTicketRoom({ ...lowestRoom, isPrivate: true }, 0.5), false);
    assert.strictEqual(isEligibleSoloTicketRoom({ ...lowestRoom, isPractice: true }, 0.5), false);
    assert.strictEqual(isEligibleSoloTicketRoom({ ...lowestRoom, entryFee: 1 }, 0.5), false);
    assert.strictEqual(isEligibleSoloWinner({
        isPractice: true,
        abandoned: false,
        uid: 'player-1',
        verifiedAccount: true
    }), true);
    assert.strictEqual(isEligibleSoloWinner({
        isPractice: true,
        abandoned: false,
        uid: 'anonymous-1',
        verifiedAccount: false
    }), false);
    assert.strictEqual(isEligibleSoloWinner({
        isPractice: true,
        abandoned: true,
        uid: 'player-1',
        verifiedAccount: true
    }), false);
    assert.notStrictEqual(
        entryReceiptId('player-1', { ...lowestRoom, entryCycleId: 'cycle-1' }),
        entryReceiptId('player-1', { ...lowestRoom, entryCycleId: 'cycle-2' })
    );

    const firestore = new MemoryFirestore();
    firestore.seed('usuarios', 'player-1', { saldo: 3, soloWins: 9, soloTickets: 0 });
    const firstWin = await recordSoloVictory({
        firestore,
        uid: 'player-1',
        practiceId: 'practice-1',
        timestamp: 1
    });
    assert.strictEqual(firstWin.ok, true);
    assert.strictEqual(firstWin.credited, true);
    assert.strictEqual(firstWin.wins, 10);
    assert.strictEqual(firstWin.winsTowardTicket, 0);
    assert.strictEqual(firstWin.tickets, 1);
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 1);
    for (let wins = 11; wins <= 23; wins++) {
        await recordSoloVictory({
            firestore,
            uid: 'player-1',
            practiceId: `practice-${wins}`,
            timestamp: wins
        });
    }
    assert.deepStrictEqual(soloTicketProgress(firestore.read('usuarios', 'player-1')), {
        wins: 23,
        winsTowardTicket: 3,
        tickets: 2
    });

    const repeatedWin = await recordSoloVictory({
        firestore,
        uid: 'player-1',
        practiceId: 'practice-1',
        timestamp: 2
    });
    assert.strictEqual(repeatedWin.credited, false);
    assert.strictEqual(repeatedWin.duplicate, true);
    assert.strictEqual(repeatedWin.wins, 23);

    const notAWin = await recordSoloVictory({
        firestore,
        uid: 'unregistered',
        practiceId: 'practice-2',
        timestamp: 3
    });
    assert.deepStrictEqual(notAWin, { ok: false, error: 'NO_PROFILE' });

    const notEligible = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: { ...lowestRoom, mode: 'teams' },
        minimumFfaEntryFee: 0.5,
        timestamp: 4
    });
    assert.deepStrictEqual(notEligible, { ok: true, ticketUsed: false });
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 2);

    const redeemed = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: lowestRoom,
        minimumFfaEntryFee: 0.5,
        timestamp: 5
    });
    assert.strictEqual(redeemed.ok, true);
    assert.strictEqual(redeemed.ticketUsed, true);
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 1);
    assert.strictEqual(firestore.read('usuarios', 'player-1').saldo, 3);

    const repeatRedemption = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: lowestRoom,
        minimumFfaEntryFee: 0.5,
        timestamp: 6
    });
    assert.strictEqual(repeatRedemption.ticketUsed, true);
    assert.strictEqual(repeatRedemption.alreadyPaid, true);
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 1);

    const refund = await refundSoloTicket({
        firestore,
        uid: 'player-1',
        entradasId: redeemed.entradasId,
        timestamp: 7
    });
    assert.deepStrictEqual(refund, { ok: true, refunded: true, tickets: 2 });
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 2);
    assert.deepStrictEqual(await refundSoloTicket({
        firestore,
        uid: 'player-1',
        entradasId: redeemed.entradasId,
        timestamp: 8
    }), { ok: true, refunded: false });
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 2);

    const nextCycle = { ...lowestRoom, entryCycleId: 'cycle-2' };
    const nextCycleRedemption = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: nextCycle,
        minimumFfaEntryFee: 0.5,
        timestamp: 9
    });
    assert.strictEqual(nextCycleRedemption.ticketUsed, true);
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 1);
    const secondTicketRedemption = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: { ...lowestRoom, entryCycleId: 'cycle-3' },
        minimumFfaEntryFee: 0.5,
        timestamp: 10
    });
    assert.strictEqual(secondTicketRedemption.ticketUsed, true);
    assert.strictEqual(firestore.read('usuarios', 'player-1').soloTickets, 0);
    const laterCycleWithoutTicket = await redeemSoloTicket({
        firestore,
        uid: 'player-1',
        room: { ...lowestRoom, entryCycleId: 'cycle-4' },
        minimumFfaEntryFee: 0.5,
        timestamp: 11
    });
    assert.deepStrictEqual(laterCycleWithoutTicket, { ok: true, ticketUsed: false });

    console.log('OK solo tickets: server wins are idempotent, tickets accumulate and redeem only for eligible FFA rooms.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
