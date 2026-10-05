'use strict';

const crypto = require('crypto');
const { assertRepositories } = require('../../../persistence/v2');

const COLLECTIONS = Object.freeze({
    users: 'v2_users',
    wallets: 'v2_wallets',
    ledger: 'v2_ledger',
    matches: 'v2_matches',
    settlements: 'v2_match_settlements',
    inventories: 'v2_inventories',
    progression: 'v2_progression',
    rewards: 'v2_rewards',
    payments: 'v2_payments',
    audit: 'v2_audit',
    idempotency: 'v2_idempotency',
    outbox: 'v2_outbox'
});

const REQUIRED_COMPOSITE_INDEXES = Object.freeze([
    Object.freeze({
        collection: COLLECTIONS.settlements,
        fields: Object.freeze(['matchId', 'settlementVersion']),
        uniqueness: 'deterministic document id; transactional create-only'
    }),
    Object.freeze({
        collection: COLLECTIONS.idempotency,
        fields: Object.freeze(['scope', 'key']),
        uniqueness: 'deterministic document id; transactional create-only'
    }),
    Object.freeze({
        collection: COLLECTIONS.ledger,
        fields: Object.freeze(['matchId', 'createdAt']),
        uniqueness: 'entryId document id; append-only'
    }),
    Object.freeze({
        collection: COLLECTIONS.ledger,
        fields: Object.freeze(['userId', 'createdAt']),
        uniqueness: 'entryId document id; append-only'
    }),
    Object.freeze({
        collection: COLLECTIONS.audit,
        fields: Object.freeze(['aggregateId', 'createdAt']),
        uniqueness: 'entryId document id; append-only'
    }),
    Object.freeze({
        collection: COLLECTIONS.outbox,
        fields: Object.freeze(['status', 'availableAt', 'createdAt']),
        uniqueness: 'eventId document id; transactional create-only'
    })
]);

const TRANSACTION_REQUIRED = 'TRANSACTION_REQUIRED';
const INVALID_RECORD = 'INVALID_RECORD';
const DUPLICATE_RECORD = 'DUPLICATE_RECORD';
const IMMUTABLE_RECORD = 'IMMUTABLE_RECORD';

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function requireId(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512) {
        const error = new TypeError(`${field} must be a non-empty string`);
        error.code = INVALID_RECORD;
        throw error;
    }
    return value;
}

function requireRecord(value) {
    if (!isRecord(value)) {
        const error = new TypeError('A record object is required');
        error.code = INVALID_RECORD;
        throw error;
    }
    return clone(value);
}

function requireTransaction(transaction) {
    if (!transaction || typeof transaction.get !== 'function' ||
        typeof transaction.create !== 'function' ||
        typeof transaction.set !== 'function' ||
        typeof transaction.update !== 'function') {
        const error = new TypeError('This operation requires a Firestore transaction');
        error.code = TRANSACTION_REQUIRED;
        throw error;
    }
    return transaction;
}

function documentId(parts) {
    return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function idempotencyId(scope, key) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([scope, key]))
        .digest('hex');
}

