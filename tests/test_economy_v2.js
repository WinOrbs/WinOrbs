'use strict';

const assert = require('assert');
const {
    ECONOMY_ERRORS,
    SETTLEMENT_STATUSES,
    createEconomyService
} = require('../packages/economy/v2');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeMemoryPersistence() {
    const initial = {
        users: new Map(),
        wallets: new Map(),
        ledger: new Map(),
        matches: new Map(),
        settlements: new Map(),
        inventories: new Map(),
        progression: new Map(),
        rewards: new Map(),
        payments: new Map(),
        audit: new Map(),
        idempotency: new Map(),
        outbox: new Map()
    };
    let state = initial;
    let queue = Promise.resolve();
    let failNextWalletUpdateFor = null;

    function selected(tx) {
        return tx ? tx.state : state;
    }

    function repoMap(tx, collection) {
        return selected(tx)[collection];
    }

    function cloneState(source) {
        const target = {};
        for (const [name, records] of Object.entries(source)) {
            target[name] = new Map([...records].map(([key, value]) => [key, clone(value)]));
        }
        return target;
    }

    const repositories = {
        UserRepository: {
            async getById(id, tx) { return clone(repoMap(tx, 'users').get(id) || null); },
            async create(id, value, tx) { repoMap(tx, 'users').set(id, clone(value)); },
            async update(id, patch, tx) {
                repoMap(tx, 'users').set(id, {
                    ...repoMap(tx, 'users').get(id),
                    ...clone(patch)
                });
            }
        },
        WalletRepository: {
            async getByUserId(id, tx) {
                return clone(repoMap(tx, 'wallets').get(id) || null);
            },
            async create(id, value, tx) {
                if (repoMap(tx, 'wallets').has(id)) throw new Error('duplicate wallet');
                repoMap(tx, 'wallets').set(id, clone(value));
            },
            async update(id, patch, tx) {
                if (failNextWalletUpdateFor === id) {
                    failNextWalletUpdateFor = null;
                    throw new Error('transient wallet write failure');
                }
                const records = repoMap(tx, 'wallets');
                if (!records.has(id)) throw new Error('wallet missing');
                records.set(id, { ...records.get(id), ...clone(patch) });
            }
        },
        LedgerRepository: {
            async getById(id, tx) {
                return clone(repoMap(tx, 'ledger').get(id) || null);
            },
            async listByMatch(matchId, limit = 100) {
                return [...state.ledger.values()]
                    .filter((entry) => entry.matchId === matchId)
                    .slice(0, limit)
                    .map(clone);
            },
            async append(entry, tx) {
                const records = repoMap(tx, 'ledger');
                if (records.has(entry.entryId)) throw new Error('immutable ledger duplicate');
                records.set(entry.entryId, clone(entry));
            }
        },
        MatchRepository: {
            async getById(id, tx) { return clone(repoMap(tx, 'matches').get(id) || null); },
            async create(id, value, tx) {
                const records = repoMap(tx, 'matches');
                if (records.has(id)) throw new Error('duplicate match');
                records.set(id, clone(value));
            },
            async update(id, patch, tx) {
                const records = repoMap(tx, 'matches');
                if (!records.has(id)) throw new Error('match missing');
                records.set(id, { ...records.get(id), ...clone(patch) });
            },
            async claimSettlement(matchId, version, value, tx) {
                const key = `${matchId}\u0000${version}`;
                const records = repoMap(tx, 'settlements');
                if (records.has(key)) {
                    return { claimed: false, settlement: clone(records.get(key)) };
                }
                records.set(key, clone(value));
                return { claimed: true, settlement: clone(value) };
            }
        },
        InventoryRepository: {
            async getByUserId(id, tx) { return clone(repoMap(tx, 'inventories').get(id) || null); },
            async replaceForUser(id, value, tx) { repoMap(tx, 'inventories').set(id, clone(value)); }
        },
        ProgressionRepository: {
            async getByUserId(id, tx) { return clone(repoMap(tx, 'progression').get(id) || null); },
            async replaceForUser(id, value, tx) { repoMap(tx, 'progression').set(id, clone(value)); }
        },
        RewardRepository: {
            async getById(id, tx) { return clone(repoMap(tx, 'rewards').get(id) || null); },
            async create(id, value, tx) { repoMap(tx, 'rewards').set(id, clone(value)); },
            async update(id, patch, tx) {
                repoMap(tx, 'rewards').set(id, {
                    ...repoMap(tx, 'rewards').get(id),
                    ...clone(patch)
                });
            }
        },
        PaymentRepository: {
            async getById(id, tx) { return clone(repoMap(tx, 'payments').get(id) || null); },
            async create(id, value, tx) { repoMap(tx, 'payments').set(id, clone(value)); },
            async update(id, patch, tx) {
                repoMap(tx, 'payments').set(id, {
                    ...repoMap(tx, 'payments').get(id),
                    ...clone(patch)
                });
            }
        },
        AuditRepository: {
            async append(entry, tx) { repoMap(tx, 'audit').set(entry.entryId, clone(entry)); },
            async listByAggregate(id) {
                return [...state.audit.values()].filter((entry) => entry.aggregateId === id);
            }
        },
        IdempotencyRepository: {
            async getByKey(scope, key, tx) {
                return clone(repoMap(tx, 'idempotency').get(`${scope}\u0000${key}`) || null);
            },
            async claim(scope, key, value, tx) {
                const records = repoMap(tx, 'idempotency');
                const id = `${scope}\u0000${key}`;
                if (records.has(id)) {
                    return { claimed: false, record: clone(records.get(id)) };
                }
                records.set(id, clone(value));
                return { claimed: true, record: clone(value) };
            }
        },
        OutboxRepository: {
            async getById(id, tx) { return clone(repoMap(tx, 'outbox').get(id) || null); },
            async enqueue(event, tx) {
                const records = repoMap(tx, 'outbox');
                if (records.has(event.eventId)) throw new Error('duplicate outbox event');
                records.set(event.eventId, clone({ ...event, status: 'PENDING', attempts: 0 }));
            },
            async listPending(now) {
                return [...state.outbox.values()].filter((event) =>
                    event.status === 'PENDING' && event.availableAt <= now);
            },
            async markPublished(id, publishedAt, tx) {
                const records = repoMap(tx, 'outbox');
                records.set(id, { ...records.get(id), status: 'PUBLISHED', publishedAt });
            }
        },
        async runInTransaction(work) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            await previous;
            const staged = cloneState(state);
            try {
                const result = await work({
                    ...repositories,
                    transaction: { state: staged }
                });
                state = staged;
                return result;
            } finally {
                release();
            }
        }
    };

    return {
        persistence: repositories,
        seedWallet(userId, balanceMinor, currency = 'USD') {
            state.wallets.set(userId, { balanceMinor, currency });
        },
        wallet(userId) {
            return clone(state.wallets.get(userId) || null);
        },
        ledger(matchId) {
            return [...state.ledger.values()]
                .filter((entry) => entry.matchId === matchId)
                .map(clone);
        },
        outbox() {
            return [...state.outbox.values()].map(clone);
        },
        match(matchId) {
            return clone(state.matches.get(matchId) || null);
        },
        forceMatch(matchId, patch) {
            const current = state.matches.get(matchId);
            state.matches.set(matchId, { ...current, ...clone(patch) });
        },
        corruptLedger(matchId, entryId) {
            state.ledger.delete(entryId);
            return matchId;
        },
        failNextWalletUpdate(userId) {
            failNextWalletUpdateFor = userId;
        }
    };
}

