'use strict';

const crypto = require('crypto');

const SOLO_WINS_PER_TICKET = 10;
const TICKET_PAYMENT_METHOD = 'boleto_solo';

function safeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function soloTicketProgress(profile = {}) {
    const wins = safeCount(profile.soloWins);
    return Object.freeze({
        wins,
        winsTowardTicket: wins % SOLO_WINS_PER_TICKET,
        tickets: safeCount(profile.soloTickets)
    });
}

function isEligibleSoloTicketRoom(room, minimumFfaEntryFee) {
    const fee = Number(room && room.entryFee);
    const minimumFee = Number(minimumFfaEntryFee);
    return !!room &&
        room.mode === 'ffa' &&
        room.isPrivate !== true &&
        room.isPractice !== true &&
        Number.isFinite(fee) &&
        Number.isFinite(minimumFee) &&
        fee > 0 &&
        Math.round(fee * 100) === Math.round(minimumFee * 100);
}

function isEligibleSoloWinner({ isPractice, abandoned, uid, verifiedAccount }) {
    return isPractice === true &&
        abandoned !== true &&
        typeof uid === 'string' &&
        uid.length > 0 &&
        verifiedAccount === true;
}

function soloWinClaimId(uid, practiceId) {
    return crypto.createHash('sha256')
        .update(`${uid}\0${practiceId}`)
        .digest('hex');
}

function entryReceiptId(uid, room) {
    const cycleId = room && (room.entryCycleId || room.id);
    return 'ent_' + crypto.createHash('sha256')
        .update(`${uid}\0${room && room.id}\0${cycleId}`)
        .digest('hex');
}

async function recordSoloVictory({ firestore, uid, practiceId, timestamp }) {
    if (!firestore || typeof uid !== 'string' || !uid ||
        typeof practiceId !== 'string' || !practiceId) {
        return { ok: false, error: 'INVALID_REQUEST' };
    }

    const profileRef = firestore.collection('usuarios').doc(uid);
    const claimRef = firestore.collection('solo_practice_claims')
        .doc(soloWinClaimId(uid, practiceId));
    return firestore.runTransaction(async (transaction) => {
        const [profileSnap, claimSnap] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(claimRef)
        ]);
        if (!profileSnap.exists) return { ok: false, error: 'NO_PROFILE' };

        const profile = profileSnap.data() || {};
        const previous = soloTicketProgress(profile);
        if (claimSnap.exists) {
            return { ok: true, credited: false, duplicate: true, ...previous };
        }

        const wins = previous.wins + 1;
        const tickets = previous.tickets +
            Math.floor(wins / SOLO_WINS_PER_TICKET) -
            Math.floor(previous.wins / SOLO_WINS_PER_TICKET);
        const progress = soloTicketProgress({ soloWins: wins, soloTickets: tickets });
        transaction.update(profileRef, { soloWins: wins, soloTickets: tickets });
        transaction.create(claimRef, {
            uid,
            practiceId,
            createdAt: timestamp
        });
        return { ok: true, credited: true, ...progress };
    });
}

async function redeemSoloTicket({
    firestore,
    uid,
    room,
    minimumFfaEntryFee,
    timestamp
}) {
    if (!firestore || typeof uid !== 'string' || !uid ||
        !room || typeof room.id !== 'string' || !room.id) {
        return { ok: false, error: 'INVALID_REQUEST' };
    }
    if (!isEligibleSoloTicketRoom(room, minimumFfaEntryFee)) {
        return { ok: true, ticketUsed: false };
    }

    const profileRef = firestore.collection('usuarios').doc(uid);
    const entryRef = firestore.collection('entradas').doc(entryReceiptId(uid, room));
    return firestore.runTransaction(async (transaction) => {
        const [profileSnap, entrySnap] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(entryRef)
        ]);
        if (!profileSnap.exists) return { ok: false, error: 'NO_PROFILE' };

        if (entrySnap.exists && entrySnap.data().estado === 'cobrada') {
            const existingEntry = entrySnap.data();
            return {
                ok: true,
                ticketUsed: existingEntry.metodo === TICKET_PAYMENT_METHOD,
                entradasId: entryRef.id,
                alreadyPaid: true
            };
        }

        const profile = profileSnap.data() || {};
        const progress = soloTicketProgress(profile);
        if (progress.tickets < 1) return { ok: true, ticketUsed: false };

        transaction.update(profileRef, { soloTickets: progress.tickets - 1 });
        transaction.set(entryRef, {
            usuarioId: uid,
            salaId: room.id,
            monto: 0,
            valorEntrada: room.entryFee,
            metodo: TICKET_PAYMENT_METHOD,
            estado: 'cobrada',
            fecha: timestamp
        });
        return {
            ok: true,
            ticketUsed: true,
            entradasId: entryRef.id
        };
    });
}

async function refundSoloTicket({ firestore, uid, entradasId, timestamp }) {
    if (!firestore || typeof uid !== 'string' || !uid ||
        typeof entradasId !== 'string' || !entradasId) {
        return { ok: false, error: 'INVALID_REQUEST' };
    }

    const profileRef = firestore.collection('usuarios').doc(uid);
    const entryRef = firestore.collection('entradas').doc(entradasId);
    return firestore.runTransaction(async (transaction) => {
        const [profileSnap, entrySnap] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(entryRef)
        ]);
        if (!entrySnap.exists) return { ok: false, error: 'ENTRY_NOT_FOUND' };
        const entry = entrySnap.data();
        if (entry.estado === 'reembolsada') return { ok: true, refunded: false };
        if (entry.estado !== 'cobrada' || entry.metodo !== TICKET_PAYMENT_METHOD) {
            return { ok: false, error: 'NOT_A_SOLO_TICKET' };
        }
        if (!profileSnap.exists) return { ok: false, error: 'NO_PROFILE' };

        const profile = profileSnap.data() || {};
        const progress = soloTicketProgress(profile);
        transaction.update(profileRef, { soloTickets: progress.tickets + 1 });
        transaction.update(entryRef, {
            estado: 'reembolsada',
            reembolsadoEn: timestamp
        });
        return { ok: true, refunded: true, tickets: progress.tickets + 1 };
    });
}

module.exports = Object.freeze({
    SOLO_WINS_PER_TICKET,
    TICKET_PAYMENT_METHOD,
    entryReceiptId,
    isEligibleSoloWinner,
    isEligibleSoloTicketRoom,
    recordSoloVictory,
    redeemSoloTicket,
    refundSoloTicket,
    soloTicketProgress
});
