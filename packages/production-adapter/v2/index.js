'use strict';

const crypto = require('crypto');
const { SCHEMA_VERSION } = require('../../contracts/v2');

const PRODUCTION_ADAPTER_ERROR_CODES = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_ASSIGNMENT: 'INVALID_ASSIGNMENT',
    LEGACY_RUNTIME: 'LEGACY_RUNTIME',
    RUNTIME_MISMATCH: 'RUNTIME_MISMATCH',
    ASSIGNMENT_MISMATCH: 'ASSIGNMENT_MISMATCH',
    INSTANCE_CONFLICT: 'INSTANCE_CONFLICT',
    CLOSED_INSTANCE: 'CLOSED_INSTANCE',
    RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
    AUTHORITY_NOT_FOUND: 'AUTHORITY_NOT_FOUND',
    INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
    BOOTSTRAP_FAILURE: 'BOOTSTRAP_FAILURE',
    OBSERVABILITY_FAILURE: 'OBSERVABILITY_FAILURE'
});

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const RUNTIME_MODES = Object.freeze(['LEGACY', 'V2']);
const ASSIGNMENT_STATUSES = Object.freeze(['ASSIGNED', 'ACTIVE', 'FINISHED', 'ABORTED']);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
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

function failure(code, details = {}) {
    return { ok: false, error: { code, ...details } };
}

function validateAssignment(assignment) {
    return exactKeys(assignment, [
        'matchId',
        'runtime',
        'assignmentId',
        'policyVersion',
        'assignedAt',
        'status',
        'schemaVersion'
    ]) &&
        validId(assignment.matchId) &&
        RUNTIME_MODES.includes(assignment.runtime) &&
        validId(assignment.assignmentId) &&
        validId(assignment.policyVersion) &&
        Number.isSafeInteger(assignment.assignedAt) &&
        assignment.assignedAt >= 0 &&
        ASSIGNMENT_STATUSES.includes(assignment.status) &&
        assignment.schemaVersion === SCHEMA_VERSION;
}

function sameAssignment(left, right) {
    return !!left && !!right &&
        left.matchId === right.matchId &&
        left.runtime === right.runtime &&
        left.assignmentId === right.assignmentId &&
        left.policyVersion === right.policyVersion &&
        left.assignedAt === right.assignedAt &&
        left.status === right.status &&
        left.schemaVersion === right.schemaVersion;
}

function isClosedInstance(instance) {
    return !!instance && instance.status === 'CLOSED';
}

async function rejectClosedInstance(emit, requestContext, assignment, closed) {
    await emit('runtime.adapter.start.rejected', {
        ...requestContext,
        matchId: assignment.matchId,
        runtime: assignment.runtime,
        assignmentId: assignment.assignmentId,
        policyVersion: assignment.policyVersion,
        reason: 'CLOSED_INSTANCE'
    }, { outcome: 'REJECTED' });
    return failure(PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE, {
        matchId: assignment.matchId,
        assignmentId: closed.assignmentId,
        status: 'CLOSED'
    });
}