const POLICY = Object.freeze({
    version: 'paid-v1',
    mode: 'PAID',
    currency: 'USD',
    stakeMinor: 1000,
    houseFeeBps: 1000,
    houseAccountId: 'house',
    escrowAccountId: 'escrow',
    allowNegativeBalance: false,
    processingLeaseMs: 100
});

let idSequence = 0;
let now = 1000;

function makeService(memory, policy = POLICY) {
    return createEconomyService({
        persistence: memory.persistence,
        policies: { [policy.version]: policy },
        clock: () => now,
        idFactory: () => `generated-${++idSequence}`
    });
}

function resultFor(matchId = 'match-1') {
    return {
        schemaVersion: 1,
        resultId: `result-${matchId}`,
        matchId,
        rulesVersion: 'v2',
        startedAt: 1,
        finishedAt: 2,
        finishReason: 'LAST_PLAYER',
        participants: [
            {
                actorId: 'winner',
                teamId: null,
                status: 'COMPLETED',
                statistics: { score: 10, kills: 1, deaths: 0 }
            },
            {
                actorId: 'loser',
                teamId: null,
                status: 'ELIMINATED',
                statistics: { score: 2, kills: 0, deaths: 1 }
            }
        ],
        rankings: [
            { rank: 1, actorIds: ['winner'], teamId: null },
            { rank: 2, actorIds: ['loser'], teamId: null }
        ],
        teams: [],
        statistics: { durationMs: 1 },
        resultHash: 'a'.repeat(64)
    };
}

