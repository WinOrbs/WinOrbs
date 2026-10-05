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

const SETTLEMENT_ERRORS = Object.freeze({
    AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
    INVALID_REQUEST: 'INVALID_REQUEST',
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    INVALID_RESULT: 'INVALID_RESULT',
    RESULT_NOT_LOCKED: 'RESULT_NOT_LOCKED',
    RESULT_MATCH_MISMATCH: 'RESULT_MATCH_MISMATCH',
    RESULT_VERSION_MISMATCH: 'RESULT_VERSION_MISMATCH',
    RESULT_ID_MISMATCH: 'RESULT_ID_MISMATCH',
    POLICY_MISMATCH: 'POLICY_MISMATCH',
    SETTLEMENT_NOT_FOUND: 'SETTLEMENT_NOT_FOUND',
    SETTLEMENT_IN_PROGRESS: 'SETTLEMENT_IN_PROGRESS',
    SETTLEMENT_FINAL: 'SETTLEMENT_FINAL',
    INVALID_SETTLEMENT_STATE: 'INVALID_SETTLEMENT_STATE',
    ECONOMY_OPERATION_FAILED: 'ECONOMY_OPERATION_FAILED',
    AUDIT_WRITE_FAILED: 'AUDIT_WRITE_FAILED',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR'
});

const ERROR_MESSAGES = Object.freeze({
    AUTHORIZATION_DENIED: 'System authorization is required.',
    INVALID_REQUEST: 'The settlement request is invalid.',
    MATCH_NOT_FOUND: 'The match was not found.',
    INVALID_RESULT: 'The persisted match result is invalid.',
    RESULT_NOT_LOCKED: 'The match result is not locked.',
    RESULT_MATCH_MISMATCH: 'The match result belongs to a different match.',
    RESULT_VERSION_MISMATCH: 'The match result version does not match.',
    RESULT_ID_MISMATCH: 'The match result identity does not match.',
    POLICY_MISMATCH: 'The settlement policy does not match the persisted entry policy.',
    SETTLEMENT_NOT_FOUND: 'The settlement was not found.',
    SETTLEMENT_IN_PROGRESS: 'The settlement is already being processed.',
    SETTLEMENT_FINAL: 'The settlement has failed permanently.',
    INVALID_SETTLEMENT_STATE: 'The settlement state is invalid.',
    ECONOMY_OPERATION_FAILED: 'The Economy Core operation failed.',
    AUDIT_WRITE_FAILED: 'The settlement audit record could not be persisted.',
    PERSISTENCE_ERROR: 'The settlement state could not be read.'
});

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function fail(code) {
    const safeCode = Object.hasOwn(ERROR_MESSAGES, code)
        ? code
        : SETTLEMENT_ERRORS.ECONOMY_OPERATION_FAILED;
    return {
        ok: false,
        error: {
            code: safeCode,
            message: ERROR_MESSAGES[safeCode]
        }
    };
}

function success(data) {
    return { ok: true, data };
}

function exactKeys(value, required, optional = []) {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowed.has(key));
}

function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function settlementKey(matchId, settlementVersion) {
    return hash([matchId, settlementVersion]);
}

function validateSettlementRequest(request) {
    if (!exactKeys(request, [
        'matchId',
        'resultId',
        'resultVersion',
        'settlementVersion',
        'policyVersion',
        'systemContext'
    ], ['correlationId']) ||
        !validId(request.matchId) ||
        !validId(request.resultId) ||
        !validId(request.resultVersion) ||
        !validId(request.settlementVersion) ||
        !validId(request.policyVersion) ||
        !isRecord(request.systemContext) ||
        (request.correlationId !== undefined && !validId(request.correlationId))) {
        return false;
    }
    return true;
}

