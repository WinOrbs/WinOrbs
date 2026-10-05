'use strict';

const assert = require('assert');
const {
    SETTLEMENT_ERRORS,
    createSettlementService
} = require('../packages/settlement/v2');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validResult(matchId = 'match-1') {
    return {
        schemaVersion: 1,
        resultId: `result-${matchId}`,
        matchId,
        rulesVersion: 'v2',
        startedAt: 1,
        finishedAt: 2,
        finishReason: 'LAST_PLAYER',
        participants: [{
            actorId: 'winner',
            teamId: null,
            status: 'COMPLETED',
            statistics: { score: 1, kills: 1, deaths: 0 }
        }],
        rankings: [{ rank: 1, actorIds: ['winner'], teamId: null }],
        teams: [],
        statistics: { durationMs: 1 },
        resultHash: 'a'.repeat(64)
    };
}

function lockedMatch(matchId = 'match-1', overrides = {}) {
    const result = validResult(matchId);
    return {
        matchId,
        status: 'RESULT_LOCKED',
        resultVersion: 'result-v1',
        result,
        economy: {
            mode: 'PAID',
            policyVersion: 'paid-v1',
            entries: { winner: { userId: 'winner' } },
            settlements: {},
            ...overrides.economy
        },
        ...overrides,
        result: overrides.result === undefined ? result : overrides.result
    };
}

