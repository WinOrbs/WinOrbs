'use strict';

const COLLECTION = 'trofeosGlobales';
const DOCUMENT_ID = 'records';

const TROPHY_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: 'kill_streak',
        title: 'Racha imparable',
        description: 'Más eliminaciones consecutivas sin morir',
        threshold: 10
    }),
    Object.freeze({
        id: 'multikill',
        title: 'Multikill',
        description: 'Más eliminaciones en una ventana de 10 segundos',
        threshold: 3
    }),
    Object.freeze({
        id: 'explosion_chain',
        title: 'Reacción en cadena',
        description: 'Más objetos destruidos en una cadena de explosiones',
        threshold: 5
    })
]);

const DEFINITIONS_BY_ID = new Map(TROPHY_DEFINITIONS.map((trophy) => [trophy.id, trophy]));

function cleanHolderName(value) {
    const name = String(value || 'Jugador')
        .replace(/[<>&"'`]/g, '')
        .replace(/[\x00-\x1F]/g, '')
        .trim()
        .slice(0, 32);
    return name || 'Jugador';
}

function publicRecord(trophy, raw) {
    if (!raw || !Number.isSafeInteger(raw.value) || raw.value < trophy.threshold) return null;
    return {
        value: raw.value,
        holderName: cleanHolderName(raw.holderName),
        achievedAt: Number.isFinite(raw.achievedAt) ? raw.achievedAt : null
    };
}

function serializeTrophyRecords(rawRecords = {}) {
    if (rawRecords === null) rawRecords = {};
    if (typeof rawRecords !== 'object' || Array.isArray(rawRecords)) {
        throw new TypeError('Stored trophy records must be an object');
    }
    return TROPHY_DEFINITIONS.map((trophy) => ({
        ...trophy,
        record: publicRecord(trophy, rawRecords[trophy.id])
    }));
}

async function getGlobalTrophyRecords(firestore) {
    if (!firestore || typeof firestore.collection !== 'function') {
        throw new TypeError('Firestore database is required');
    }
    const snapshot = await firestore.collection(COLLECTION).doc(DOCUMENT_ID).get();
    const data = snapshot.exists ? snapshot.data() : null;
    return serializeTrophyRecords(data?.records);
}

async function updateGlobalTrophyRecord(firestore, {
    achievementId,
    value,
    uid,
    nick,
    achievedAt = Date.now()
}) {
    const trophy = DEFINITIONS_BY_ID.get(achievementId);
    if (!firestore || typeof firestore.collection !== 'function' ||
        typeof firestore.runTransaction !== 'function') {
        throw new TypeError('Firestore transaction support is required');
    }
    if (!trophy || !Number.isSafeInteger(value) || value < trophy.threshold ||
        typeof uid !== 'string' || !uid) {
        throw new TypeError('A valid trophy record and verified user ID are required');
    }

    const record = {
        value,
        holderUid: uid,
        holderName: cleanHolderName(nick),
        achievedAt: Number.isFinite(achievedAt) ? achievedAt : Date.now()
    };
    const reference = firestore.collection(COLLECTION).doc(DOCUMENT_ID);
    return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const data = snapshot.exists ? snapshot.data() : null;
        const current = publicRecord(trophy, data?.records?.[achievementId]);
        if (current && value <= current.value) {
            return { updated: false, record: current };
        }

        transaction.set(reference, {
            records: { [achievementId]: record }
        }, { merge: true });
        return {
            updated: true,
            record: publicRecord(trophy, record)
        };
    });
}

module.exports = Object.freeze({
    TROPHY_DEFINITIONS,
    getGlobalTrophyRecords,
    serializeTrophyRecords,
    updateGlobalTrophyRecord
});