function validateMatchEvidence(match, request) {
    if (!match) return fail(SETTLEMENT_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== 'RESULT_LOCKED') return fail(SETTLEMENT_ERRORS.RESULT_NOT_LOCKED);
    if (!isRecord(match.result) || !validateMatchResult(match.result).ok) {
        return fail(SETTLEMENT_ERRORS.INVALID_RESULT);
    }
    if (match.matchId !== request.matchId || match.result.matchId !== request.matchId) {
        return fail(SETTLEMENT_ERRORS.RESULT_MATCH_MISMATCH);
    }
    if (match.resultVersion !== request.resultVersion ||
        request.resultVersion !== request.settlementVersion) {
        return fail(SETTLEMENT_ERRORS.RESULT_VERSION_MISMATCH);
    }
    if (match.result.resultId !== request.resultId) {
        return fail(SETTLEMENT_ERRORS.RESULT_ID_MISMATCH);
    }
    if (!isRecord(match.economy) ||
        match.economy.policyVersion !== request.policyVersion ||
        !isRecord(match.economy.settlements)) {
        return fail(SETTLEMENT_ERRORS.POLICY_MISMATCH);
    }
    return { ok: true, match, result: match.result };
}

function toPublicStatus(value) {
    return SETTLEMENT_STATUSES.includes(value) ? value : null;
}

function settlementIdentityMatches(settlement, matchId, settlementVersion) {
    return (settlement?.matchId === undefined || settlement.matchId === matchId) &&
        settlement?.settlementVersion === settlementVersion;
}