function makePersistence(matchRecords = []) {
    const matches = new Map(matchRecords.filter(Boolean)
        .map((match) => [match.matchId, clone(match)]));
    const audits = new Map();
    const ledgers = new Map();
    const wallets = new Map();
    const settlements = new Map();
    const outbox = new Map();
    const noOp = async () => null;
    const persistence = {
        UserRepository: { getById: noOp, create: noOp, update: noOp },
        WalletRepository: {
            getByUserId: noOp,
            create: noOp,
            update: noOp
        },
        LedgerRepository: {
            getById: noOp,
            listByMatch: async (matchId) => [...ledgers.values()]
                .filter((item) => item.matchId === matchId).map(clone),
            append: async (entry) => {
                if (ledgers.has(entry.entryId)) throw new Error('duplicate ledger entry');
                ledgers.set(entry.entryId, clone(entry));
            }
        },
        MatchRepository: {
            getById: async (id) => clone(matches.get(id) || null),
            create: async (id, value) => matches.set(id, clone(value)),
            update: async (id, patch) => {
                if (!matches.has(id)) throw new Error('missing match');
                matches.set(id, { ...matches.get(id), ...clone(patch) });
            },
            claimSettlement: async (matchId, version, value) => {
                const key = `${matchId}:${version}`;
                if (settlements.has(key)) {
                    return { claimed: false, settlement: clone(settlements.get(key)) };
                }
                settlements.set(key, clone(value));
                return { claimed: true, settlement: clone(value) };
            }
        },
        InventoryRepository: { getByUserId: noOp, replaceForUser: noOp },
        ProgressionRepository: { getByUserId: noOp, replaceForUser: noOp },
        RewardRepository: { getById: noOp, create: noOp, update: noOp },
        PaymentRepository: { getById: noOp, create: noOp, update: noOp },
        AuditRepository: {
            append: async (entry) => {
                if (audits.has(entry.entryId)) throw new Error('duplicate audit');
                audits.set(entry.entryId, clone(entry));
            },
            listByAggregate: async (aggregateId) => [...audits.values()]
                .filter((entry) => entry.aggregateId === aggregateId).map(clone)
        },
        IdempotencyRepository: { getByKey: noOp, claim: noOp },
        OutboxRepository: {
            getById: noOp,
            enqueue: async (entry) => outbox.set(entry.eventId, clone(entry)),
            listPending: async () => [],
            markPublished: noOp
        },
        async runInTransaction(work) {
            const stagedMatches = new Map([...matches].map(([key, value]) => [key, clone(value)]));
            const stagedAudits = new Map([...audits].map(([key, value]) => [key, clone(value)]));
            const stagedLedgers = new Map([...ledgers].map(([key, value]) => [key, clone(value)]));
            const stagedOutbox = new Map([...outbox].map(([key, value]) => [key, clone(value)]));
            const stagedSettlements = new Map([...settlements]
                .map(([key, value]) => [key, clone(value)]));
            const tx = {
                ...persistence,
                MatchRepository: {
                    ...persistence.MatchRepository,
                    getById: async (id) => clone(stagedMatches.get(id) || null),
                    create: async (id, value) => {
                        if (stagedMatches.has(id)) throw new Error('duplicate match');
                        stagedMatches.set(id, clone(value));
                    },
                    update: async (id, patch) => {
                        if (!stagedMatches.has(id)) throw new Error('missing match');
                        stagedMatches.set(id, {
                            ...stagedMatches.get(id),
                            ...clone(patch)
                        });
                    },
                    claimSettlement: async (matchId, version, value) => {
                        const key = `${matchId}:${version}`;
                        if (stagedSettlements.has(key)) {
                            return {
                                claimed: false,
                                settlement: clone(stagedSettlements.get(key))
                            };
                        }
                        stagedSettlements.set(key, clone(value));
                        return { claimed: true, settlement: clone(value) };
                    }
                },
                AuditRepository: {
                    ...persistence.AuditRepository,
                    append: async (entry) => {
                        if (stagedAudits.has(entry.entryId)) throw new Error('duplicate audit');
                        stagedAudits.set(entry.entryId, clone(entry));
                    },
                    listByAggregate: async (aggregateId) => [...stagedAudits.values()]
                        .filter((entry) => entry.aggregateId === aggregateId).map(clone)
                },
                LedgerRepository: {
                    ...persistence.LedgerRepository,
                    append: async (entry) => {
                        if (stagedLedgers.has(entry.entryId)) throw new Error('duplicate ledger');
                        stagedLedgers.set(entry.entryId, clone(entry));
                    }
                },
                OutboxRepository: {
                    ...persistence.OutboxRepository,
                    enqueue: async (entry) => stagedOutbox.set(entry.eventId, clone(entry))
                },
                transaction: {}
            };
            const result = await work(tx);
            matches.clear();
            for (const [key, value] of stagedMatches) matches.set(key, value);
            audits.clear();
            for (const [key, value] of stagedAudits) audits.set(key, value);
            ledgers.clear();
            for (const [key, value] of stagedLedgers) ledgers.set(key, value);
            outbox.clear();
            for (const [key, value] of stagedOutbox) outbox.set(key, value);
            settlements.clear();
            for (const [key, value] of stagedSettlements) settlements.set(key, value);
            return result;
        }
    };
    return {
        persistence,
        getMatch: (id) => clone(matches.get(id) || null),
        setMatch: (id, value) => matches.set(id, clone(value)),
        audits: () => [...audits.values()].map(clone),
        ledgers: () => [...ledgers.values()].map(clone),
        addLedger: (entry) => ledgers.set(entry.entryId, clone(entry)),
        wallets,
        outbox,
        addOutbox: (entry) => outbox.set(entry.eventId, clone(entry))
    };
}