function createFirestorePersistence({ firestore } = {}) {
    if (!firestore || typeof firestore.collection !== 'function' ||
        typeof firestore.runTransaction !== 'function') {
        throw new TypeError('An initialized Firestore instance must be injected');
    }

    function ref(collection, id) {
        return firestore.collection(collection).doc(id);
    }

    async function read(transaction, documentRef) {
        const snapshot = transaction
            ? await transaction.get(documentRef)
            : await documentRef.get();
        return snapshot.exists ? clone(snapshot.data()) : null;
    }

    async function createOnly(transaction, documentRef, value) {
        if (transaction) {
            requireTransaction(transaction).create(documentRef, value);
            return;
        }
        await documentRef.create(value);
    }

    async function setValue(transaction, documentRef, value) {
        if (transaction) {
            requireTransaction(transaction).set(documentRef, value);
            return;
        }
        await documentRef.set(value);
    }

    async function updateValue(transaction, documentRef, value) {
        if (transaction) {
            requireTransaction(transaction).update(documentRef, value);
            return;
        }
        await documentRef.update(value);
    }

    function simpleRepository(collection) {
        return Object.freeze({
            async getById(id, transaction) {
                requireId(id, 'id');
                return read(transaction, ref(collection, documentId([id])));
            },
            async create(id, value, transaction) {
                requireId(id, 'id');
                const record = requireRecord(value);
                const documentRef = ref(collection, documentId([id]));
                await createOnly(transaction, documentRef, record);
                return clone(record);
            },
            async update(id, patch, transaction) {
                requireId(id, 'id');
                const record = requireRecord(patch);
                const documentRef = ref(collection, documentId([id]));
                await updateValue(transaction, documentRef, record);
                return clone(record);
            }
        });
    }

    function transactionalRepository(collection) {
        return Object.freeze({
            async getById(id, transaction) {
                requireId(id, 'id');
                return read(transaction, ref(collection, documentId([id])));
            },
            async create(id, value, transaction) {
                requireTransaction(transaction);
                requireId(id, 'id');
                const record = requireRecord(value);
                await createOnly(transaction, ref(collection, documentId([id])), record);
                return clone(record);
            },
            async update(id, patch, transaction) {
                requireTransaction(transaction);
                requireId(id, 'id');
                const record = requireRecord(patch);
                await updateValue(transaction, ref(collection, documentId([id])), record);
                return clone(record);
            }
        });
    }

    const userRepository = simpleRepository(COLLECTIONS.users);
    const rewardRepository = transactionalRepository(COLLECTIONS.rewards);
    const paymentRepository = transactionalRepository(COLLECTIONS.payments);

    const repositories = {
        UserRepository: userRepository,
        WalletRepository: Object.freeze({
            async getByUserId(userId, transaction) {
                requireId(userId, 'userId');
                return read(transaction, ref(COLLECTIONS.wallets, documentId([userId])));
            },
            async create(userId, wallet, transaction) {
                requireTransaction(transaction);
                requireId(userId, 'userId');
                const record = requireRecord(wallet);
                await createOnly(transaction, ref(COLLECTIONS.wallets, documentId([userId])), record);
                return clone(record);
            },
            async update(userId, patch, transaction) {
                requireTransaction(transaction);
                requireId(userId, 'userId');
                const record = requireRecord(patch);
                await updateValue(transaction, ref(COLLECTIONS.wallets, documentId([userId])), record);
                return clone(record);
            }
        }),
        LedgerRepository: Object.freeze({
            async getById(entryId, transaction) {
                requireId(entryId, 'entryId');
                return read(transaction, ref(COLLECTIONS.ledger, documentId([entryId])));
            },
            async listByMatch(matchId, limit = 100) {
                requireId(matchId, 'matchId');
                if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
                    throw new TypeError('limit must be an integer between 1 and 1000');
                }
                const query = firestore.collection(COLLECTIONS.ledger)
                    .where('matchId', '==', matchId)
                    .orderBy('createdAt', 'asc')
                    .limit(limit);
                const snapshot = await query.get();
                return snapshot.docs.map((item) => clone(item.data()));
            },
            async append(entry, transaction) {
                requireTransaction(transaction);
                const record = requireRecord(entry);
                const entryId = requireId(record.entryId, 'entryId');
                await createOnly(transaction, ref(COLLECTIONS.ledger, documentId([entryId])), record);
                return clone(record);
            }
        }),
        MatchRepository: Object.freeze({
            async getById(matchId, transaction) {
                requireId(matchId, 'matchId');
                return read(transaction, ref(COLLECTIONS.matches, documentId([matchId])));
            },
            async create(matchId, match, transaction) {
                requireTransaction(transaction);
                requireId(matchId, 'matchId');
                const record = requireRecord(match);
                await createOnly(transaction, ref(COLLECTIONS.matches, documentId([matchId])), record);
                return clone(record);
            },
            async update(matchId, patch, transaction) {
                requireTransaction(transaction);
                requireId(matchId, 'matchId');
                const record = requireRecord(patch);
                await updateValue(transaction, ref(COLLECTIONS.matches, documentId([matchId])), record);
                return clone(record);
            },
            async claimSettlement(matchId, settlementVersion, settlement, transaction) {
                requireTransaction(transaction);
                requireId(matchId, 'matchId');
                requireId(settlementVersion, 'settlementVersion');
                const record = requireRecord(settlement);
                const id = documentId([matchId, settlementVersion]);
                const settlementRef = ref(COLLECTIONS.settlements, id);
                const current = await read(transaction, settlementRef);
                if (current) return { claimed: false, settlement: current };
                await createOnly(transaction, settlementRef, {
                    ...record,
                    matchId,
                    settlementVersion
                });
                return {
                    claimed: true,
                    settlement: { ...record, matchId, settlementVersion }
                };
            }
        }),
        InventoryRepository: Object.freeze({
            async getByUserId(userId, transaction) {
                requireId(userId, 'userId');
                return read(transaction, ref(COLLECTIONS.inventories, documentId([userId])));
            },
            async replaceForUser(userId, inventory, transaction) {
                requireTransaction(transaction);
                requireId(userId, 'userId');
                const record = requireRecord(inventory);
                await setValue(transaction, ref(COLLECTIONS.inventories, documentId([userId])), record);
                return clone(record);
            }
        }),
        ProgressionRepository: Object.freeze({
            async getByUserId(userId, transaction) {
                requireId(userId, 'userId');
                return read(transaction, ref(COLLECTIONS.progression, documentId([userId])));
            },
            async replaceForUser(userId, progression, transaction) {
                requireTransaction(transaction);
                requireId(userId, 'userId');
                const record = requireRecord(progression);
                await setValue(transaction, ref(COLLECTIONS.progression, documentId([userId])), record);
                return clone(record);
            }
        }),
        RewardRepository: rewardRepository,
        PaymentRepository: paymentRepository,
        AuditRepository: Object.freeze({
            async append(entry, transaction) {
                requireTransaction(transaction);
                const record = requireRecord(entry);
                const entryId = requireId(record.entryId, 'entryId');
                await createOnly(transaction, ref(COLLECTIONS.audit, documentId([entryId])), record);
                return clone(record);
            },
            async listByAggregate(aggregateId, limit = 100) {
                requireId(aggregateId, 'aggregateId');
                if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
                    throw new TypeError('limit must be an integer between 1 and 1000');
                }
                const query = firestore.collection(COLLECTIONS.audit)
                    .where('aggregateId', '==', aggregateId)
                    .orderBy('createdAt', 'asc')
                    .limit(limit);
                const snapshot = await query.get();
                return snapshot.docs.map((item) => clone(item.data()));
            }
        }),
        IdempotencyRepository: Object.freeze({
            async getByKey(scope, key, transaction) {
                requireId(scope, 'scope');
                requireId(key, 'key');
                return read(transaction, ref(COLLECTIONS.idempotency, idempotencyId(scope, key)));
            },
            async claim(scope, key, value, transaction) {
                requireTransaction(transaction);
                requireId(scope, 'scope');
                requireId(key, 'key');
                const record = requireRecord(value);
                const id = idempotencyId(scope, key);
                const idempotencyRef = ref(COLLECTIONS.idempotency, id);
                const current = await read(transaction, idempotencyRef);
                if (current) return { claimed: false, record: current };
                const stored = { ...record, scope, key };
                await createOnly(transaction, idempotencyRef, stored);
                return { claimed: true, record: clone(stored) };
            }
        }),
        OutboxRepository: Object.freeze({
            async getById(eventId, transaction) {
                return read(transaction, ref(COLLECTIONS.outbox, documentId([eventId])));
            },
            async enqueue(event, transaction) {
                requireTransaction(transaction);
                const record = requireRecord(event);
                const eventId = requireId(record.eventId, 'eventId');
                const stored = {
                    ...record,
                    status: 'PENDING',
                    attempts: 0
                };
                await createOnly(transaction, ref(COLLECTIONS.outbox, documentId([eventId])), stored);
                return clone(stored);
            },
            async listPending(now, limit = 100) {
                if (!Number.isFinite(now) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
                    throw new TypeError('A finite time and limit between 1 and 1000 are required');
                }
                const query = firestore.collection(COLLECTIONS.outbox)
                    .where('status', '==', 'PENDING')
                    .where('availableAt', '<=', now)
                    .orderBy('availableAt', 'asc')
                    .orderBy('createdAt', 'asc')
                    .limit(limit);
                const snapshot = await query.get();
                return snapshot.docs.map((item) => clone(item.data()));
            },
            async markPublished(eventId, publishedAt, transaction) {
                requireTransaction(transaction);
                requireId(eventId, 'eventId');
                if (!Number.isFinite(publishedAt)) throw new TypeError('publishedAt must be finite');
                const patch = { status: 'PUBLISHED', publishedAt };
                await updateValue(transaction, ref(COLLECTIONS.outbox, documentId([eventId])), patch);
                return patch;
            }
        }),
        async runInTransaction(work) {
            if (typeof work !== 'function') throw new TypeError('Transaction callback required');
            return firestore.runTransaction(async (nativeTransaction) => {
                const writes = [];
                const transaction = {
                    get(documentRef) {
                        return nativeTransaction.get(documentRef);
                    },
                    create(documentRef, value) {
                        writes.push(['create', documentRef, value]);
                    },
                    set(documentRef, value) {
                        writes.push(['set', documentRef, value]);
                    },
                    update(documentRef, value) {
                        writes.push(['update', documentRef, value]);
                    }
                };
                const result = await work({ ...repositories, transaction });
                for (const [method, documentRef, value] of writes) {
                    nativeTransaction[method](documentRef, value);
                }
                return result;
            });
        }
    };

    return Object.freeze(assertRepositories(repositories));
}

module.exports = Object.freeze({
    COLLECTIONS,
    REQUIRED_COMPOSITE_INDEXES,
    createFirestorePersistence
});