function createSettlementService({
    economy,
    persistence,
    authorizeSystem,
    clock = Date.now
} = {}) {
    if (!economy ||
        typeof economy.prepareSettlement !== 'function' ||
        typeof economy.settleMatch !== 'function' ||
        typeof economy.reconcileSettlement !== 'function') {
        throw new TypeError('Economy Core v2 is required');
    }
    assertRepositories(persistence);
    if (typeof authorizeSystem !== 'function' || typeof clock !== 'function') {
        throw new TypeError('System authorization and clock adapters are required');
    }

    async function authorize(context, operation) {
        try {
            return await authorizeSystem(context, operation) === true;
        } catch {
            return false;
        }
    }

    async function getMatch(matchId) {
        try {
            const match = await persistence.MatchRepository.getById(matchId);
            return { ok: true, match };
        } catch {
            return fail(SETTLEMENT_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function readSettlement(matchId, version) {
        const loaded = await getMatch(matchId);
        if (!loaded.ok) return loaded;
        if (!loaded.match) return fail(SETTLEMENT_ERRORS.MATCH_NOT_FOUND);
        const settlement = loaded.match.economy?.settlements?.[version] || null;
        return { ok: true, match: loaded.match, settlement };
    }

    async function appendAudit({ matchId, settlementVersion, event, correlationId, attempt }) {
        const timestamp = clock();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
            return fail(SETTLEMENT_ERRORS.AUDIT_WRITE_FAILED);
        }
        const settlementId = settlementKey(matchId, settlementVersion);
        const eventId = hash([settlementId, event, attempt || 0]);
        const entry = {
            entryId: eventId,
            aggregateId: matchId,
            type: `settlement.${event}`,
            createdAt: timestamp,
            metadata: {
                settlementId,
                settlementVersion,
                ...(correlationId ? { correlationId } : {}),
                ...(attempt ? { attempt } : {})
            }
        };

        try {
            const existing = await persistence.AuditRepository.listByAggregate(matchId);
            if (existing.some((record) => record.entryId === eventId)) return { ok: true };
            await persistence.runInTransaction(async (tx) => {
                await tx.AuditRepository.append(entry, tx.transaction);
            });
            return { ok: true };
        } catch {
            try {
                const existing = await persistence.AuditRepository.listByAggregate(matchId);
                if (existing.some((record) => record.entryId === eventId)) return { ok: true };
            } catch {
                return fail(SETTLEMENT_ERRORS.AUDIT_WRITE_FAILED);
            }
            return fail(SETTLEMENT_ERRORS.AUDIT_WRITE_FAILED);
        }
    }

    function responseForExisting(matchId, settlementVersion, settlement) {
        return success({
            settlementId: settlement.settlementId || settlementKey(matchId, settlementVersion),
            matchId,
            settlementVersion,
            status: settlement.status,
            policyVersion: settlement.policyVersion,
            ...(settlement.resultId ? { resultId: settlement.resultId } : {}),
            ...(settlement.resultHash ? { resultHash: settlement.resultHash } : {}),
            ...(settlement.completedAt !== undefined
                ? { completedAt: settlement.completedAt }
                : {}),
            ...(settlement.payouts ? { payouts: settlement.payouts } : {}),
            ...(settlement.houseFeeMinor !== undefined
                ? { houseFeeMinor: settlement.houseFeeMinor }
                : {}),
            ...(settlement.prizePoolMinor !== undefined
                ? { prizePoolMinor: settlement.prizePoolMinor }
                : {}),
            settlement
        });
    }

    function mapEconomyError(response) {
        const code = response?.error?.code;
        if (code === 'MATCH_NOT_FOUND') return fail(SETTLEMENT_ERRORS.MATCH_NOT_FOUND);
        if (code === 'INVALID_RESULT') return fail(SETTLEMENT_ERRORS.INVALID_RESULT);
        if (code === 'RESULT_NOT_LOCKED') return fail(SETTLEMENT_ERRORS.RESULT_NOT_LOCKED);
        if (code === 'RESULT_MATCH_MISMATCH') return fail(SETTLEMENT_ERRORS.RESULT_MATCH_MISMATCH);
        if (code === 'RESULT_VERSION_MISMATCH') return fail(SETTLEMENT_ERRORS.RESULT_VERSION_MISMATCH);
        if (code === 'INVALID_POLICY') return fail(SETTLEMENT_ERRORS.POLICY_MISMATCH);
        if (code === 'SETTLEMENT_IN_PROGRESS') return fail(SETTLEMENT_ERRORS.SETTLEMENT_IN_PROGRESS);
        if (code === 'SETTLEMENT_FINAL') return fail(SETTLEMENT_ERRORS.SETTLEMENT_FINAL);
        if (code === 'INVALID_SETTLEMENT_STATE') {
            return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
        }
        return fail(SETTLEMENT_ERRORS.ECONOMY_OPERATION_FAILED);
    }

    async function settle(request) {
        if (!validateSettlementRequest(request)) {
            return fail(SETTLEMENT_ERRORS.INVALID_REQUEST);
        }
        if (!await authorize(request.systemContext, 'settlement.settle')) {
            return fail(SETTLEMENT_ERRORS.AUTHORIZATION_DENIED);
        }

        const loaded = await getMatch(request.matchId);
        if (!loaded.ok) return loaded;
        const evidence = validateMatchEvidence(loaded.match, request);
        if (!evidence.ok) return evidence;
        const existing = evidence.match.economy.settlements[request.settlementVersion];
        if (existing) {
            const status = toPublicStatus(existing.status);
            if (!status ||
                !settlementIdentityMatches(
                    existing, request.matchId, request.settlementVersion
                )) {
                return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
            }
            if (existing.policyVersion !== request.policyVersion ||
                existing.resultId !== request.resultId ||
                existing.resultHash !== evidence.result.resultHash) {
                return fail(SETTLEMENT_ERRORS.RESULT_VERSION_MISMATCH);
            }
            if (status === 'COMPLETED') {
                return responseForExisting(
                    request.matchId,
                    request.settlementVersion,
                    existing
                );
            }
            if (status === 'FAILED_FINAL') return fail(SETTLEMENT_ERRORS.SETTLEMENT_FINAL);
            if (status === 'PROCESSING' &&
                (!Number.isSafeInteger(existing.leaseUntil) ||
                    !Number.isSafeInteger(existing.attempts) ||
                    existing.attempts < 1)) {
                return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
            }
            if (status === 'PROCESSING' && existing.leaseUntil > clock()) {
                return fail(SETTLEMENT_ERRORS.SETTLEMENT_IN_PROGRESS);
            }
        }

        let prepared;
        try {
            prepared = await economy.prepareSettlement({
                matchId: request.matchId,
                settlementVersion: request.settlementVersion,
                policyVersion: request.policyVersion
            });
        } catch {
            return fail(SETTLEMENT_ERRORS.ECONOMY_OPERATION_FAILED);
        }
        if (!prepared?.ok) {
            const mapped = mapEconomyError(prepared);
            const audit = await appendAudit({
                matchId: request.matchId,
                settlementVersion: request.settlementVersion,
                event: 'failed',
                correlationId: request.correlationId
            });
            if (!audit.ok) return audit;
            return mapped;
        }

        const preparedStatus = prepared.settlement?.status;
        if (preparedStatus === 'COMPLETED') {
            return responseForExisting(
                request.matchId,
                request.settlementVersion,
                prepared.settlement
            );
        }
        if (preparedStatus && !['PENDING', 'FAILED_RETRYABLE', 'PROCESSING'].includes(preparedStatus)) {
            return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
        }

        const retrying = Boolean(existing &&
            ['FAILED_RETRYABLE', 'PROCESSING'].includes(existing.status));
        const attempt = (existing?.attempts || prepared.settlement?.attempts || 0) + 1;
        const audit = await appendAudit({
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            event: retrying ? 'retry' : 'started',
            correlationId: request.correlationId,
            attempt
        });
        if (!audit.ok) return audit;

        let result;
        try {
            result = await economy.settleMatch({
                matchId: request.matchId,
                settlementVersion: request.settlementVersion,
                policyVersion: request.policyVersion
            });
        } catch {
            result = { ok: false, error: { code: 'PERSISTENCE_ERROR' } };
        }
        if (!result?.ok) {
            const refreshed = await readSettlement(request.matchId, request.settlementVersion);
            const status = refreshed.ok ? refreshed.settlement?.status : null;
            if (status === 'FAILED_RETRYABLE' || status === 'FAILED_FINAL') {
                const audit = await appendAudit({
                    matchId: request.matchId,
                    settlementVersion: request.settlementVersion,
                    event: 'failed',
                    correlationId: request.correlationId,
                    attempt
                });
                if (!audit.ok) return audit;
            }
            return mapEconomyError(result);
        }

        const settlement = result.settlement;
        if (!settlement || settlement.status !== 'COMPLETED' ||
            settlement.matchId !== request.matchId ||
            settlement.settlementVersion !== request.settlementVersion ||
            settlement.policyVersion !== request.policyVersion ||
            settlement.resultId !== request.resultId ||
            settlement.resultHash !== evidence.result.resultHash) {
            return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
        }
        const completedAudit = await appendAudit({
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            event: 'completed',
            correlationId: request.correlationId,
            attempt
        });
        return success({
            settlementId: settlement.settlementId,
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            status: 'COMPLETED',
            policyVersion: request.policyVersion,
            resultId: settlement.resultId,
            resultHash: settlement.resultHash,
            completedAt: settlement.completedAt,
            payouts: settlement.payouts,
            houseFeeMinor: settlement.houseFeeMinor,
            prizePoolMinor: settlement.prizePoolMinor,
            settlement,
            audit: { completedRecorded: completedAudit.ok }
        });
    }

    async function getSettlement(request) {
        if (!exactKeys(request, ['matchId', 'settlementVersion', 'systemContext']) ||
            !validId(request.matchId) || !validId(request.settlementVersion) ||
            !isRecord(request.systemContext)) {
            return fail(SETTLEMENT_ERRORS.INVALID_REQUEST);
        }
        if (!await authorize(request.systemContext, 'settlement.read')) {
            return fail(SETTLEMENT_ERRORS.AUTHORIZATION_DENIED);
        }
        const found = await readSettlement(request.matchId, request.settlementVersion);
        if (!found.ok) return found;
        if (!found.settlement) return fail(SETTLEMENT_ERRORS.SETTLEMENT_NOT_FOUND);
        const status = toPublicStatus(found.settlement.status);
        if (!status ||
            !settlementIdentityMatches(
                found.settlement, request.matchId, request.settlementVersion
            )) {
            return fail(SETTLEMENT_ERRORS.INVALID_SETTLEMENT_STATE);
        }
        return responseForExisting(
            request.matchId,
            request.settlementVersion,
            found.settlement
        );
    }

    async function retrySettlement(request) {
        return settle(request);
    }

    async function reconcileSettlement(request) {
        if (!exactKeys(request, [
            'matchId',
            'settlementVersion',
            'policyVersion',
            'systemContext'
        ], ['correlationId']) ||
            !validId(request.matchId) || !validId(request.settlementVersion) ||
            !validId(request.policyVersion) || !isRecord(request.systemContext) ||
            (request.correlationId !== undefined && !validId(request.correlationId))) {
            return fail(SETTLEMENT_ERRORS.INVALID_REQUEST);
        }
        if (!await authorize(request.systemContext, 'settlement.reconcile')) {
            return fail(SETTLEMENT_ERRORS.AUTHORIZATION_DENIED);
        }
        const loaded = await getMatch(request.matchId);
        if (!loaded.ok) return loaded;
        const match = loaded.match;
        if (!match) return fail(SETTLEMENT_ERRORS.MATCH_NOT_FOUND);
        const settlement = match.economy?.settlements?.[request.settlementVersion] || null;
        const findings = [];

        if (match.status === 'RESULT_LOCKED' && !settlement) {
            findings.push('LOCKED_RESULT_WITHOUT_SETTLEMENT');
        }
        if (!isRecord(match.result) || !validateMatchResult(match.result).ok ||
            match.result.matchId !== request.matchId || match.status !== 'RESULT_LOCKED') {
            findings.push('INVALID_OR_UNLOCKED_MATCH_RESULT');
        }
        if (settlement) {
            if (!settlementIdentityMatches(
                settlement, request.matchId, request.settlementVersion
            ) || settlement.policyVersion !== request.policyVersion ||
                match.economy.policyVersion !== settlement.policyVersion) {
                findings.push('SETTLEMENT_POLICY_VERSION_MISMATCH');
            }
            if (settlement.resultId !== match.result?.resultId ||
                settlement.resultHash !== match.result?.resultHash ||
                settlement.settlementVersion !== match.resultVersion) {
                findings.push('SETTLEMENT_RESULT_MISMATCH');
            }
            if (settlement.status === 'PROCESSING' &&
                Number.isSafeInteger(settlement.leaseUntil) &&
                settlement.leaseUntil <= clock()) {
                findings.push('PROCESSING_LEASE_EXPIRED');
            }
            if (settlement.status === 'FAILED_RETRYABLE') {
                findings.push('RETRYABLE_SETTLEMENT_READY');
            }
            if (!toPublicStatus(settlement.status)) {
                findings.push('INVALID_SETTLEMENT_STATUS');
            }
        }

        let economyDiagnostic = null;
        if (settlement) {
            try {
                const diagnostic = await economy.reconcileSettlement({
                    matchId: request.matchId,
                    settlementVersion: request.settlementVersion
                });
                if (diagnostic?.ok) {
                    economyDiagnostic = diagnostic;
                    findings.push(...(diagnostic.findings || []));
                } else {
                    findings.push('ECONOMY_RECONCILIATION_FAILED');
                }
            } catch {
                findings.push('ECONOMY_RECONCILIATION_FAILED');
            }
        }
        const uniqueFindings = [...new Set(findings)].sort();
        if (uniqueFindings.length > 0) {
            const audit = await appendAudit({
                matchId: request.matchId,
                settlementVersion: request.settlementVersion,
                event: 'reconciliation_detected',
                correlationId: request.correlationId
            });
            if (!audit.ok) return audit;
        }
        return success({
            matchId: request.matchId,
            settlementVersion: request.settlementVersion,
            status: settlement?.status || null,
            findings: uniqueFindings,
            economyDiagnostic
        });
    }

    return Object.freeze({
        settle,
        getSettlement,
        retrySettlement,
        reconcileSettlement
    });
}

module.exports = Object.freeze({
    SETTLEMENT_STATUSES,
    SETTLEMENT_ERRORS,
    createSettlementService
});
