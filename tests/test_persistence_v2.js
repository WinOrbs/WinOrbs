'use strict';

const assert = require('assert');
const {
    REPOSITORY_METHODS,
    PersistenceContractError,
    assertRepositories
} = require('../packages/persistence/v2');
const {
    COLLECTIONS,
    REQUIRED_COMPOSITE_INDEXES,
    createFirestorePersistence
} = require('../packages/infrastructure/firestore/v2');

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

class MemoryFirestore {
    constructor() {
        this.collections = new Map();
    }

    collection(name) {
        return this.collectionRef(name);
    }

    collectionRef(name) {
        return {
            doc: (id) => this.documentRef(name, id),
            where: (field, operator, value) =>
                new MemoryQuery(this, name, [[field, operator, value]]),
            orderBy: (field, direction) =>
                new MemoryQuery(this, name, [], [[field, direction]]),
            limit: (count) => new MemoryQuery(this, name, [], [], count)
        };
    }

    documentRef(collection, id) {
        const firestore = this;
        return {
            collection,
            id,
            async get() {
                const value = firestore.collections.get(collection)?.get(id);
                return snapshot(value);
            },
            async create(value) {
                const records = ensureCollection(firestore.collections, collection);
                if (records.has(id)) throw Object.assign(new Error('already exists'), { code: 6 });
                records.set(id, copy(value));
            },
            async set(value) {
                ensureCollection(firestore.collections, collection).set(id, copy(value));
            },
            async update(value) {
                const records = ensureCollection(firestore.collections, collection);
                if (!records.has(id)) throw new Error('not found');
                records.set(id, { ...records.get(id), ...copy(value) });
            }
        };
    }

    async runTransaction(work) {
        const staged = cloneCollections(this.collections);
        const native = {
            async get(documentRef) {
                return snapshot(staged.get(documentRef.collection)?.get(documentRef.id));
            },
            create(documentRef, value) {
                const records = ensureCollection(staged, documentRef.collection);
                if (records.has(documentRef.id)) {
                    throw Object.assign(new Error('already exists'), { code: 6 });
                }
                records.set(documentRef.id, copy(value));
            },
            set(documentRef, value) {
                ensureCollection(staged, documentRef.collection)
                    .set(documentRef.id, copy(value));
            },
            update(documentRef, value) {
                const records = ensureCollection(staged, documentRef.collection);
                if (!records.has(documentRef.id)) throw new Error('not found');
                records.set(documentRef.id, { ...records.get(documentRef.id), ...copy(value) });
            }
        };
        const result = await work(native);
        this.collections = staged;
        return result;
    }
}

class MemoryQuery {
    constructor(firestore, collection, filters = [], orderings = [], max = Infinity) {
        this.firestore = firestore;
        this.collection = collection;
        this.filters = filters;
        this.orderings = orderings;
        this.max = max;
    }

    where(field, operator, value) {
        return new MemoryQuery(this.firestore, this.collection,
            [...this.filters, [field, operator, value]], this.orderings, this.max);
    }

    orderBy(field, direction = 'asc') {
        return new MemoryQuery(this.firestore, this.collection, this.filters,
            [...this.orderings, [field, direction]], this.max);
    }

    limit(max) {
        return new MemoryQuery(this.firestore, this.collection, this.filters, this.orderings, max);
    }

    async get() {
        let records = [...(this.firestore.collections.get(this.collection) || new Map()).values()]
            .filter((record) => this.filters.every(([field, operator, value]) =>
                operator === '==' ? record[field] === value
                    : operator === '<=' ? record[field] <= value
                        : false));
        records.sort((left, right) => {
            for (const [field, direction] of this.orderings) {
                if (left[field] === right[field]) continue;
                const order = left[field] < right[field] ? -1 : 1;
                return direction === 'desc' ? -order : order;
            }
            return 0;
        });
        records = records.slice(0, this.max);
        return { docs: records.map((record) => ({ data: () => copy(record) })) };
    }
}

function ensureCollection(collections, name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
}

function cloneCollections(collections) {
    return new Map([...collections].map(([name, records]) =>
        [name, new Map([...records].map(([id, value]) => [id, copy(value)]))]));
}

function snapshot(value) {
    return {
        exists: value !== undefined,
        data: () => value === undefined ? undefined : copy(value)
    };
}

