'use strict';

const crypto = require('crypto');
const { SCHEMA_VERSION } = require('../../contracts/v2');
const { assertRepository } = require('../../persistence/v2');

const RUNTIME_MODES = Object.freeze(['LEGACY', 'V2']);
const ASSIGNMENT_STATUSES = Object.freeze([
    'ASSIGNED',
    'ACTIVE',
    'FINISHED',
    'ABORTED'
]);

const DEFAULT_ROUTING_POLICY = Object.freeze({
    enabled: false,
    rolloutPercentage: 0,
    allowlist: Object.freeze([]),
    denylist: Object.freeze([]),
    testUsers: Object.freeze([]),
    testMatches: Object.freeze([]),
    killSwitch: true,
    policyVersion: 'runtime-routing-v1'
});

const RUNTIME_INTEGRATION_ERRORS = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_POLICY: 'INVALID_POLICY',
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    ASSIGNMENT_CONFLICT: 'ASSIGNMENT_CONFLICT',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    INVALID_TRANSITION: 'INVALID_TRANSITION',
    AUTHORITY_CONFLICT: 'AUTHORITY_CONFLICT',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
    OBSERVABILITY_ERROR: 'OBSERVABILITY_ERROR'
});

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const IDEMPOTENCY_SCOPE = 'runtime-integration:v2';
const IDEMPOTENCY_RACE = Symbol('RUNTIME_INTEGRATION_IDEMPOTENCY_RACE');

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function failure(code) {
    return { ok: false, error: { code } };
}

function validId(value) {
    return typeof value === 'string' && VALID_ID.test(value);
}

function exactKeys(value, required, optional = []) {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowed.has(key));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
    return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizePolicy(policy) {
    if (!exactKeys(policy, [
        'enabled',
        'rolloutPercentage',
        'allowlist',
        'denylist',
        'testUsers',
        'testMatches',
        'killSwitch',
        'policyVersion'
    ]) ||
        typeof policy.enabled !== 'boolean' ||
        typeof policy.killSwitch !== 'boolean' ||
        !Number.isFinite(policy.rolloutPercentage) ||
        policy.rolloutPercentage < 0 ||
        policy.rolloutPercentage > 100 ||
        !validId(policy.policyVersion)) {
        throw new TypeError(RUNTIME_INTEGRATION_ERRORS.INVALID_POLICY);
    }
    const arrays = ['allowlist', 'denylist', 'testUsers', 'testMatches'];
    for (const name of arrays) {
        if (!Array.isArray(policy[name]) ||
            policy[name].some((value) => !validId(value)) ||
            new Set(policy[name]).size !== policy[name].length) {
            throw new TypeError(RUNTIME_INTEGRATION_ERRORS.INVALID_POLICY);
        }
    }
    return Object.freeze({
        ...policy,
        allowlist: Object.freeze([...policy.allowlist]),
        denylist: Object.freeze([...policy.denylist]),
        testUsers: Object.freeze([...policy.testUsers]),
        testMatches: Object.freeze([...policy.testMatches])
    });
}

function validAssignment(assignment, matchId) {
    return exactKeys(assignment, [
        'matchId',
        'runtime',
        'assignmentId',
        'policyVersion',
        'assignedAt',
        'status',
        'schemaVersion'
    ]) &&
        assignment.matchId === matchId &&
        RUNTIME_MODES.includes(assignment.runtime) &&
        validId(assignment.assignmentId) &&
        validId(assignment.policyVersion) &&
        Number.isSafeInteger(assignment.assignedAt) &&
        assignment.assignedAt >= 0 &&
        ASSIGNMENT_STATUSES.includes(assignment.status) &&
        assignment.schemaVersion === SCHEMA_VERSION;
}

