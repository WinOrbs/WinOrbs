'use strict';

const crypto = require('crypto');
const { validateMatchResult } = require('../../contracts/v2/validation');
const { assertRepositories } = require('../../persistence/v2');

const SETTLEMENT_STATUSES = Object.freeze([
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL'
]);

const ECONOMY_ERRORS = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_POLICY: 'INVALID_POLICY',
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    MATCH_ALREADY_EXISTS: 'MATCH_ALREADY_EXISTS',
    ENTRY_CLOSED: 'ENTRY_CLOSED',
    DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    INVALID_STAKE: 'INVALID_STAKE',
    WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
    INVALID_RESULT: 'INVALID_RESULT',
    RESULT_NOT_LOCKED: 'RESULT_NOT_LOCKED',
    RESULT_MATCH_MISMATCH: 'RESULT_MATCH_MISMATCH',
    RESULT_VERSION_MISMATCH: 'RESULT_VERSION_MISMATCH',
    PARTICIPANT_ENTRY_MISMATCH: 'PARTICIPANT_ENTRY_MISMATCH',
    SETTLEMENT_IN_PROGRESS: 'SETTLEMENT_IN_PROGRESS',
    SETTLEMENT_FINAL: 'SETTLEMENT_FINAL',
    INVALID_SETTLEMENT_STATE: 'INVALID_SETTLEMENT_STATE',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR'
});

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, details = {}) {
    return { ok: false, error: { code, ...details } };
}

function exactKeys(value, keys) {
    return isRecord(value) &&
        Object.keys(value).every((key) => keys.includes(key)) &&
        keys.every((key) => Object.hasOwn(value, key));
}

function validId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeInteger(value) {
    return Number.isSafeInteger(value);
}

function validatePolicy(policy) {
    if (!exactKeys(policy, [
        'version',
        'mode',
        'currency',
        'stakeMinor',
        'houseFeeBps',
        'houseAccountId',
        'escrowAccountId',
        'allowNegativeBalance',
        'processingLeaseMs'
    ]) ||
        !validId(policy.version) ||
        policy.mode !== 'PAID' ||
        typeof policy.currency !== 'string' || !/^[A-Z]{3}$/.test(policy.currency) ||
        !safeInteger(policy.stakeMinor) || policy.stakeMinor <= 0 ||
        !safeInteger(policy.houseFeeBps) || policy.houseFeeBps < 0 ||
        policy.houseFeeBps > 10000 ||
        !validId(policy.houseAccountId) ||
        !validId(policy.escrowAccountId) ||
        policy.houseAccountId === policy.escrowAccountId ||
        typeof policy.allowNegativeBalance !== 'boolean' ||
        !safeInteger(policy.processingLeaseMs) || policy.processingLeaseMs < 1) {
        return false;
    }
    return true;
}

function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function participantIds(result) {
    return sortedUnique(result.participants.map((participant) => participant.actorId));
}

function winningActors(result) {
    const firstRank = Math.min(...result.rankings.map((ranking) => ranking.rank));
    return sortedUnique(result.rankings
        .filter((ranking) => ranking.rank === firstRank)
        .flatMap((ranking) => ranking.actorIds));
}

function splitMinorUnits(total, actorIds) {
    const actors = sortedUnique(actorIds);
    const each = Math.floor(total / actors.length);
    let remainder = total - each * actors.length;
    return actors.map((userId) => {
        const amountMinor = each + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        return { userId, amountMinor };
    }).filter((entry) => entry.amountMinor > 0);
}