function createProductionAdapterV2({
    runtimeBoundary,
    bootstrapFactory,
    observability,
    clock = () => Date.now(),
    idFactory = () => crypto.randomUUID()
} = {}) {
    if (!runtimeBoundary || typeof runtimeBoundary !== 'object') {
        throw new TypeError('A runtimeBoundary adapter is required');
    }
    const hasRuntimeMethods = typeof runtimeBoundary.getRuntimeAssignment === 'function' &&
        typeof runtimeBoundary.resolveRuntimeAssignment === 'function';
    if (!hasRuntimeMethods) {
        throw new TypeError('Runtime boundary must expose getRuntimeAssignment and resolveRuntimeAssignment');
    }
    if (typeof bootstrapFactory !== 'function') {
        throw new TypeError('A bootstrapFactory adapter is required');
    }
    if (observability && typeof observability.logEvent !== 'function') {
        throw new TypeError('Observability must expose logEvent when provided');
    }
    if (typeof clock !== 'function' || typeof idFactory !== 'function') {
        throw new TypeError('Clock and idFactory must be functions');
    }

    const instances = new Map();
    const inFlight = new Map();

    function now() {
        const value = clock();
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError('The production adapter clock must return epoch milliseconds');
        }
        return value;
    }

    async function emit(eventName, context = {}, extra = {}) {
        if (!observability) return { ok: true };
        try {
            const event = {
                eventId: idFactory(),
                eventType: 'ProductionAdapter',
                category: /rejected|conflict|recovery|closed/.test(eventName) ? 'SECURITY' : 'SYSTEM',
                timestamp: new Date(now()).toISOString(),
                schemaVersion: SCHEMA_VERSION,
                operation: eventName,
                outcome: extra.outcome || 'SUCCESS',
                ...(context.correlationId ? { correlationId: context.correlationId } : {}),
                ...(context.matchId ? { matchId: context.matchId } : {}),
                ...(context.assignmentId ? { assignmentId: context.assignmentId } : {}),
                ...(context.runtime ? { runtime: context.runtime } : {}),
                metadata: {
                    eventName,
                    matchId: context.matchId || null,
                    assignmentId: context.assignmentId || null,
                    runtime: context.runtime || null,
                    policyVersion: context.policyVersion || null,
                    ...(context.reason ? { reason: context.reason } : {}),
                    ...(extra.metadata || {})
                }
            };
            return await observability.logEvent(event);
        } catch {
            return { ok: false, error: { code: PRODUCTION_ADAPTER_ERROR_CODES.OBSERVABILITY_FAILURE } };
        }
    }

    async function withMatchLock(matchId, action) {
        const existing = inFlight.get(matchId);
        if (existing) {
            return await existing;
        }
        let resolveLock;
        const promise = new Promise((resolve) => {
            resolveLock = resolve;
        });
        inFlight.set(matchId, promise);
        try {
            const result = await action();
            resolveLock(result);
            return result;
        } finally {
            inFlight.delete(matchId);
        }
    }

    async function startAssignedMatch(assignment, request = {}) {
        if (!validateAssignment(assignment)) {
            await emit('runtime.adapter.start.rejected', {
                matchId: isRecord(request) ? request.matchId : undefined,
                runtime: isRecord(request) ? request.runtime : undefined,
                correlationId: isRecord(request) ? request.correlationId : undefined,
                assignmentId: assignment?.assignmentId,
                policyVersion: assignment?.policyVersion,
                reason: 'INVALID_ASSIGNMENT'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.INVALID_ASSIGNMENT);
        }

        const requestContext = isRecord(request) ? request : {};
        const current = instances.get(assignment.matchId) || null;

        if (isClosedInstance(current)) {
            // CLOSED instances are terminal: consult the persisted authority via
            // the Runtime Integration Boundary for compatibility auditing, but
            // never revive, replace, or re-execute the closed instance.
            await runtimeBoundary.getRuntimeAssignment(
                assignment.matchId,
                requestContext.correlationId
            );
            return await rejectClosedInstance(emit, requestContext, assignment, current);
        }

        if (current && current.runtime !== assignment.runtime) {
            await emit('runtime.adapter.start.rejected', {
                ...requestContext,
                matchId: assignment.matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'RUNTIME_MISMATCH'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.RUNTIME_MISMATCH, {
                existingRuntime: current.runtime,
                requestedRuntime: assignment.runtime
            });
        }

        if (current && !sameAssignment(current.assignment, assignment)) {
            await emit('runtime.adapter.start.rejected', {
                ...requestContext,
                matchId: assignment.matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'ASSIGNMENT_MISMATCH'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.ASSIGNMENT_MISMATCH, {
                currentAssignmentId: current.assignment.assignmentId,
                requestedAssignmentId: assignment.assignmentId
            });
        }

        if (current) {
            await emit('runtime.adapter.start.reused', {
                ...requestContext,
                matchId: assignment.matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'existing-instance'
            }, { outcome: 'SUCCESS' });
            return {
                ok: true,
                handled: true,
                runtime: assignment.runtime,
                instance: current,
                assignment,
                reused: true
            };
        }

        if (assignment.runtime === 'LEGACY') {
            await emit('runtime.adapter.start.accepted', {
                ...requestContext,
                matchId: assignment.matchId,
                runtime: 'LEGACY',
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'legacy-authority'
            }, { outcome: 'SUCCESS' });
            return {
                ok: true,
                handled: false,
                runtime: 'LEGACY',
                instance: null,
                assignment,
                reused: false
            };
        }

        return await withMatchLock(assignment.matchId, async () => {
            const existingInstance = instances.get(assignment.matchId) || null;
            if (isClosedInstance(existingInstance)) {
                // Concurrency guard: a CLOSED instance observed inside the lock
                // must also fail closed. Re-check the persisted authority for
                // compatibility auditing without reviving or replacing it.
                await runtimeBoundary.getRuntimeAssignment(
                    assignment.matchId,
                    requestContext.correlationId
                );
                return await rejectClosedInstance(emit, requestContext, assignment, existingInstance);
            }
            if (existingInstance) {
                if (existingInstance.runtime !== assignment.runtime) {
                    await emit('runtime.adapter.start.rejected', {
                        ...requestContext,
                        matchId: assignment.matchId,
                        runtime: assignment.runtime,
                        assignmentId: assignment.assignmentId,
                        policyVersion: assignment.policyVersion,
                        reason: 'RUNTIME_MISMATCH'
                    }, { outcome: 'REJECTED' });
                    return failure(PRODUCTION_ADAPTER_ERROR_CODES.RUNTIME_MISMATCH, {
                        existingRuntime: existingInstance.runtime,
                        requestedRuntime: assignment.runtime
                    });
                }
                if (!sameAssignment(existingInstance.assignment, assignment)) {
                    await emit('runtime.adapter.start.rejected', {
                        ...requestContext,
                        matchId: assignment.matchId,
                        runtime: assignment.runtime,
                        assignmentId: assignment.assignmentId,
                        policyVersion: assignment.policyVersion,
                        reason: 'ASSIGNMENT_MISMATCH'
                    }, { outcome: 'REJECTED' });
                    return failure(PRODUCTION_ADAPTER_ERROR_CODES.ASSIGNMENT_MISMATCH, {
                        currentAssignmentId: existingInstance.assignment.assignmentId,
                        requestedAssignmentId: assignment.assignmentId
                    });
                }
                return {
                    ok: true,
                    handled: true,
                    runtime: existingInstance.runtime,
                    instance: existingInstance,
                    assignment: existingInstance.assignment,
                    reused: true
                };
            }

            const instanceId = idFactory();
            const instance = {
                instanceId,
                matchId: assignment.matchId,
                assignmentId: assignment.assignmentId,
                runtime: 'V2',
                policyVersion: assignment.policyVersion,
                status: 'ACTIVE',
                startedAt: now(),
                assignment,
                bootstrap: null
            };

            try {
                const bootstrap = await bootstrapFactory({
                    matchId: assignment.matchId,
                    assignmentId: assignment.assignmentId,
                    assignment,
                    runtime: 'V2',
                    policyVersion: assignment.policyVersion,
                    status: 'ACTIVE',
                    startedAt: instance.startedAt,
                    correlationId: requestContext.correlationId,
                    match: { matchId: assignment.matchId }
                });
                instance.bootstrap = bootstrap;
                instances.set(assignment.matchId, instance);
                await emit('runtime.adapter.start.accepted', {
                    ...requestContext,
                    matchId: assignment.matchId,
                    runtime: 'V2',
                    assignmentId: assignment.assignmentId,
                    policyVersion: assignment.policyVersion,
                    reason: 'created-v2-instance'
                }, { outcome: 'SUCCESS' });
                return {
                    ok: true,
                    handled: true,
                    runtime: 'V2',
                    instance,
                    assignment,
                    reused: false
                };
            } catch (error) {
                await emit('runtime.adapter.start.rejected', {
                    ...requestContext,
                    matchId: assignment.matchId,
                    runtime: 'V2',
                    assignmentId: assignment.assignmentId,
                    policyVersion: assignment.policyVersion,
                    reason: error?.message || 'BOOTSTRAP_FAILURE'
                }, { outcome: 'REJECTED' });
                return failure(PRODUCTION_ADAPTER_ERROR_CODES.BOOTSTRAP_FAILURE, {
                    cause: error?.message || 'UNKNOWN'
                });
            }
        });
    }

    async function recoverAssignedMatch(matchId, request = {}) {
        if (!validId(matchId)) {
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.INVALID_REQUEST);
        }

        const requestContext = isRecord(request) ? request : {};
        const live = instances.get(matchId) || null;

        const assignmentResponse = await runtimeBoundary.getRuntimeAssignment(matchId, requestContext.correlationId);
        if (!assignmentResponse || !assignmentResponse.ok) {
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.AUTHORITY_NOT_FOUND, { matchId });
        }

        const assignment = assignmentResponse.data?.assignment;
        if (!assignment || !validateAssignment(assignment)) {
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.INVALID_ASSIGNMENT, { matchId });
        }

        if (assignment.runtime === 'LEGACY') {
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: 'LEGACY',
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'legacy-authority'
            }, { outcome: 'SUCCESS' });
            return {
                ok: true,
                handled: false,
                runtime: 'LEGACY',
                instance: null,
                assignment,
                recovered: false
            };
        }

        if (assignment.status === 'FINISHED' || assignment.status === 'ABORTED') {
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: 'V2',
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'ABORT_REQUIRED'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.RECOVERY_REQUIRED, {
                matchId,
                status: assignment.status,
                assignmentId: assignment.assignmentId
            });
        }

        if (isClosedInstance(live)) {
            // A local CLOSED instance is terminal: the persisted authority was
            // consulted above for compatibility auditing, but the closed
            // instance must never be revived, replaced, re-executed, or have
            // its authority changed. Fail closed deterministically.
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: live.runtime,
                assignmentId: live.assignmentId,
                policyVersion: live.policyVersion,
                reason: 'CLOSED_INSTANCE'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE, {
                matchId,
                assignmentId: live.assignmentId,
                status: 'CLOSED'
            });
        }

        if (live && live.runtime !== assignment.runtime) {
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'RUNTIME_MISMATCH'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.RUNTIME_MISMATCH, {
                currentRuntime: live.runtime,
                authoritativeRuntime: assignment.runtime
            });
        }

        if (live && !sameAssignment(live.assignment, assignment)) {
            // Local ACTIVE instance disagrees with the persisted authority:
            // fail closed without mutating either side.
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: 'ASSIGNMENT_MISMATCH'
            }, { outcome: 'REJECTED' });
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.ASSIGNMENT_MISMATCH, {
                currentAssignmentId: live.assignment.assignmentId,
                requestedAssignmentId: assignment.assignmentId
            });
        }

        if (live) {
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: 'V2',
                assignmentId: live.assignmentId,
                policyVersion: live.policyVersion,
                reason: 'reused-v2-instance'
            }, { outcome: 'SUCCESS' });
            return {
                ok: true,
                handled: true,
                runtime: 'V2',
                instance: live,
                assignment: live.assignment,
                recovered: true
            };
        }

        const recovered = await startAssignedMatch(assignment, requestContext);
        if (!recovered.ok) {
            await emit('runtime.adapter.recovery', {
                ...requestContext,
                matchId,
                runtime: assignment.runtime,
                assignmentId: assignment.assignmentId,
                policyVersion: assignment.policyVersion,
                reason: recovered.error?.code || 'UNKNOWN'
            }, { outcome: 'REJECTED' });
            return recovered;
        }

        await emit('runtime.adapter.recovery', {
            ...requestContext,
            matchId,
            runtime: recovered.runtime,
            assignmentId: recovered.assignment?.assignmentId || assignment.assignmentId,
            policyVersion: recovered.assignment?.policyVersion || assignment.policyVersion,
            reason: recovered.reused ? 'reused-existing-instance' : 'created-v2-instance'
        }, { outcome: 'SUCCESS' });
        return recovered;
    }

    async function closeInstance(matchId) {
        const instance = instances.get(matchId);
        if (!instance) {
            return failure(PRODUCTION_ADAPTER_ERROR_CODES.INSTANCE_NOT_FOUND, { matchId });
        }
        if (isClosedInstance(instance)) {
            return {
                ok: true,
                handled: true,
                runtime: instance.runtime,
                instance
            };
        }
        const closed = { ...instance, status: 'CLOSED' };
        instances.set(matchId, closed);
        await emit('runtime.adapter.closed', {
            matchId,
            runtime: instance.runtime,
            assignmentId: instance.assignmentId,
            policyVersion: instance.policyVersion,
            reason: 'match-finished'
        }, { outcome: 'SUCCESS' });
        return {
            ok: true,
            handled: true,
            runtime: instance.runtime,
            instance: closed
        };
    }

    return Object.freeze({
        startAssignedMatch,
        recoverAssignedMatch,
        closeInstance,
        getInstance: (matchId) => instances.get(matchId) || null,
        getRuntimeAssignment: async (matchId, correlationId) => {
            const response = await runtimeBoundary.getRuntimeAssignment(matchId, correlationId);
            return response && response.ok
                ? response
                : failure(PRODUCTION_ADAPTER_ERROR_CODES.AUTHORITY_NOT_FOUND, { matchId });
        }
    });
}

module.exports = Object.freeze({
    PRODUCTION_ADAPTER_ERROR_CODES,
    RUNTIME_MODES,
    ASSIGNMENT_STATUSES,
    createProductionAdapterV2
});
