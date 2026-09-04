"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleMatch = void 0;
/**
 * settleMatch — Callable Cloud Function (trusted settlement).
 *
 * The ONLY path that credits the pot to a winner. Verifies that the caller's
 * claimed winner matches the authoritative result published by the world host
 * in Realtime Database (whose rules restrict writes to the live host), runs
 * server-side anti-cheat, and settles idempotently in a Firestore transaction.
 */
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const database_1 = require("firebase-admin/database");
(0, app_1.initializeApp)();
const DEFAULT_WINNER_PERCENT = 80;
const DEFAULT_PLATFORM_PERCENT = 20;
/** Score reported by the client may deviate at most 5% from the host snapshot. */
const MAX_SCORE_DEVIATION = 0.05;
exports.settleMatch = (0, https_1.onCall)({ region: 'us-central1', enforceAppCheck: false }, async (request) => {
    // 1. Auth is mandatory.
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para liquidar una partida.');
    }
    const { roomId, winnerId, telemetry } = request.data || {};
    if (!roomId || typeof roomId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'roomId es requerido.');
    }
    if (!winnerId || typeof winnerId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'winnerId es requerido.');
    }
    const db = (0, firestore_1.getFirestore)();
    const rtdb = (0, database_1.getDatabase)();
    // 2. The authoritative result MUST exist and MUST have been published by
    //    the world host (rules already guarantee this; double-check the stamp).
    const resultSnap = await rtdb.ref(`matches/${roomId}/result`).get();
    if (!resultSnap.exists()) {
        return {
            ok: false,
            reason: 'El host de la partida no publicó un resultado autoritativo.',
        };
    }
    const result = resultSnap.val();
    if (!result || result.winnerId !== winnerId) {
        return {
            ok: false,
            reason: 'El ganador declarado no coincide con el resultado autoritativo del host.',
        };
    }
    if (result.hostUid && result.hostUid !== uid) {
        // Only the host client that simulated the match may trigger settlement.
        return {
            ok: false,
            reason: 'Solo el host autoritativo puede solicitar la liquidación.',
        };
    }
    // 3. Load the room and validate its lifecycle state.
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
        return { ok: false, reason: 'Sala no encontrada.' };
    }
    const room = roomSnap.data();
    // The caller must be a registered participant.
    const participants = room.registeredPlayers || [];
    if (!participants.some((p) => p?.id === uid)) {
        return { ok: false, reason: 'No eres participante de esta sala.' };
    }
    // The room must not already be finished (idempotency gate A).
    if (room.status === 'finished') {
        return { ok: false, reason: 'Esta partida ya fue liquidada.' };
    }
    // 4. Server-side anti-cheat: the caller's telemetry score must be close
    //    to the score the host published in the authoritative snapshot.
    if (telemetry && typeof telemetry.score === 'number' &&
        typeof result.winnerScore === 'number') {
        const deviation = Math.abs(telemetry.score - result.winnerScore) /
            Math.max(1, result.winnerScore);
        if (deviation > MAX_SCORE_DEVIATION) {
            return {
                ok: false,
                reason: `Puntaje inconsistente con el host (${Math.round(deviation * 100)}% de desviación).`,
            };
        }
    }
    // 5. Pot + payout split. Prefer the platform config when present.
    let winnerPercent = DEFAULT_WINNER_PERCENT;
    let platformPercent = DEFAULT_PLATFORM_PERCENT;
    try {
        const cfgSnap = await db.collection('config').doc('exchange').get();
        const cfg = cfgSnap.data();
        if (cfg?.winnerPotPercent && cfg?.platformPotPercent) {
            winnerPercent = cfg.winnerPotPercent;
            platformPercent = cfg.platformPotPercent;
        }
    }
    catch {
        // Fall back to defaults.
    }
    const potTotal = Math.max(room.potUSD || 0, (room.entryFeeUSD || 0) * Math.max(1, participants.length));
    const winnerPayoutUSD = Number(((potTotal * winnerPercent) / 100).toFixed(2));
    const platformCommissionUSD = Number(((potTotal * platformPercent) / 100).toFixed(2));
    if (winnerPayoutUSD <= 0) {
        return { ok: false, reason: 'El pote es cero; no hay nada que liquidar.' };
    }
    // 6. Idempotent settlement transaction (idempotency gate B — the strong one).
    const resultRef = db.collection('matchResults').doc(roomId);
    const winnerRef = db.collection('users').doc(winnerId);
    const nowISO = new Date().toISOString();
    let payout = 0;
    await db.runTransaction(async (tx) => {
        const claimed = await tx.get(resultRef);
        if (claimed.exists) {
            payout = claimed.data().payoutUSD || 0;
            return;
        }
        const winnerSnap = await tx.get(winnerRef);
        if (!winnerSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'El usuario ganador no existe.');
        }
        const winner = winnerSnap.data();
        const newBalance = Number(((winner.balanceUSD || 0) + winnerPayoutUSD).toFixed(2));
        payout = winnerPayoutUSD;
        tx.set(resultRef, {
            roomId,
            winnerId,
            winnerName: winner.name || result.winnerName || '',
            payoutUSD: winnerPayoutUSD,
            platformCommissionUSD,
            potTotal,
            settledAt: nowISO,
            settledBy: uid,
        });
        tx.update(winnerRef, {
            balanceUSD: newBalance,
            stats: {
                matchesPlayed: (winner.stats?.matchesPlayed || 0) + 1,
                matchesWon: (winner.stats?.matchesWon || 0) + 1,
                totalEarningsUSD: Number(((winner.stats?.totalEarningsUSD || 0) + winnerPayoutUSD).toFixed(2)),
                totalKills: (winner.stats?.totalKills || 0) + (result.winnerKills || 0),
                highestScore: Math.max(winner.stats?.highestScore || 0, result.winnerScore || 0),
            },
        });
        tx.set(db.collection('transactions').doc(`win-${roomId}`), {
            id: `win-${roomId}`,
            userId: winnerId,
            userName: winner.name || result.winnerName || '',
            userPhone: winner.phone || '',
            type: 'pot_win',
            amountUSD: winnerPayoutUSD,
            amountVES: 0,
            method: 'pago_movil',
            status: 'approved',
            referenceNumber: `POT-WIN-${room.code || roomId}-${Date.now().toString().slice(-4)}`,
            adminNotes: `Premio ${winnerPercent}% del pote (${potTotal.toFixed(2)} USD) liquidado por backend trusted.`,
            createdAt: nowISO,
        });
        tx.update(roomRef, {
            status: 'finished',
            finishedAt: nowISO,
            timeRemainingSeconds: 0,
            winnerId,
            winnerPayoutUSD,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true, winnerId, payoutUSD: payout };
});