function createRuntimeIntegrationBoundary({
    persistence,
    observability,
    clock,
    idFactory = () => crypto.randomUUID(),
    policy = DEFAULT_ROUTING_POLICY
} = {}) {
    if (!persistence || typeof persistence !== 'object' ||
        !observability || typeof observability.logEvent !== 'function' ||
        typeof clock !== 'function' || typeof idFactory !== 'function') {
        throw new TypeError('Persistence, observability, and clock adapters are required');
    }
    assertRepository(persistence.MatchRepository, 'MatchRepository');
    assertRepository(persistence.IdempotencyRepository, 'IdempotencyRepository');
    if (typeof persistence.runInTransaction !== 'function') {
        throw new TypeError('runInTransaction must be implemented');
    }
    const routingPolicy = normalizePolicy(policy);

    function now() {
        const timestamp = clock();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
            throw new TypeError('The runtime integration clock must return epoch milliseconds');
        }
        return timestamp;
    }

    function validContext(context) {
        return exactKeys(context, ['matchId'], [
            'userId',
            'sessionId',
            'requestedMode',
            'correlationId',
            'idempotencyKey'
        ]) &&
            validId(context.matchId) &&
            (context.userId === undefined || validId(context.userId)) &&
            (context.sessionId === undefined || validId(context.sessionId)) &&
            (context.correlationId === undefined || validId(context.correlationId)) &&
            (context.idempotencyKey === undefined || validId(context.idempotencyKey)) &&
            (context.requestedMode === undefined ||
                RUNTIME_MODES.includes(context.requestedMode));
    }

    function selectRuntime(context) {
        if (!routingPolicy.enabled || routingPolicy.killSwitch) return 'LEGACY';
        if (routingPolicy.denylist.includes(context.matchId)) return 'LEGACY';
        if (context.userId && routingPolicy.denylist.includes(context.userId)) {
            return 'LEGACY';
        }
        const explicitlyIncluded =
            routingPolicy.allowlist.includes(context.matchId) ||
            (context.userId && routingPolicy.allowlist.includes(context.userId)) ||
            (context.userId && routingPolicy.testUsers.includes(context.userId)) ||
            routingPolicy.testMatches.includes(context.matchId);
        if (explicitlyIncluded) return 'V2';
        const bucket = Number.parseInt(
            digest([routingPolicy.policyVersion, context.matchId]).slice(0, 12),
            16
        ) % 10000;
        return bucket < routingPolicy.rolloutPercentage * 100 ? 'V2' : 'LEGACY';
    }

    async function emit({
        eventName,
        context,
        assignment,
        outcome,
        errorCode
    }) {
        let eventId;
        let timestamp;
        try {
            eventId = idFactory();
            timestamp = new Date(now()).toISOString();
        } catch {
            return false;
        }
        if (!validId(eventId)) return false;
        const category = eventName === 'runtime.kill_switch' ||
            eventName === 'runtime.authority_conflict'
            ? 'SECURITY'
            : 'SYSTEM';
        const event = {
            eventId,
            eventType: 'RuntimeAssignment',
            category,
            timestamp,
            schemaVersion: SCHEMA_VERSION,
            ...(validId(context?.correlationId)
                ? { correlationId: context.correlationId }
                : {}),
            ...(validId(context?.matchId) ? { matchId: context.matchId } : {}),
            operation: eventName,
            outcome,
            metadata: {
                eventName,
                schemaVersion: SCHEMA_VERSION,
                policyVersion: routingPolicy.policyVersion,
                ...(assignment ? {
                    assignmentId: assignment.assignmentId,
                    runtime: assignment.runtime,
                    status: assignment.status
                } : {}),
                ...(errorCode ? { errorCode } : {})
            }
        };
        try {
            const result = await observability.logEvent(event);
            return result !== false && result?.ok !== false;
        } catch {
            return false;
        }
    }

    async function emitAndReturn({
        response,
        eventName,
        context,
        assignment,
        outcome,
        errorCode
    }) {
        const delivered = await emit({
            eventName,
            context,
            assignment,
            outcome,
            errorCode
        });
        return delivered
            ? response
            : failure(RUNTIME_INTEGRATION_ERRORS.OBSERVABILITY_ERROR);
    }

    function assignmentFromMatch(match, matchId) {
        if (Array.isArray(match?.runtimeAssignments) &&
            match.runtimeAssignments.length > 0) {
            return { exists: true, invalid: true };
        }
        const stored = match?.runtimeAssignment;
        if (stored === undefined || stored === null) {
            return { exists: false, assignment: null };
        }
        if (!validAssignment(stored, matchId)) {
            return { exists: true, invalid: true };
        }
        return { exists: true, assignment: clone(stored) };
    }

    function sameAuthority(current, prior) {
        return current.matchId === prior.matchId &&
            current.runtime === prior.runtime &&
            current.assignmentId === prior.assignmentId &&
            current.policyVersion === prior.policyVersion &&
            current.assignedAt === prior.assignedAt &&
            current.schemaVersion === prior.schemaVersion;
    }

    function requestHash(context) {
        return digest({
            matchId: context.matchId,
            userId: context.userId || null,
            sessionId: context.sessionId || null,
            requestedMode: context.requestedMode || null
        });
    }

    async function resolveRuntimeAssignment(context) {
        if (!validContext(context)) {
            const response = failure(RUNTIME_INTEGRATION_ERRORS.INVALID_REQUEST);
            const delivered = await emit({
                eventName: 'runtime.assignment.rejected',
                context: isRecord(context) ? context : {},
                outcome: 'REJECTED',
                errorCode: response.error.code
            });
            return delivered ? response : failure(RUNTIME_INTEGRATION_ERRORS.OBSERVABILITY_ERROR);
        }
        const request = clone(context);
        const requestedRuntime = selectRuntime(request);
        const scope = `${IDEMPOTENCY_SCOPE}:${request.matchId}`;
        const key = validId(request.idempotencyKey)
            ? request.idempotencyKey
            : `runtime-assignment:${request.matchId}`;
        const hash = requestHash(request);
        let eventName = 'runtime.assignment.created';
        let assignment = null;
        let response;

        try {
            response = await persistence.runInTransaction(async (tx) => {
                const idempotency = tx.IdempotencyRepository;
                const previous = await idempotency.getByKey(scope, key, tx.transaction);
                if (previous) {
                    if (previous.requestHash !== hash ||
                        !validAssignment(previous.response?.data?.assignment, request.matchId)) {
                        return failure(RUNTIME_INTEGRATION_ERRORS.IDEMPOTENCY_CONFLICT);
                    }
                    const match = await tx.MatchRepository.getById(
                        request.matchId, tx.transaction
                    );
                    const persisted = assignmentFromMatch(match, request.matchId);
                    if (persisted.invalid ||
                        !persisted.assignment ||
                        !sameAuthority(
                            persisted.assignment,
                            previous.response.data.assignment
                        )) {
                        return failure(RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);
                    }
                    assignment = persisted.assignment;
                    eventName = 'runtime.assignment.reused';
                    return { ok: true, data: { assignment: clone(assignment) } };
                }

                const match = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                if (!match) return failure(RUNTIME_INTEGRATION_ERRORS.MATCH_NOT_FOUND);
                const persisted = assignmentFromMatch(match, request.matchId);
                if (persisted.invalid) {
                    eventName = 'runtime.authority_conflict';
                    return failure(RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);
                }
                if (persisted.assignment) {
                    assignment = persisted.assignment;
                    if (request.requestedMode &&
                        request.requestedMode !== assignment.runtime) {
                        eventName = 'runtime.authority_conflict';
                        return failure(RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT);
                    }
                    eventName = 'runtime.assignment.reused';
                } else {
                    if (request.requestedMode &&
                        request.requestedMode !== requestedRuntime) {
                        eventName = 'runtime.assignment.rejected';
                        return failure(RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT);
                    }
                    const assignedAt = now();
                    const assignmentId = idFactory();
                    if (!validId(assignmentId)) {
                        return failure(RUNTIME_INTEGRATION_ERRORS.PERSISTENCE_ERROR);
                    }
                    assignment = {
                        matchId: request.matchId,
                        runtime: requestedRuntime,
                        assignmentId,
                        policyVersion: routingPolicy.policyVersion,
                        assignedAt,
                        status: 'ASSIGNED',
                        schemaVersion: SCHEMA_VERSION
                    };
                    await tx.MatchRepository.update(request.matchId, {
                        runtimeAssignment: assignment
                    }, tx.transaction);
                }

                const createdResponse = {
                    ok: true,
                    data: { assignment: clone(assignment) }
                };
                const claimed = await idempotency.claim(scope, key, {
                    requestHash: hash,
                    response: createdResponse
                }, tx.transaction);
                if (!claimed.claimed) {
                    throw IDEMPOTENCY_RACE;
                }
                return createdResponse;
            });
        } catch (error) {
            if (error === IDEMPOTENCY_RACE) {
                try {
                    const previous = await persistence.IdempotencyRepository.getByKey(
                        scope, key
                    );
                    const match = await persistence.MatchRepository.getById(request.matchId);
                    const persisted = assignmentFromMatch(match, request.matchId);
                    if (previous?.requestHash !== hash ||
                        !validAssignment(previous?.response?.data?.assignment, request.matchId) ||
                        persisted.invalid ||
                        !persisted.assignment ||
                        !sameAuthority(persisted.assignment, assignment) ||
                        !sameAuthority(
                            persisted.assignment,
                            previous.response.data.assignment
                        )) {
                        eventName = 'runtime.authority_conflict';
                        response = failure(RUNTIME_INTEGRATION_ERRORS.IDEMPOTENCY_CONFLICT);
                    } else {
                        assignment = persisted.assignment;
                        eventName = 'runtime.assignment.reused';
                        response = {
                            ok: true,
                            data: { assignment: clone(assignment) }
                        };
                    }
                } catch {
                    response = failure(RUNTIME_INTEGRATION_ERRORS.PERSISTENCE_ERROR);
                }
            } else {
                response = failure(RUNTIME_INTEGRATION_ERRORS.PERSISTENCE_ERROR);
            }
        }

        if (!response?.ok) {
            if (response?.error?.code === RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT ||
                response?.error?.code === RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT ||
                response?.error?.code === RUNTIME_INTEGRATION_ERRORS.IDEMPOTENCY_CONFLICT) {
                eventName = 'runtime.authority_conflict';
            } else if (routingPolicy.killSwitch && requestedRuntime === 'LEGACY') {
                eventName = 'runtime.kill_switch';
            }
            return emitAndReturn({
                response,
                eventName,
                context: request,
                assignment,
                outcome: 'REJECTED',
                errorCode: response.error.code
            });
        }
        const logged = await emitAndReturn({
            response,
            eventName,
            context: request,
            assignment,
            outcome: eventName === 'runtime.assignment.reused' ? 'RETRY' : 'SUCCESS'
        });
        if (!logged.ok || assignment?.runtime !== 'LEGACY' || !routingPolicy.enabled) {
            return logged;
        }
        const blockedEvent = routingPolicy.killSwitch
            ? 'runtime.kill_switch'
            : 'runtime.v2.blocked';
        return emitAndReturn({
            response: logged,
            eventName: blockedEvent,
            context: request,
            assignment,
            outcome: 'SUCCESS'
        });
    }

    async function transition(matchId, to) {
        if (!validId(matchId) || !['ACTIVE', 'FINISHED', 'ABORTED'].includes(to)) {
            return failure(RUNTIME_INTEGRATION_ERRORS.INVALID_REQUEST);
        }
        let updated;
        try {
            const response = await persistence.runInTransaction(async (tx) => {
                const match = await tx.MatchRepository.getById(matchId, tx.transaction);
                if (!match) return failure(RUNTIME_INTEGRATION_ERRORS.MATCH_NOT_FOUND);
                const persisted = assignmentFromMatch(match, matchId);
                if (persisted.invalid || !persisted.assignment) {
                    return failure(RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);
                }
                const current = persisted.assignment;
                const allowed = (current.status === 'ASSIGNED' &&
                    ['ACTIVE', 'ABORTED'].includes(to)) ||
                    (current.status === 'ACTIVE' && ['FINISHED', 'ABORTED'].includes(to));
                if (!allowed) {
                    return current.status === to
                        ? { ok: true, data: { assignment: current } }
                        : failure(RUNTIME_INTEGRATION_ERRORS.INVALID_TRANSITION);
                }
                updated = { ...current, status: to };
                await tx.MatchRepository.update(matchId, {
                    runtimeAssignment: updated
                }, tx.transaction);
                return { ok: true, data: { assignment: clone(updated) } };
            });
            return response;
        } catch {
            return failure(RUNTIME_INTEGRATION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function getRuntimeAssignment(matchId, correlationId) {
        if (!validId(matchId) ||
            (correlationId !== undefined && !validId(correlationId))) {
            return failure(RUNTIME_INTEGRATION_ERRORS.INVALID_REQUEST);
        }
        try {
            const match = await persistence.MatchRepository.getById(matchId);
            if (!match) return failure(RUNTIME_INTEGRATION_ERRORS.MATCH_NOT_FOUND);
            const persisted = assignmentFromMatch(match, matchId);
            if (persisted.invalid || !persisted.assignment) {
                return failure(RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);
            }
            return { ok: true, data: { assignment: persisted.assignment } };
        } catch {
            return failure(RUNTIME_INTEGRATION_ERRORS.PERSISTENCE_ERROR);
        }
    }

    return Object.freeze({
        resolveRuntimeAssignment,
        getRuntimeAssignment,
        activateMatch: (matchId) => transition(matchId, 'ACTIVE'),
        finishMatch: (matchId) => transition(matchId, 'FINISHED'),
        abortMatch: (matchId) => transition(matchId, 'ABORTED'),
        getPolicy: () => routingPolicy
    });
}

module.exports = Object.freeze({
    RUNTIME_MODES,
    ASSIGNMENT_STATUSES,
    DEFAULT_ROUTING_POLICY,
    RUNTIME_INTEGRATION_ERRORS,
    createRuntimeIntegrationBoundary
});