function createEconomyService({
    persistence,
    policies,
    clock = Date.now,
    idFactory = () => crypto.randomUUID()
} = {}) {
    assertRepositories(persistence);
    if (!isRecord(policies) || typeof clock !== 'function' ||
        typeof idFactory !== 'function') {
        throw new TypeError('Versioned policies, clock, and idFactory are required');
    }

    const policyByVersion = new Map();
    for (const [version, policy] of Object.entries(policies)) {
        if (!validatePolicy(policy) || policy.version !== version) {
            throw new TypeError(`Invalid Economy policy: ${version}`);
        }
        policyByVersion.set(version, Object.freeze({ ...policy }));
    }

    function getPolicy(version) {
        const policy = policyByVersion.get(version);
        return policy || null;
    }

    function validateRequest(value, keys) {
        return exactKeys(value, keys);
    }

    async function openPaidMatch(request) {
        if (!validateRequest(request, ['matchId', 'policyVersion']) ||
            !validId(request.matchId) || !validId(request.policyVersion)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }
        const policy = getPolicy(request.policyVersion);
        if (!policy) return fail(ECONOMY_ERRORS.INVALID_POLICY);

        try {
            return await persistence.runInTransaction(async (tx) => {
                const existing = await tx.MatchRepository.getById(request.matchId, tx.transaction);
                if (existing) return fail(ECONOMY_ERRORS.MATCH_ALREADY_EXISTS);
                const record = {
                    matchId: request.matchId,
                    status: 'ENTRY_OPEN',
                    resultVersion: null,
                    result: null,
                    economy: {
                        mode: policy.mode,
                        policyVersion: policy.version,
                        currency: policy.currency,
                        stakeMinor: policy.stakeMinor,
                        entries: {},
                        settlements: {}
                    }
                };
                await tx.MatchRepository.create(request.matchId, record, tx.transaction);
                return { ok: true, match: record };
            });
        } catch {
            return fail(ECONOMY_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function registerStake(request) {
        if (!validateRequest(request, ['matchId', 'userId', 'idempotencyKey']) ||
            !validId(request.matchId) || !validId(request.userId) ||
            !validId(request.idempotencyKey)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }

        const requestHash = hash({
            operation: 'REGISTER_STAKE',
            matchId: request.matchId,
            userId: request.userId
        });
        const idemScope = `stake:${request.matchId}`;
        try {
            return await persistence.runInTransaction(async (tx) => {
                const prior = await tx.IdempotencyRepository.getByKey(
                    idemScope, request.idempotencyKey, tx.transaction
                );
                if (prior) {
                    if (prior.requestHash !== requestHash) {
                        return fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                    }
                    return prior.response;
                }

                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                if (!match) return fail(ECONOMY_ERRORS.MATCH_NOT_FOUND);
                if (match.status !== 'ENTRY_OPEN' || !isRecord(match.economy) ||
                    !isRecord(match.economy.entries)) {
                    return fail(ECONOMY_ERRORS.ENTRY_CLOSED);
                }
                const policy = getPolicy(match.economy.policyVersion);
                if (!policy || match.economy.mode !== 'PAID' ||
                    match.economy.currency !== policy.currency ||
                    match.economy.stakeMinor !== policy.stakeMinor) {
                    return fail(ECONOMY_ERRORS.INVALID_POLICY);
                }
                if (Object.hasOwn(match.economy.entries, request.userId)) {
                    return fail(ECONOMY_ERRORS.DUPLICATE_ENTRY);
                }
                if (request.userId === policy.escrowAccountId ||
                    request.userId === policy.houseAccountId) {
                    return fail(ECONOMY_ERRORS.INVALID_REQUEST);
                }

                const wallet = await tx.WalletRepository.getByUserId(
                    request.userId, tx.transaction
                );
                const escrowWallet = await tx.WalletRepository.getByUserId(
                    policy.escrowAccountId, tx.transaction
                );
                if (!wallet) return fail(ECONOMY_ERRORS.WALLET_NOT_FOUND);
                if (!escrowWallet) return fail(ECONOMY_ERRORS.WALLET_NOT_FOUND);
                if (wallet.currency !== policy.currency) {
                    return fail(ECONOMY_ERRORS.CURRENCY_MISMATCH);
                }
                if (escrowWallet.currency !== policy.currency) {
                    return fail(ECONOMY_ERRORS.CURRENCY_MISMATCH);
                }
                const participantBalanceAfterStake =
                    wallet.balanceMinor - policy.stakeMinor;
                if (!safeInteger(wallet.balanceMinor) ||
                    !safeInteger(participantBalanceAfterStake) ||
                    (!policy.allowNegativeBalance &&
                        wallet.balanceMinor < policy.stakeMinor) ||
                    !safeInteger(escrowWallet.balanceMinor) ||
                    !safeInteger(escrowWallet.balanceMinor + policy.stakeMinor)) {
                    return fail(ECONOMY_ERRORS.INSUFFICIENT_FUNDS);
                }

                const entryId = idFactory();
                const now = clock();
                if (!validId(entryId) || !Number.isSafeInteger(now) || now < 0) {
                    return fail(ECONOMY_ERRORS.INVALID_REQUEST);
                }
                const ledgerEntry = {
                    entryId,
                    userId: request.userId,
                    matchId: request.matchId,
                    settlementId: null,
                    type: 'MATCH_STAKE',
                    amountMinor: policy.stakeMinor,
                    currency: policy.currency,
                    direction: 'DEBIT',
                    timestamp: now,
                    idempotencyKey: `stake:${request.matchId}:${request.userId}`,
                    metadata: { policyVersion: policy.version },
                    policyVersion: policy.version
                };
                const escrowLedgerEntry = {
                    entryId: idFactory(),
                    userId: policy.escrowAccountId,
                    matchId: request.matchId,
                    settlementId: null,
                    type: 'MATCH_STAKE_ESCROW',
                    amountMinor: policy.stakeMinor,
                    currency: policy.currency,
                    direction: 'CREDIT',
                    timestamp: now,
                    idempotencyKey: `stake:${request.matchId}:${request.userId}:escrow`,
                    metadata: { policyVersion: policy.version },
                    policyVersion: policy.version
                };
                const nextEconomy = {
                    ...match.economy,
                    entries: {
                        ...match.economy.entries,
                        [request.userId]: {
                            userId: request.userId,
                            ledgerEntryId: entryId,
                            stakeMinor: policy.stakeMinor,
                            currency: policy.currency
                        }
                    }
                };
                const response = {
                    ok: true,
                    entry: {
                        matchId: request.matchId,
                        userId: request.userId,
                        amountMinor: policy.stakeMinor,
                        currency: policy.currency,
                        policyVersion: policy.version
                    }
                };
                const claimed = await tx.IdempotencyRepository.claim(
                    idemScope,
                    request.idempotencyKey,
                    { requestHash, response },
                    tx.transaction
                );
                if (!claimed.claimed) {
                    return claimed.record.requestHash === requestHash
                        ? claimed.record.response
                        : fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                }

                await tx.WalletRepository.update(request.userId, {
                    balanceMinor: participantBalanceAfterStake
                }, tx.transaction);
                await tx.WalletRepository.update(policy.escrowAccountId, {
                    balanceMinor: escrowWallet.balanceMinor + policy.stakeMinor
                }, tx.transaction);
                await tx.LedgerRepository.append(ledgerEntry, tx.transaction);
                await tx.LedgerRepository.append(escrowLedgerEntry, tx.transaction);
                await tx.MatchRepository.update(request.matchId, {
                    economy: nextEconomy
                }, tx.transaction);
                return response;
            });
        } catch {
            return fail(ECONOMY_ERRORS.PERSISTENCE_ERROR);
        }
    }

    function validateStoredMatchResult(match, request) {
        if (!match) return fail(ECONOMY_ERRORS.MATCH_NOT_FOUND);
        if (match.status !== 'RESULT_LOCKED') {
            return fail(ECONOMY_ERRORS.RESULT_NOT_LOCKED);
        }
        if (!isRecord(match.result)) return fail(ECONOMY_ERRORS.INVALID_RESULT);
        const validation = validateMatchResult(match.result);
        if (!validation.ok) return fail(ECONOMY_ERRORS.INVALID_RESULT);
        if (match.result.matchId !== request.matchId) {
            return fail(ECONOMY_ERRORS.RESULT_MATCH_MISMATCH);
        }
        if (match.resultVersion !== request.settlementVersion) {
            return fail(ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
        }
        if (!isRecord(match.economy) ||
            match.economy.policyVersion !== request.policyVersion ||
            match.economy.mode !== 'PAID' ||
            !isRecord(match.economy.entries) ||
            !isRecord(match.economy.settlements)) {
            return fail(ECONOMY_ERRORS.INVALID_POLICY);
        }
        const resultActors = participantIds(match.result);
        const policy = getPolicy(request.policyVersion);
        if (resultActors.includes(policy.houseAccountId) ||
            resultActors.includes(policy.escrowAccountId)) {
            return fail(ECONOMY_ERRORS.PARTICIPANT_ENTRY_MISMATCH);
        }
        const enteredActors = sortedUnique(Object.keys(match.economy.entries));
        if (JSON.stringify(resultActors) !== JSON.stringify(enteredActors)) {
            return fail(ECONOMY_ERRORS.PARTICIPANT_ENTRY_MISMATCH);
        }
        return { ok: true, result: match.result };
    }

    async function prepareSettlement(request) {
        if (!validateRequest(request, [
            'matchId', 'settlementVersion', 'policyVersion'
        ]) ||
            !validId(request.matchId) || !validId(request.settlementVersion) ||
            !validId(request.policyVersion)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }
        const policy = getPolicy(request.policyVersion);
        if (!policy) return fail(ECONOMY_ERRORS.INVALID_POLICY);
        const requestHash = hash({
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            policyVersion: request.policyVersion
        });
        const settlementId = hash([request.matchId, request.settlementVersion]);
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }
        try {
            return await persistence.runInTransaction(async (tx) => {
                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                const validated = validateStoredMatchResult(match, request);
                if (!validated.ok) return validated;
                const prior = match.economy.settlements[request.settlementVersion];
                if (prior?.requestHash && prior.requestHash !== requestHash) {
                    return fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                }
                if (prior?.resultHash &&
                    (prior.resultHash !== validated.result.resultHash ||
                        prior.resultId !== validated.result.resultId)) {
                    return fail(ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
                }
                if (prior?.status === 'COMPLETED') {
                    if (prior.resultHash !== validated.result.resultHash ||
                        prior.resultId !== validated.result.resultId) {
                        return fail(ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
                    }
                    return { ok: true, settlement: prior };
                }
                if (prior?.status === 'FAILED_FINAL') {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_FINAL);
                }
                if (prior?.status === 'PROCESSING' &&
                    Number.isSafeInteger(prior.leaseUntil) && prior.leaseUntil > now) {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_IN_PROGRESS);
                }
                if (prior?.status === 'PENDING') {
                    return { ok: true, settlement: prior };
                }

                const idem = await tx.IdempotencyRepository.claim(
                    `settlement:${request.matchId}`,
                    request.settlementVersion,
                    { requestHash, state: 'PENDING' },
                    tx.transaction
                );
                if (!idem.claimed && idem.record.requestHash !== requestHash) {
                    return fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                }
                const durableClaim = await tx.MatchRepository.claimSettlement(
                    request.matchId,
                    request.settlementVersion,
                    {
                        settlementId,
                        requestHash,
                        resultId: validated.result.resultId,
                        resultHash: validated.result.resultHash,
                        status: 'PENDING',
                        createdAt: now
                    },
                    tx.transaction
                );
                if (!durableClaim.claimed &&
                    !['FAILED_RETRYABLE', 'PROCESSING'].includes(prior?.status)) {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_IN_PROGRESS);
                }
                const pending = {
                    settlementId,
                    settlementVersion: request.settlementVersion,
                    requestHash,
                    policyVersion: policy.version,
                    resultId: validated.result.resultId,
                    resultHash: validated.result.resultHash,
                    status: 'PENDING',
                    attempts: prior?.attempts || 0,
                    preparedAt: now
                };
                await tx.MatchRepository.update(request.matchId, {
                    economy: {
                        ...match.economy,
                        settlements: {
                            ...match.economy.settlements,
                            [request.settlementVersion]: pending
                        }
                    }
                }, tx.transaction);
                return { ok: true, settlement: pending };
            });
        } catch {
            return fail(ECONOMY_ERRORS.PERSISTENCE_ERROR);
        }
    }

    function buildSettlement(match, result, policy, settlementId, now) {
        const entries = match.economy.entries;
        const enteredActors = participantIds(result);
        const totalPot = enteredActors.reduce((total, userId) => {
            const entry = entries[userId];
            if (!isRecord(entry) || entry.userId !== userId ||
                entry.stakeMinor !== policy.stakeMinor ||
                entry.currency !== policy.currency) return NaN;
            const next = total + entry.stakeMinor;
            return safeInteger(next) ? next : NaN;
        }, 0);
        if (!safeInteger(totalPot) || totalPot <= 0) return null;

        const houseFeeMinor = Number(
            (BigInt(totalPot) * BigInt(policy.houseFeeBps)) / 10000n
        );
        const prizePoolMinor = totalPot - houseFeeMinor;
        const payouts = splitMinorUnits(prizePoolMinor, winningActors(result));
        const ledgerEntries = [];
        ledgerEntries.push({
            entryId: idFactory(),
            userId: policy.escrowAccountId,
            matchId: match.matchId,
            settlementId,
            type: 'MATCH_STAKE_ESCROW_SETTLEMENT',
            amountMinor: totalPot,
            currency: policy.currency,
            direction: 'DEBIT',
            timestamp: now,
            idempotencyKey: `settlement:${match.matchId}:${match.resultVersion}:escrow-debit`,
            metadata: { policyVersion: policy.version },
            policyVersion: policy.version
        });
        for (const payout of payouts) {
            ledgerEntries.push({
                entryId: idFactory(),
                userId: payout.userId,
                matchId: match.matchId,
                settlementId,
                type: 'MATCH_PRIZE',
                amountMinor: payout.amountMinor,
                currency: policy.currency,
                direction: 'CREDIT',
                timestamp: now,
                idempotencyKey: `settlement:${match.matchId}:${match.resultVersion}:payout:${payout.userId}`,
                metadata: { policyVersion: policy.version },
                policyVersion: policy.version
            });
        }
        if (houseFeeMinor > 0) {
            ledgerEntries.push({
                entryId: idFactory(),
                userId: policy.houseAccountId,
                matchId: match.matchId,
                settlementId,
                type: 'HOUSE_FEE',
                amountMinor: houseFeeMinor,
                currency: policy.currency,
                direction: 'CREDIT',
                timestamp: now,
                idempotencyKey: `settlement:${match.matchId}:${match.resultVersion}:house-fee`,
                metadata: { policyVersion: policy.version },
                policyVersion: policy.version
            });
        }

        return {
            settlementId,
            matchId: match.matchId,
            settlementVersion: match.resultVersion,
            resultId: result.resultId,
            resultHash: result.resultHash,
            policyVersion: policy.version,
            currency: policy.currency,
            totalPotMinor: totalPot,
            houseFeeMinor,
            prizePoolMinor,
            payouts,
            ledgerEntries,
            status: 'COMPLETED',
            completedAt: now
        };
    }

    async function settleMatch(request) {
        if (!validateRequest(request, [
            'matchId', 'settlementVersion', 'policyVersion'
        ]) ||
            !validId(request.matchId) || !validId(request.settlementVersion) ||
            !validId(request.policyVersion)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }

        const policy = getPolicy(request.policyVersion);
        if (!policy) return fail(ECONOMY_ERRORS.INVALID_POLICY);
        const now = clock();
        const attemptId = idFactory();
        const settlementId = hash([request.matchId, request.settlementVersion]);
        if (!Number.isSafeInteger(now) || now < 0 || !validId(attemptId)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }
        const prepared = await prepareSettlement(request);
        if (!prepared.ok) return prepared;
        if (prepared.settlement?.status === 'COMPLETED') {
            return { ok: true, settlement: prepared.settlement };
        }
        const idemScope = `settlement:${request.matchId}`;
        const idemKey = request.settlementVersion;
        const idemRequestHash = hash({
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            policyVersion: request.policyVersion
        });

        let claimedState;
        try {
            claimedState = await persistence.runInTransaction(async (tx) => {
                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                const validated = validateStoredMatchResult(match, request);
                if (!validated.ok) return validated;

                const prior = match.economy.settlements[request.settlementVersion];
                if (prior?.resultHash &&
                    (prior.resultHash !== validated.result.resultHash ||
                        prior.resultId !== validated.result.resultId)) {
                    return fail(ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
                }
                if (prior?.status === 'COMPLETED') {
                    if (prior.requestHash !== idemRequestHash) {
                        return fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                    }
                    if (prior.resultHash !== match.result.resultHash ||
                        prior.resultId !== match.result.resultId) {
                        return fail(ECONOMY_ERRORS.RESULT_VERSION_MISMATCH);
                    }
                    return { ok: true, settlement: prior };
                }
                if (prior?.status === 'FAILED_FINAL') {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_FINAL);
                }
                if (prior?.status === 'PROCESSING' &&
                    Number.isSafeInteger(prior.leaseUntil) && prior.leaseUntil > now) {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_IN_PROGRESS);
                }

                const idem = await tx.IdempotencyRepository.claim(
                    idemScope,
                    idemKey,
                    { requestHash: idemRequestHash, state: 'PROCESSING' },
                    tx.transaction
                );
                if (!idem.claimed && idem.record.requestHash !== idemRequestHash) {
                    return fail(ECONOMY_ERRORS.IDEMPOTENCY_CONFLICT);
                }
                const durableClaim = await tx.MatchRepository.claimSettlement(
                    request.matchId,
                    request.settlementVersion,
                    {
                        settlementId,
                        requestHash: idemRequestHash,
                        status: 'PROCESSING',
                        createdAt: now
                    },
                    tx.transaction
                );
                if (!durableClaim.claimed && prior?.status !== 'FAILED_RETRYABLE' &&
                    prior?.status !== 'PROCESSING' && prior?.status !== 'PENDING') {
                    return fail(ECONOMY_ERRORS.SETTLEMENT_IN_PROGRESS);
                }

                const processing = {
                    settlementId,
                    settlementVersion: request.settlementVersion,
                    requestHash: idemRequestHash,
                    policyVersion: policy.version,
                    resultId: validated.result.resultId,
                    resultHash: validated.result.resultHash,
                    status: 'PROCESSING',
                    attemptId,
                    attempts: (prior?.attempts || 0) + 1,
                    startedAt: now,
                    leaseUntil: now + policy.processingLeaseMs
                };
                await tx.MatchRepository.update(request.matchId, {
                    economy: {
                        ...match.economy,
                        settlements: {
                            ...match.economy.settlements,
                            [request.settlementVersion]: processing
                        }
                    }
                }, tx.transaction);
                return { ok: true, processing, result: validated.result };
            });
        } catch {
            return fail(ECONOMY_ERRORS.PERSISTENCE_ERROR);
        }
        if (!claimedState.ok) return claimedState;
        if (claimedState.settlement) return { ok: true, settlement: claimedState.settlement };
        if (!claimedState.processing) return fail(ECONOMY_ERRORS.INVALID_SETTLEMENT_STATE);

        try {
            return await persistence.runInTransaction(async (tx) => {
                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                const validated = validateStoredMatchResult(match, request);
                if (!validated.ok) throw Object.assign(new Error(validated.error.code), {
                    economyCode: validated.error.code
                });
                const current = match.economy.settlements[request.settlementVersion];
                if (!current || current.status !== 'PROCESSING' ||
                    current.attemptId !== attemptId ||
                    current.requestHash !== idemRequestHash ||
                    current.resultHash !== validated.result.resultHash ||
                    current.resultId !== validated.result.resultId) {
                    throw Object.assign(new Error(ECONOMY_ERRORS.INVALID_SETTLEMENT_STATE), {
                        economyCode: ECONOMY_ERRORS.INVALID_SETTLEMENT_STATE
                    });
                }

                const settlement = buildSettlement(
                    match,
                    validated.result,
                    policy,
                    settlementId,
                    now
                );
                if (!settlement) {
                    throw Object.assign(new Error(ECONOMY_ERRORS.INVALID_STAKE), {
                        economyCode: ECONOMY_ERRORS.INVALID_STAKE
                    });
                }
                const changes = new Map();
                for (const ledger of settlement.ledgerEntries) {
                    const wallet = changes.has(ledger.userId)
                        ? changes.get(ledger.userId)
                        : await tx.WalletRepository.getByUserId(ledger.userId, tx.transaction);
                    if (!wallet) {
                        throw Object.assign(new Error(ECONOMY_ERRORS.WALLET_NOT_FOUND), {
                            economyCode: ECONOMY_ERRORS.WALLET_NOT_FOUND
                        });
                    }
                    if (wallet.currency !== policy.currency) {
                        throw Object.assign(new Error(ECONOMY_ERRORS.CURRENCY_MISMATCH), {
                            economyCode: ECONOMY_ERRORS.CURRENCY_MISMATCH
                        });
                    }
                    const nextBalance = wallet.balanceMinor +
                        (ledger.direction === 'CREDIT'
                            ? ledger.amountMinor
                            : -ledger.amountMinor);
                    if (!safeInteger(wallet.balanceMinor) ||
                        !safeInteger(nextBalance) ||
                        (!policy.allowNegativeBalance && nextBalance < 0)) {
                        throw Object.assign(new Error(ECONOMY_ERRORS.INSUFFICIENT_FUNDS), {
                            economyCode: ECONOMY_ERRORS.INSUFFICIENT_FUNDS
                        });
                    }
                    changes.set(ledger.userId, {
                        wallet,
                        balanceMinor: nextBalance
                    });
                }

                for (const ledger of settlement.ledgerEntries) {
                    await tx.LedgerRepository.append(ledger, tx.transaction);
                }
                for (const [userId, change] of changes) {
                    await tx.WalletRepository.update(userId, {
                        balanceMinor: change.balanceMinor
                    }, tx.transaction);
                }
                if (typeof tx.OutboxRepository.enqueue === 'function') {
                    await tx.OutboxRepository.enqueue({
                        eventId: `settlement:${settlementId}:completed`,
                        type: 'EconomySettlementCompleted',
                        aggregateId: request.matchId,
                        settlementId,
                        settlementVersion: request.settlementVersion,
                        availableAt: now,
                        createdAt: now,
                        payload: {
                            settlementId,
                            matchId: request.matchId,
                            settlementVersion: request.settlementVersion,
                            resultHash: validated.result.resultHash,
                            policyVersion: policy.version
                        }
                    }, tx.transaction);
                }
                const completed = {
                    ...settlement,
                    requestHash: idemRequestHash,
                    attempts: current.attempts,
                    status: 'COMPLETED'
                };
                await tx.MatchRepository.update(request.matchId, {
                    economy: {
                        ...match.economy,
                        settlements: {
                            ...match.economy.settlements,
                            [request.settlementVersion]: completed
                        }
                    }
                }, tx.transaction);
                return { ok: true, settlement: completed };
            });
        } catch (error) {
            const code = ECONOMY_ERRORS[error?.economyCode]
                ? error.economyCode
                : ECONOMY_ERRORS.PERSISTENCE_ERROR;
            const failureStatus = [
                ECONOMY_ERRORS.INVALID_RESULT,
                ECONOMY_ERRORS.RESULT_NOT_LOCKED,
                ECONOMY_ERRORS.RESULT_MATCH_MISMATCH,
                ECONOMY_ERRORS.RESULT_VERSION_MISMATCH,
                ECONOMY_ERRORS.PARTICIPANT_ENTRY_MISMATCH,
                ECONOMY_ERRORS.INVALID_POLICY,
                ECONOMY_ERRORS.INVALID_STAKE
            ].includes(code)
                ? 'FAILED_FINAL'
                : 'FAILED_RETRYABLE';
            try {
                await persistence.runInTransaction(async (tx) => {
                    const match = await tx.MatchRepository.getById(
                        request.matchId, tx.transaction
                    );
                    if (!match || !isRecord(match.economy)) return;
                    const current = match.economy.settlements?.[request.settlementVersion];
                    if (!current || current.status !== 'PROCESSING' ||
                        current.attemptId !== attemptId) return;
                    const failed = {
                        ...current,
                        status: failureStatus,
                        errorCode: code,
                        failedAt: clock()
                    };
                    await tx.MatchRepository.update(request.matchId, {
                        economy: {
                            ...match.economy,
                            settlements: {
                                ...match.economy.settlements,
                                [request.settlementVersion]: failed
                            }
                        }
                    }, tx.transaction);
                });
            } catch {
                return fail(ECONOMY_ERRORS.PERSISTENCE_ERROR);
            }
            return fail(code, { status: failureStatus });
        }
    }

    async function reconcileSettlement(request) {
        if (!validateRequest(request, ['matchId', 'settlementVersion']) ||
            !validId(request.matchId) || !validId(request.settlementVersion)) {
            return fail(ECONOMY_ERRORS.INVALID_REQUEST);
        }
        const [match, ledger] = await Promise.all([
            persistence.MatchRepository.getById(request.matchId),
            persistence.LedgerRepository.listByMatch(request.matchId, 1000)
        ]);
        if (!match || !isRecord(match.economy)) return fail(ECONOMY_ERRORS.MATCH_NOT_FOUND);
        const settlement = match.economy.settlements?.[request.settlementVersion];
        if (!settlement) return fail(ECONOMY_ERRORS.INVALID_SETTLEMENT_STATE);

        const findings = [];
        const resultValid = isRecord(match.result) &&
            match.status === 'RESULT_LOCKED' &&
            match.result.matchId === request.matchId &&
            validateMatchResult(match.result).ok;
        if (!resultValid) findings.push('SETTLEMENT_WITHOUT_VALID_LOCKED_RESULT');
        const settlementLedger = ledger.filter((entry) =>
            entry.settlementId === settlement.settlementId);
        const stakeDebitCounts = new Map();
        for (const entry of ledger) {
            if (entry.type !== 'MATCH_STAKE' || entry.direction !== 'DEBIT') continue;
            stakeDebitCounts.set(entry.userId, (stakeDebitCounts.get(entry.userId) || 0) + 1);
        }
        if ([...stakeDebitCounts.values()].some((count) => count > 1)) {
            findings.push('DUPLICATE_ENTRY_DEBIT');
        }
        const seenIds = new Set();
        const seenKeys = new Set();
        for (const entry of settlementLedger) {
            if (seenIds.has(entry.entryId) || seenKeys.has(entry.idempotencyKey)) {
                findings.push('DUPLICATE_LEDGER_ENTRY');
            }
            seenIds.add(entry.entryId);
            seenKeys.add(entry.idempotencyKey);
        }
        if (settlement.status === 'COMPLETED') {
            const expected = Array.isArray(settlement.ledgerEntries)
                ? settlement.ledgerEntries
                : [];
            if (!Array.isArray(settlement.ledgerEntries)) {
                findings.push('SETTLEMENT_EXPECTED_LEDGER_MISSING');
            }
            const actualById = new Map(settlementLedger.map((entry) => [entry.entryId, entry]));
            for (const entry of expected) {
                if (!actualById.has(entry.entryId)) {
                    findings.push('COMPLETED_WITHOUT_EXPECTED_LEDGER');
                }
            }
            if (settlementLedger.length !== expected.length) {
                findings.push('UNEXPECTED_OR_DUPLICATE_LEDGER_ENTRY');
            }
            const payoutActors = new Set();
            const winningActorIds = resultValid ? new Set(winningActors(match.result)) : new Set();
            for (const entry of settlementLedger) {
                if (entry.type === 'MATCH_PRIZE' && payoutActors.has(entry.userId)) {
                    findings.push('DUPLICATE_PAYOUT');
                }
                if (entry.type === 'MATCH_PRIZE') {
                    payoutActors.add(entry.userId);
                    if (!winningActorIds.has(entry.userId)) {
                        findings.push('PAYOUT_TO_NON_WINNER');
                    }
                }
            }
            const debitKeys = new Set();
            let escrowDebits = 0;
            for (const entry of settlementLedger) {
                if (entry.direction === 'DEBIT' && debitKeys.has(entry.idempotencyKey)) {
                    findings.push('DUPLICATE_STAKE_DEBIT');
                }
                if (entry.direction === 'DEBIT') debitKeys.add(entry.idempotencyKey);
                if (entry.type === 'MATCH_STAKE_ESCROW_SETTLEMENT' &&
                    entry.direction === 'DEBIT') escrowDebits += 1;
            }
            if (escrowDebits > 1) findings.push('DUPLICATE_ESCROW_DEBIT');
            const fee = settlementLedger
                .filter((entry) => entry.type === 'HOUSE_FEE')
                .reduce((total, entry) => total + entry.amountMinor, 0);
            if (fee !== settlement.houseFeeMinor) findings.push('HOUSE_FEE_MISMATCH');
            const policy = getPolicy(settlement.policyVersion);
            if (!policy || !safeInteger(settlement.totalPotMinor) ||
                !safeInteger(settlement.houseFeeMinor) ||
                !safeInteger(settlement.prizePoolMinor) ||
                Number((BigInt(settlement.totalPotMinor) * BigInt(policy.houseFeeBps)) /
                    10000n) !== settlement.houseFeeMinor ||
                settlement.prizePoolMinor !== settlement.totalPotMinor - settlement.houseFeeMinor) {
                findings.push('SETTLEMENT_POLICY_MISMATCH');
            }
            if (settlement.resultHash !== match.result?.resultHash ||
                settlement.resultId !== match.result?.resultId) {
                findings.push('SETTLEMENT_RESULT_MISMATCH');
            }
        }

        return {
            ok: true,
            settlementId: settlement.settlementId,
            status: settlement.status,
            findings: sortedUnique(findings)
        };
    }

    return Object.freeze({
        openPaidMatch,
        registerStake,
        prepareSettlement,
        settleMatch,
        reconcileSettlement
    });
}

module.exports = Object.freeze({
    SETTLEMENT_STATUSES,
    ECONOMY_ERRORS,
    validatePolicy,
    createEconomyService
});
