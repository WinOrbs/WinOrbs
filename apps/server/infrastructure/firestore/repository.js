'use strict';

/**
 * Persistence adapter. Domain modules should depend on this boundary instead
 * of calling Firestore throughout gameplay code.
 */
function createFirestoreRepository(db, collectionName) {
    if (!db || typeof db.collection !== 'function') {
        throw new TypeError('Firestore database is required');
    }
    if (typeof collectionName !== 'string' || !collectionName.trim()) {
        throw new TypeError('Firestore collection name is required');
    }

    const collection = db.collection(collectionName.trim());

    return Object.freeze({
        async get(id) {
            const snap = await collection.doc(String(id)).get();
            return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
        },
        async set(id, data) {
            await collection.doc(String(id)).set(data);
            return true;
        },
        async update(id, data) {
            await collection.doc(String(id)).update(data);
            return true;
        }
    });
}

module.exports = Object.freeze({ createFirestoreRepository });