async function createReadyMatch(matchId = 'match-1') {
    const memory = makeMemoryPersistence();
    memory.seedWallet('winner', 5000);
    memory.seedWallet('loser', 5000);
    memory.seedWallet('escrow', 0);
    memory.seedWallet('house', 0);
    const service = makeService(memory);
    assert.strictEqual((await service.openPaidMatch({
        matchId,
        policyVersion: POLICY.version
    })).ok, true);
    const winnerEntry = await service.registerStake({
        matchId,
        userId: 'winner',
        idempotencyKey: `${matchId}-winner-stake`
    });
    const loserEntry = await service.registerStake({
        matchId,
        userId: 'loser',
        idempotencyKey: `${matchId}-loser-stake`
    });
    assert.strictEqual(winnerEntry.ok, true);
    assert.strictEqual(loserEntry.ok, true);
    memory.forceMatch(matchId, {
        status: 'RESULT_LOCKED',
        resultVersion: 'result-v1',
        result: resultFor(matchId)
    });
    return { memory, service };
}

async function run() {
    now = 1000;
    idSequence = 0;
    assert.deepStrictEqual(SETTLEMENT_STATUSES, [
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED_RETRYABLE',
        'FAILED_FINAL'
    ]);
    assert.throws(() => createEconomyService({
        persistence: makeMemoryPersistence().persistence,
        policies: {
            bad: { ...POLICY, version: 'bad', stakeMinor: 0 }
        }
    }), /Invalid Economy policy/);

    // Paid match creation and idempotent, one-time stake debit.
    {
        const memory = makeMemoryPersistence();
        memory.seedWallet('winner', 5000);
        memory.seedWallet('loser', 5000);
        memory.seedWallet('escrow', 0);
        memory.seedWallet('house', 0);
        const service = makeService(memory);
        assert.strictEqual((await service.openPaidMatch({
            matchId: 'entry-match',
            policyVersion: 'paid-v1'
        })).ok, true);
        assert.strictEqual((await service.openPaidMatch({
            matchId: 'entry-match',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.MATCH_ALREADY_EXISTS);
        const request = {
            matchId: 'entry-match',
            userId: 'winner',
            idempotencyKey: 'entry-once'
        };
        const first = await service.registerStake(request);
        const repeated = await service.registerStake(request);
        assert.strictEqual(first.ok, true);
        assert.deepStrictEqual(repeated, first);
        assert.strictEqual(memory.wallet('winner').balanceMinor, 4000);
        assert.strictEqual(memory.wallet('escrow').balanceMinor, 1000);
        assert.strictEqual(memory.ledger('entry-match').length, 2);
        assert.strictEqual((await service.registerStake({
            ...request,
            idempotencyKey: 'second-key'
        })).error.code, ECONOMY_ERRORS.DUPLICATE_ENTRY);
        assert.strictEqual((await service.registerStake({
            ...request,
            amountMinor: 0
        })).error.code, ECONOMY_ERRORS.INVALID_REQUEST);
        assert.strictEqual((await service.registerStake({
            ...request,
            idempotencyKey: 'conflicting',
            userId: 'loser'
        })).ok, true);
    }

    // Stake validation covers insufficient funds and currency mismatch.
    {
        const memory = makeMemoryPersistence();
        memory.seedWallet('poor', 999);
        memory.seedWallet('escrow', 0);
        memory.seedWallet('house', 0);
        const service = makeService(memory);
        await service.openPaidMatch({ matchId: 'poor-match', policyVersion: 'paid-v1' });
        assert.strictEqual((await service.registerStake({
            matchId: 'poor-match',
            userId: 'poor',
            idempotencyKey: 'poor-stake'
        })).error.code, ECONOMY_ERRORS.INSUFFICIENT_FUNDS);

        const wrongCurrency = makeMemoryPersistence();
        wrongCurrency.seedWallet('poor', 5000, 'EUR');
        wrongCurrency.seedWallet('escrow', 0);
        wrongCurrency.seedWallet('house', 0);
        const wrongCurrencyService = makeService(wrongCurrency);
        await wrongCurrencyService.openPaidMatch({
            matchId: 'currency-match',
            policyVersion: 'paid-v1'
        });
        assert.strictEqual((await wrongCurrencyService.registerStake({
            matchId: 'currency-match',
            userId: 'poor',
            idempotencyKey: 'currency-stake'
        })).error.code, ECONOMY_ERRORS.CURRENCY_MISMATCH);
    }

    // Settlement uses only the persisted locked MatchResult, policy and paid entries.
    {
        const { memory, service } = await createReadyMatch();
        const beforeLedger = memory.ledger('match-1').length;
        const prepared = await service.prepareSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        });
        assert.strictEqual(prepared.ok, true);
        assert.strictEqual(prepared.settlement.status, 'PENDING');
        const settled = await service.settleMatch({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        });
        assert.strictEqual(settled.ok, true);
        assert.strictEqual(settled.settlement.status, 'COMPLETED');
        assert.strictEqual(settled.settlement.totalPotMinor, 2000);
        assert.strictEqual(settled.settlement.houseFeeMinor, 200);
        assert.strictEqual(settled.settlement.prizePoolMinor, 1800);
        assert.deepStrictEqual(settled.settlement.payouts, [
            { userId: 'winner', amountMinor: 1800 }
        ]);
        assert.strictEqual(memory.wallet('winner').balanceMinor, 5800);
        assert.strictEqual(memory.wallet('loser').balanceMinor, 4000);
        assert.strictEqual(memory.wallet('house').balanceMinor, 200);
        assert.strictEqual(memory.wallet('escrow').balanceMinor, 0);
        assert.strictEqual(memory.ledger('match-1').length, beforeLedger + 3);
        assert.strictEqual(memory.outbox().filter((event) =>
            event.type === 'EconomySettlementCompleted').length, 1);

        const completedLedger = memory.ledger('match-1');
        const duplicate = await service.settleMatch({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        });
        assert.deepStrictEqual(duplicate, settled);
        assert.deepStrictEqual(memory.ledger('match-1'), completedLedger);
        assert.strictEqual(memory.wallet('winner').balanceMinor, 5800);
        memory.forceMatch('match-1', {
            result: { ...resultFor('match-1'), resultHash: 'b'.repeat(64) }
        });
        assert.strictEqual((await service.settleMatch({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
        memory.forceMatch('match-1', { result: resultFor('match-1') });

        const reconciliation = await service.reconcileSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1'
        });
        assert.deepStrictEqual(reconciliation.findings, []);
        const completed = memory.match('match-1').economy.settlements['result-v1'];
        assert.strictEqual('update' in memory.persistence.LedgerRepository, false);
        assert.strictEqual('delete' in memory.persistence.LedgerRepository, false);
        assert.throws(() => memory.persistence.LedgerRepository.update('some-id', {}), TypeError);
        await assert.rejects(memory.persistence.runInTransaction(async (tx) => {
            await tx.LedgerRepository.append(completed.ledgerEntries[0], tx.transaction);
        }), /immutable ledger duplicate/);
        const feeEntry = completed.ledgerEntries.find((entry) => entry.type === 'HOUSE_FEE');
        memory.corruptLedger('match-1', feeEntry.entryId);
        const corrupted = await service.reconcileSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1'
        });
        assert.ok(corrupted.findings.includes('COMPLETED_WITHOUT_EXPECTED_LEDGER'));
        assert.ok(corrupted.findings.includes('HOUSE_FEE_MISMATCH'));
    }

    // A transient settlement failure is durable/retryable; retry credits exactly once.
    {
        const { memory, service } = await createReadyMatch('retry-match');
        memory.failNextWalletUpdate('winner');
        const request = {
            matchId: 'retry-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        };
        const failed = await service.settleMatch(request);
        assert.strictEqual(failed.ok, false);
        assert.strictEqual(failed.error.status, 'FAILED_RETRYABLE');
        assert.strictEqual(memory.match('retry-match')
            .economy.settlements['result-v1'].status, 'FAILED_RETRYABLE');
        assert.strictEqual(memory.wallet('winner').balanceMinor, 4000);
        const retried = await service.settleMatch(request);
        assert.strictEqual(retried.ok, true);
        assert.strictEqual(memory.wallet('winner').balanceMinor, 5800);
        assert.strictEqual(memory.wallet('loser').balanceMinor, 4000);
    }

    // Locked result, match association, validity, and result version are mandatory.
    {
        const wrongMatch = await createReadyMatch('wrong-result-match');
        wrongMatch.memory.forceMatch('wrong-result-match', {
            result: resultFor('different-match')
        });
        assert.strictEqual((await wrongMatch.service.settleMatch({
            matchId: 'wrong-result-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.RESULT_MATCH_MISMATCH);

        const unlocked = await createReadyMatch('unlocked-match');
        unlocked.memory.forceMatch('unlocked-match', { status: 'RUNNING' });
        assert.strictEqual((await unlocked.service.settleMatch({
            matchId: 'unlocked-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.RESULT_NOT_LOCKED);

        const invalid = await createReadyMatch('invalid-result-match');
        invalid.memory.forceMatch('invalid-result-match', {
            result: { ...resultFor('invalid-result-match'), resultHash: 'invalid' }
        });
        assert.strictEqual((await invalid.service.settleMatch({
            matchId: 'invalid-result-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.INVALID_RESULT);

        const missing = await createReadyMatch('missing-result-match');
        missing.memory.forceMatch('missing-result-match', { result: null });
        assert.strictEqual((await missing.service.settleMatch({
            matchId: 'missing-result-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.INVALID_RESULT);

        const mismatchedRoster = await createReadyMatch('roster-mismatch-match');
        const mismatchedMatch = mismatchedRoster.memory.match('roster-mismatch-match');
        mismatchedRoster.memory.forceMatch('roster-mismatch-match', {
            economy: {
                ...mismatchedMatch.economy,
                entries: {
                    ...mismatchedMatch.economy.entries,
                    outsider: {
                        userId: 'outsider',
                        ledgerEntryId: 'untrusted-entry',
                        stakeMinor: POLICY.stakeMinor,
                        currency: POLICY.currency
                    }
                }
            }
        });
        assert.strictEqual((await mismatchedRoster.service.settleMatch({
            matchId: 'roster-mismatch-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.PARTICIPANT_ENTRY_MISMATCH);

        const wrongVersion = await createReadyMatch('wrong-version-match');
        assert.strictEqual((await wrongVersion.service.settleMatch({
            matchId: 'wrong-version-match',
            settlementVersion: 'other-version',
            policyVersion: 'paid-v1'
        })).error.code, ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
    }

    // A missing escrow balance is not paid; it leaves a retryable, durable failure.
    {
        const { memory, service } = await createReadyMatch('empty-escrow-match');
        memory.forceMatch('empty-escrow-match', {
            economy: {
                ...memory.match('empty-escrow-match').economy,
                entries: {
                    ...memory.match('empty-escrow-match').economy.entries
                }
            }
        });
        memory.seedWallet('escrow', 0);
        const failed = await service.settleMatch({
            matchId: 'empty-escrow-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        });
        assert.strictEqual(failed.error.code, ECONOMY_ERRORS.INSUFFICIENT_FUNDS);
        assert.strictEqual(failed.error.status, 'FAILED_RETRYABLE');
        assert.strictEqual(memory.wallet('winner').balanceMinor, 4000);
    }

    // Malformed durable stake data fails permanently without releasing a payout.
    {
        const { memory, service } = await createReadyMatch('invalid-stake-match');
        const current = memory.match('invalid-stake-match');
        memory.forceMatch('invalid-stake-match', {
            economy: {
                ...current.economy,
                entries: {
                    ...current.economy.entries,
                    winner: { ...current.economy.entries.winner, stakeMinor: 0 }
                }
            }
        });
        const failed = await service.settleMatch({
            matchId: 'invalid-stake-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        });
        assert.strictEqual(failed.error.code, ECONOMY_ERRORS.INVALID_STAKE);
        assert.strictEqual(failed.error.status, 'FAILED_FINAL');
        assert.strictEqual(memory.wallet('winner').balanceMinor, 4000);
    }

    // Client-provided winner, payout, amount, or balance can never influence settlement.
    {
        const { memory, service } = await createReadyMatch('forgery-match');
        assert.strictEqual((await service.settleMatch({
            matchId: 'forgery-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1',
            winnerId: 'loser'
        })).error.code, ECONOMY_ERRORS.INVALID_REQUEST);
        assert.strictEqual((await service.settleMatch({
            matchId: 'forgery-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1',
            payoutMinor: 1
        })).error.code, ECONOMY_ERRORS.INVALID_REQUEST);
        assert.strictEqual((await service.registerStake({
            matchId: 'forgery-match',
            userId: 'loser',
            idempotencyKey: 'forged-stake',
            amountMinor: -1,
            balanceMinor: 999999
        })).error.code, ECONOMY_ERRORS.INVALID_REQUEST);
        assert.strictEqual(memory.wallet('loser').balanceMinor, 4000);
    }

    // Concurrent duplicate requests serialize through the persistence transaction port.
    {
        const { memory, service } = await createReadyMatch('concurrent-match');
        const request = {
            matchId: 'concurrent-match',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1'
        };
        const results = await Promise.all([
            service.settleMatch(request),
            service.settleMatch(request)
        ]);
        assert.strictEqual(results.filter((result) => result.ok).length, 1);
        assert.strictEqual(results.filter((result) =>
            result.error?.code === ECONOMY_ERRORS.SETTLEMENT_IN_PROGRESS).length, 1);
        const completed = await service.settleMatch(request);
        assert.strictEqual(completed.ok, true);
        assert.strictEqual(memory.wallet('winner').balanceMinor, 5800);
        assert.strictEqual(memory.wallet('loser').balanceMinor, 4000);
        const match = memory.match('concurrent-match');
        assert.strictEqual(match.economy.settlements['result-v1'].attempts, 1);
        assert.strictEqual(memory.ledger('concurrent-match')
            .filter((entry) => entry.type === 'MATCH_PRIZE').length, 1);
    }

    console.log('OK economy v2: exact-money stakes, validated results, transactional idempotent settlement and reconciliation.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