async function run() {
    assert.throws(() => assertRepositories({}), PersistenceContractError);
    assert.ok(Object.keys(REPOSITORY_METHODS).length === 11);
    assert.throws(() => createFirestorePersistence(), /Firestore instance must be injected/);

    const firestore = new MemoryFirestore();
    const persistence = createFirestorePersistence({ firestore });
    assert.strictEqual(assertRepositories(persistence), persistence);
    assert.deepStrictEqual(Object.keys(persistence).sort(),
        [...Object.keys(REPOSITORY_METHODS), 'runInTransaction'].sort());
    assert.ok(REQUIRED_COMPOSITE_INDEXES.some((index) =>
        index.collection === COLLECTIONS.settlements &&
        index.fields.includes('matchId') &&
        index.fields.includes('settlementVersion')));

    await persistence.UserRepository.create('user/one', { name: 'Ada' });
    assert.deepStrictEqual(await persistence.UserRepository.getById('user/one'), { name: 'Ada' });
    await persistence.UserRepository.update('user/one', { active: true });
    assert.deepStrictEqual(await persistence.UserRepository.getById('user/one'),
        { name: 'Ada', active: true });

    await assert.rejects(
        persistence.WalletRepository.update('user/one', { balance: 9 }),
        (error) => error.code === 'TRANSACTION_REQUIRED'
    );
    await assert.rejects(
        persistence.LedgerRepository.append({ entryId: 'ledger-1' }),
        (error) => error.code === 'TRANSACTION_REQUIRED'
    );
    await assert.rejects(
        persistence.IdempotencyRepository.claim('match', 'key', {}),
        (error) => error.code === 'TRANSACTION_REQUIRED'
    );

    const outcome = await persistence.runInTransaction(async (tx) => {
        await tx.WalletRepository.create('user/one', { balance: 100 }, tx.transaction);
        const idem = await tx.IdempotencyRepository.claim(
            'settlement', 'request-1', { response: { accepted: true } }, tx.transaction
        );
        const settlement = await tx.MatchRepository.claimSettlement(
            'match-1', 'v1', { state: 'SETTLING' }, tx.transaction
        );
        await tx.LedgerRepository.append({
            entryId: 'ledger-1',
            matchId: 'match-1',
            userId: 'user/one',
            amount: 25,
            createdAt: 10
        }, tx.transaction);
        await tx.WalletRepository.update('user/one', { balance: 125 }, tx.transaction);
        await tx.OutboxRepository.enqueue({
            eventId: 'event-1',
            type: 'SettlementRequested',
            availableAt: 10,
            createdAt: 10
        }, tx.transaction);
        return { idem, settlement };
    });
    assert.strictEqual(outcome.idem.claimed, true);
    assert.strictEqual(outcome.settlement.claimed, true);
    assert.deepStrictEqual(await persistence.WalletRepository.getByUserId('user/one'),
        { balance: 125 });
    assert.strictEqual('update' in persistence.LedgerRepository, false);
    assert.strictEqual('delete' in persistence.LedgerRepository, false);

    const duplicate = await persistence.runInTransaction(async (tx) => ({
        idem: await tx.IdempotencyRepository.claim(
            'settlement', 'request-1', { response: { accepted: false } }, tx.transaction
        ),
        settlement: await tx.MatchRepository.claimSettlement(
            'match-1', 'v1', { state: 'REPLACEMENT' }, tx.transaction
        )
    }));
    assert.strictEqual(duplicate.idem.claimed, false);
    assert.strictEqual(duplicate.idem.record.response.accepted, true);
    assert.strictEqual(duplicate.settlement.claimed, false);
    assert.strictEqual(duplicate.settlement.settlement.state, 'SETTLING');

    await assert.rejects(persistence.runInTransaction(async (tx) => {
        await tx.LedgerRepository.append({
            entryId: 'ledger-1',
            matchId: 'match-1',
            amount: 500,
            createdAt: 11
        }, tx.transaction);
    }));
    assert.strictEqual((await persistence.LedgerRepository.getById('ledger-1')).amount, 25);
    assert.deepStrictEqual(await persistence.LedgerRepository.listByMatch('match-1'), [{
        entryId: 'ledger-1',
        matchId: 'match-1',
        userId: 'user/one',
        amount: 25,
        createdAt: 10
    }]);

    await assert.rejects(persistence.runInTransaction(async (tx) => {
        await tx.UserRepository.create('rollback-user', { name: 'Not committed' }, tx.transaction);
        throw new Error('rollback test');
    }), /rollback test/);
    assert.strictEqual(await persistence.UserRepository.getById('rollback-user'), null);

    await persistence.runInTransaction(async (tx) => {
        await tx.AuditRepository.append({
            entryId: 'audit-1',
            aggregateId: 'user/one',
            createdAt: 12
        }, tx.transaction);
        await tx.InventoryRepository.replaceForUser('user/one', { items: ['skin-1'] },
            tx.transaction);
        await tx.ProgressionRepository.replaceForUser('user/one', { level: 2 },
            tx.transaction);
        await tx.RewardRepository.create('reward-1', { status: 'PENDING' }, tx.transaction);
        await tx.PaymentRepository.create('payment-1', { status: 'AUTHORIZED' }, tx.transaction);
        await tx.OutboxRepository.markPublished('event-1', 20, tx.transaction);
    });
    assert.deepStrictEqual(await persistence.AuditRepository.listByAggregate('user/one'), [{
        entryId: 'audit-1',
        aggregateId: 'user/one',
        createdAt: 12
    }]);
    assert.deepStrictEqual(await persistence.OutboxRepository.listPending(100), []);
    assert.strictEqual((await persistence.OutboxRepository.getById('event-1')).status,
        'PUBLISHED');
    assert.deepStrictEqual(await persistence.InventoryRepository.getByUserId('user/one'),
        { items: ['skin-1'] });
    assert.deepStrictEqual(await persistence.ProgressionRepository.getByUserId('user/one'),
        { level: 2 });
    assert.deepStrictEqual(await persistence.RewardRepository.getById('reward-1'),
        { status: 'PENDING' });
    assert.deepStrictEqual(await persistence.PaymentRepository.getById('payment-1'),
        { status: 'AUTHORIZED' });

    console.log('OK persistence v2: repository ports, transactional Firestore adapter, durable claims and immutable ledger.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
