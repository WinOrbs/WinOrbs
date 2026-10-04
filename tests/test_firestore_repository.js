'use strict';
const assert = require('assert');
const { createFirestoreRepository } = require('../apps/server/infrastructure/firestore/repository');

const docs = new Map();
const db = {
    collection(name) {
        assert.strictEqual(name, 'usuarios');
        return {
            doc(id) {
                return {
                    async get() {
                        const data = docs.get(id);
                        return data ? { exists: true, id, data: () => data } : { exists: false, id, data: () => ({}) };
                    },
                    async set(data) { docs.set(id, data); },
                    async update(data) { docs.set(id, Object.assign({}, docs.get(id), data)); }
                };
            }
        };
    }
};
const repo = createFirestoreRepository(db, 'usuarios');
(async () => {
    assert.strictEqual(await repo.get('u1'), null);
    await repo.set('u1', { apodo: 'One' });
    assert.deepStrictEqual(await repo.get('u1'), { id: 'u1', apodo: 'One' });
    await repo.update('u1', { activo: true });
    assert.deepStrictEqual(await repo.get('u1'), { id: 'u1', apodo: 'One', activo: true });
    console.log('OK data: Firestore access is isolated behind a repository boundary.');
})();