function makeEconomy(memory, { reconcileFindings = [], failures = [] } = {}) {
    let sequence = 0;
    let active = false;
    const calls = { prepare: 0, settle: 0, reconcile: 0 };
    return {
        calls,
        async prepareSettlement(request) {
            calls.prepare += 1;
            const match = memory.getMatch(request.matchId);
            if (!match) return { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
            if (match.status !== 'RESULT_LOCKED') {
                return { ok: false, error: { code: 'RESULT_NOT_LOCKED' } };
            }
            if (!match.economy || match.economy.policyVersion !== request.policyVersion) {
                return { ok: false, error: { code: 'INVALID_POLICY' } };
            }
            const current = match.economy.settlements[request.settlementVersion];
            if (current?.status === 'COMPLETED') return { ok: true, settlement: current };
            if (current?.status === 'FAILED_FINAL') {
                return { ok: false, error: { code: 'SETTLEMENT_FINAL' } };
            }
            const pending = {
                settlementId: `sid-${request.matchId}-${request.settlementVersion}`,
                matchId: request.matchId,
                settlementVersion: request.settlementVersion,
                policyVersion: request.policyVersion,
                resultId: match.result.resultId,
                resultHash: match.result.resultHash,
                status: 'PENDING',
                attempts: current?.attempts || 0
            };
            memory.setMatch(request.matchId, {
                ...match,
                economy: {
                    ...match.economy,
                    settlements: {
                        ...match.economy.settlements,
                        [request.settlementVersion]: pending
                    }
                }
            });
            return { ok: true, settlement: pending };
        },
        async settleMatch(request) {
            calls.settle += 1;
            if (active) return { ok: false, error: { code: 'SETTLEMENT_IN_PROGRESS' } };
            active = true;
            try {
                await Promise.resolve();
                const match = memory.getMatch(request.matchId);
                const current = match.economy.settlements[request.settlementVersion];
                const failMode = failures.shift();
                if (failMode) {
                    const status = failMode === 'final'
                        ? 'FAILED_FINAL'
                        : 'FAILED_RETRYABLE';
                    memory.setMatch(request.matchId, {
                        ...match,
                        economy: {
                            ...match.economy,
                            settlements: {
                                ...match.economy.settlements,
                                [request.settlementVersion]: {
                                    ...current,
                                    status,
                                    attempts: (current.attempts || 0) + 1
                                }
                            }
                        }
                    });
                    return {
                        ok: false,
                        error: {
                            code: failMode === 'final'
                                ? 'SETTLEMENT_FINAL'
                                : 'PERSISTENCE_ERROR'
                        }
                    };
                }
                if (current.status === 'COMPLETED') {
                    return { ok: true, settlement: current };
                }
                const settlement = {
                    ...current,
                    status: 'COMPLETED',
                    attempts: (current.attempts || 0) + 1,
                    completedAt: 100,
                    payouts: [{ userId: 'winner', amountMinor: 900 }],
                    houseFeeMinor: 100,
                    prizePoolMinor: 900
                };
                memory.setMatch(request.matchId, {
                    ...match,
                    economy: {
                        ...match.economy,
                        settlements: {
                            ...match.economy.settlements,
                            [request.settlementVersion]: settlement
                        }
                    }
                });
                memory.addLedger({ entryId: `ledger-${++sequence}`, matchId: request.matchId });
                memory.addOutbox({
                    eventId: `settlement-completed-${request.matchId}`,
                    type: 'EconomySettlementCompleted',
                    matchId: request.matchId
                });
                memory.wallets.set('effects', (memory.wallets.get('effects') || 0) + 1);
                return { ok: true, settlement };
            } finally {
                active = false;
            }
        },
        async reconcileSettlement() {
            calls.reconcile += 1;
            return { ok: true, findings: [...reconcileFindings] };
        }
    };
}

const CONTEXT = Object.freeze({ system: true });
const BASE_REQUEST = Object.freeze({
    matchId: 'match-1',
    resultId: 'result-match-1',
    resultVersion: 'result-v1',
    settlementVersion: 'result-v1',
    policyVersion: 'paid-v1',
    systemContext: CONTEXT
});

function makeHarness({
    match = lockedMatch(),
    authorize = async (context) => context === CONTEXT,
    reconcileFindings,
    failures
} = {}) {
    const memory = makePersistence([match]);
    const economy = makeEconomy(memory, { reconcileFindings, failures });
    const service = createSettlementService({
        economy,
        persistence: memory.persistence,
        authorizeSystem: authorize,
        clock: () => 100
    });
    return { memory, economy, service };
}

async function run() {
    {
        const { memory, economy, service } = makeHarness();
        const originalResult = clone(memory.getMatch('match-1').result);
        const settled = await service.settle(BASE_REQUEST);
        assert.strictEqual(settled.ok, true);
        assert.strictEqual(settled.data.status, 'COMPLETED');
        assert.strictEqual(settled.data.matchId, 'match-1');
        assert.strictEqual(settled.data.settlementVersion, 'result-v1');
        assert.strictEqual(settled.data.policyVersion, 'paid-v1');
        assert.strictEqual(economy.calls.settle, 1);
        assert.deepStrictEqual(memory.getMatch('match-1').result, originalResult);
        assert.deepStrictEqual(memory.audits().map((entry) => entry.type).sort(), [
            'settlement.completed',
            'settlement.started'
        ]);
        assert.strictEqual([...memory.outbox.values()].filter((event) =>
            event.type === 'EconomySettlementCompleted').length, 1);
    }

    // Missing, unlocked, invalid, mismatched and stale result evidence fails before Economy.
    {
        const missing = makeHarness({ match: null });
        assert.strictEqual((await missing.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.MATCH_NOT_FOUND);
        assert.strictEqual(missing.economy.calls.settle, 0);

        const unlockedMatch = lockedMatch();
        unlockedMatch.status = 'RUNNING';
        const unlocked = makeHarness({ match: unlockedMatch });
        assert.strictEqual((await unlocked.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.RESULT_NOT_LOCKED);
        assert.strictEqual(unlocked.economy.calls.settle, 0);

        const wrongResult = makeHarness({
            match: lockedMatch('match-1', { result: validResult('another-match') })
        });
        assert.strictEqual((await wrongResult.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.RESULT_MATCH_MISMATCH);

        const wrongVersion = makeHarness({
            match: lockedMatch('match-1', { resultVersion: 'other-version' })
        });
        assert.strictEqual((await wrongVersion.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.RESULT_VERSION_MISMATCH);

        const wrongPolicy = makeHarness({
            match: lockedMatch('match-1', {
                economy: { ...lockedMatch().economy, policyVersion: 'other-policy' }
            })
        });
        assert.strictEqual((await wrongPolicy.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.POLICY_MISMATCH);

        const invalidResult = validResult();
        invalidResult.participants[0].actorId = '';
        const invalid = makeHarness({
            match: lockedMatch('match-1', { result: invalidResult })
        });
        assert.strictEqual((await invalid.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.INVALID_RESULT);

        const absentResult = makeHarness({
            match: lockedMatch('match-1', { result: null })
        });
        assert.strictEqual((await absentResult.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.INVALID_RESULT);
    }

    // A completed settlement is returned as-is without calling Economy again.
    {
        const completed = {
            settlementId: 'settled-once',
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1',
            resultId: 'result-match-1',
            resultHash: 'a'.repeat(64),
            status: 'COMPLETED',
            payouts: [{ userId: 'winner', amountMinor: 900 }]
        };
        const match = lockedMatch('match-1', {
            economy: {
                ...lockedMatch().economy,
                settlements: { 'result-v1': completed }
            }
        });
        const { service, economy, memory } = makeHarness({ match });
        const result = await service.settle(BASE_REQUEST);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.data.settlementId, 'settled-once');
        assert.strictEqual(economy.calls.settle, 0);
        assert.strictEqual(memory.audits().length, 0);
    }

    // PROCESSING lease gates live work and allows safe delegated retry after expiry.
    {
        const liveMatch = lockedMatch('match-1', {
            economy: {
                ...lockedMatch().economy,
                settlements: {
                    'result-v1': {
                        settlementId: 'live',
                        matchId: 'match-1',
                        settlementVersion: 'result-v1',
                        policyVersion: 'paid-v1',
                        resultId: 'result-match-1',
                        resultHash: 'a'.repeat(64),
                        status: 'PROCESSING',
                        attempts: 1,
                        leaseUntil: 101
                    }
                }
            }
        });
        const live = makeHarness({ match: liveMatch });
        assert.strictEqual((await live.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.SETTLEMENT_IN_PROGRESS);
        assert.strictEqual(live.economy.calls.settle, 0);

        const expiredMatch = lockedMatch('match-1', {
            economy: {
                ...lockedMatch().economy,
                settlements: {
                    'result-v1': {
                        settlementId: 'expired',
                        matchId: 'match-1',
                        settlementVersion: 'result-v1',
                        policyVersion: 'paid-v1',
                        resultId: 'result-match-1',
                        resultHash: 'a'.repeat(64),
                        status: 'PROCESSING',
                        attempts: 1,
                        leaseUntil: 99
                    }
                }
            }
        });
        const expired = makeHarness({ match: expiredMatch });
        const retry = await expired.service.retrySettlement(BASE_REQUEST);
        assert.strictEqual(retry.ok, true);
        assert.strictEqual(retry.data.status, 'COMPLETED');
        assert.ok(expired.memory.audits().some((entry) => entry.type === 'settlement.retry'));
    }

    // Retryable and final errors map to durable states; completed retries do not duplicate effects.
    {
        const retryable = makeHarness({ failures: ['retryable'] });
        const first = await retryable.service.settle(BASE_REQUEST);
        assert.strictEqual(first.ok, false);
        assert.strictEqual(first.error.code, SETTLEMENT_ERRORS.ECONOMY_OPERATION_FAILED);
        const stored = retryable.memory.getMatch('match-1')
            .economy.settlements['result-v1'];
        assert.strictEqual(stored.status, 'FAILED_RETRYABLE');
        assert.ok(retryable.memory.audits().some((entry) => entry.type === 'settlement.failed'));
        const second = await retryable.service.retrySettlement(BASE_REQUEST);
        assert.strictEqual(second.ok, true);
        assert.strictEqual(retryable.memory.wallets.get('effects'), 1);
        assert.strictEqual(retryable.memory.ledgers().length, 1);

        const final = makeHarness({ failures: ['final'] });
        const finalResponse = await final.service.settle(BASE_REQUEST);
        assert.strictEqual(finalResponse.error.code, SETTLEMENT_ERRORS.SETTLEMENT_FINAL);
        assert.strictEqual(final.memory.getMatch('match-1')
            .economy.settlements['result-v1'].status, 'FAILED_FINAL');
        assert.strictEqual((await final.service.retrySettlement(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.SETTLEMENT_FINAL);
        assert.strictEqual((await final.service.settle({
            ...BASE_REQUEST,
            settlementVersion: 'other-version',
            resultVersion: 'other-version'
        })).error.code, SETTLEMENT_ERRORS.RESULT_VERSION_MISMATCH);
        assert.strictEqual(final.economy.calls.settle, 1);
    }

    // Concurrent requests delegate to one Economy execution and never duplicate effects.
    {
        const { service, economy, memory } = makeHarness();
        const results = await Promise.all([
            service.settle(BASE_REQUEST),
            service.settle(BASE_REQUEST)
        ]);
        assert.strictEqual(results.filter((result) => result.ok).length, 1);
        assert.strictEqual(economy.calls.settle, 2);
        assert.strictEqual(memory.wallets.get('effects'), 1);
        assert.strictEqual(memory.ledgers().length, 1);
        const later = await service.retrySettlement(BASE_REQUEST);
        assert.strictEqual(later.ok, true);
        assert.strictEqual(memory.wallets.get('effects'), 1);
        assert.strictEqual(memory.ledgers().length, 1);
    }

    // Invalid state and authorization fail closed.
    {
        const badStateMatch = lockedMatch('match-1', {
            economy: {
                ...lockedMatch().economy,
                settlements: {
                    'result-v1': {
                        status: 'UNRECOGNIZED',
                        policyVersion: 'paid-v1',
                        resultId: 'result-match-1',
                        resultHash: 'a'.repeat(64)
                    }
                }
            }
        });
        const invalidState = makeHarness({ match: badStateMatch });
        assert.strictEqual((await invalidState.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
        const unauthorized = makeHarness({
            authorize: async () => false
        });
        assert.strictEqual((await unauthorized.service.settle(BASE_REQUEST)).error.code,
            SETTLEMENT_ERRORS.AUTHORIZATION_DENIED);
        assert.strictEqual(unauthorized.economy.calls.settle, 0);
    }

    // Caller-controlled winner, payout, amount, or policy overrides are rejected.
    {
        const { service, economy } = makeHarness();
        for (const extra of [
            { winner: 'loser' },
            { payout: 1 },
            { amount: 1 }
        ]) {
            assert.strictEqual((await service.settle({
                ...BASE_REQUEST,
                ...extra
            })).error.code, SETTLEMENT_ERRORS.INVALID_REQUEST);
        }
        assert.strictEqual((await service.settle({
            ...BASE_REQUEST,
            policyVersion: 'attacker-policy'
        })).error.code, SETTLEMENT_ERRORS.POLICY_MISMATCH);
        assert.strictEqual(economy.calls.settle, 0);
    }

    // Reconciliation reports missing, expired, retryable and inconsistent records.
    {
        const absent = lockedMatch();
        const absentHarness = makeHarness({ match: absent });
        const noSettlement = await absentHarness.service.reconcileSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            policyVersion: 'paid-v1',
            systemContext: CONTEXT
        });
        assert.ok(noSettlement.data.findings.includes('LOCKED_RESULT_WITHOUT_SETTLEMENT'));

        for (const status of ['PROCESSING', 'FAILED_RETRYABLE']) {
            const record = {
                settlementId: 'diag-id',
                matchId: 'match-1',
                settlementVersion: 'result-v1',
                policyVersion: 'wrong-policy',
                resultId: 'wrong-result',
                resultHash: 'b'.repeat(64),
                status,
                attempts: 1,
                leaseUntil: 99
            };
            const match = lockedMatch('match-1', {
                economy: {
                    ...lockedMatch().economy,
                    settlements: { 'result-v1': record }
                }
            });
            const harness = makeHarness({
                match,
                reconcileFindings: ['COMPLETED_WITHOUT_EXPECTED_LEDGER']
            });
            const diagnosis = await harness.service.reconcileSettlement({
                matchId: 'match-1',
                settlementVersion: 'result-v1',
                policyVersion: 'paid-v1',
                systemContext: CONTEXT
            });
            if (status === 'PROCESSING') {
                assert.ok(diagnosis.data.findings.includes('PROCESSING_LEASE_EXPIRED'));
            } else {
                assert.ok(diagnosis.data.findings.includes('RETRYABLE_SETTLEMENT_READY'));
            }
            assert.ok(diagnosis.data.findings.includes('SETTLEMENT_POLICY_VERSION_MISMATCH'));
            assert.ok(diagnosis.data.findings.includes('SETTLEMENT_RESULT_MISMATCH'));
            assert.ok(diagnosis.data.findings.includes('COMPLETED_WITHOUT_EXPECTED_LEDGER'));
            assert.ok(harness.memory.audits()
                .some((entry) => entry.type === 'settlement.reconciliation_detected'));
        }
    }

    // Retrieval is system-only and returns persisted state, not process memory.
    {
        const { service } = makeHarness();
        assert.strictEqual((await service.getSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            systemContext: CONTEXT
        })).error.code, SETTLEMENT_ERRORS.SETTLEMENT_NOT_FOUND);

        const pendingMatch = lockedMatch('match-1', {
            economy: {
                ...lockedMatch().economy,
                settlements: {
                    'result-v1': {
                        settlementId: 'pending-id',
                        settlementVersion: 'result-v1',
                        policyVersion: 'paid-v1',
                        resultId: 'result-match-1',
                        resultHash: 'a'.repeat(64),
                        status: 'PENDING',
                        attempts: 0
                    }
                }
            }
        });
        const pending = makeHarness({ match: pendingMatch });
        const state = await pending.service.getSettlement({
            matchId: 'match-1',
            settlementVersion: 'result-v1',
            systemContext: CONTEXT
        });
        assert.strictEqual(state.ok, true);
        assert.strictEqual(state.data.status, 'PENDING');
    }

    console.log('OK settlement v2: system-authorized orchestration, durable-state checks, idempotent Economy delegation, audit and reconciliation.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
