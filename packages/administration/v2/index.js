'use strict';

const crypto = require('crypto');
const { SCHEMA_VERSION } = require('../../contracts/v2');
const { assertRepository } = require('../../persistence/v2');

const ADMIN_ROLES = Object.freeze([
    'SUPER_ADMIN',
    'ADMIN',
    'SUPPORT',
    'AUDITOR'
]);

const ADMIN_PERMISSIONS = Object.freeze([
    'admin.match.view',
    'admin.match.inspect',
    'admin.match.terminate',
    'admin.user.view',
    'admin.user.suspend',
    'admin.user.unsuspend',
    'admin.progression.view',
    'admin.progression.adjust',
    'admin.audit.read',
    'admin.system.inspect'
]);

const ROLE_POLICY_VERSION = 'admin-role-policy-v1';

const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
    SUPER_ADMIN: Object.freeze([...ADMIN_PERMISSIONS]),
    ADMIN: Object.freeze([
        'admin.match.view',
        'admin.match.inspect',
        'admin.match.terminate',
        'admin.user.view',
        'admin.user.suspend',
        'admin.user.unsuspend',
        'admin.progression.view',
        'admin.progression.adjust',
        'admin.audit.read'
    ]),
    SUPPORT: Object.freeze([
        'admin.match.view',
        'admin.match.inspect',
        'admin.user.view',
        'admin.progression.view'
    ]),
    AUDITOR: Object.freeze([
        'admin.match.view',
        'admin.match.inspect',
        'admin.user.view',
        'admin.progression.view',
        'admin.audit.read',
        'admin.system.inspect'
    ])
});

const AUTH_LEVELS = Object.freeze({
    AUTHENTICATED: 1,
    MFA: 2
});

const OPERATION_DEFINITIONS = Object.freeze({
    MATCH_INSPECT: Object.freeze({
        requiredPermission: 'admin.match.inspect',
        targetType: 'MATCH',
        reasonRequired: false,
        mfaRequired: false,
        idempotencyRequired: false
    }),
    MATCH_TERMINATE: Object.freeze({
        requiredPermission: 'admin.match.terminate',
        targetType: 'MATCH',
        reasonRequired: true,
        mfaRequired: true,
        idempotencyRequired: true
    }),
    USER_VIEW: Object.freeze({
        requiredPermission: 'admin.user.view',
        targetType: 'USER',
        reasonRequired: false,
        mfaRequired: false,
        idempotencyRequired: false
    }),
    USER_SUSPEND: Object.freeze({
        requiredPermission: 'admin.user.suspend',
        targetType: 'USER',
        reasonRequired: true,
        mfaRequired: true,
        idempotencyRequired: true
    }),
    USER_UNSUSPEND: Object.freeze({
        requiredPermission: 'admin.user.unsuspend',
        targetType: 'USER',
        reasonRequired: true,
        mfaRequired: true,
        idempotencyRequired: true
    }),
    PROGRESSION_VIEW: Object.freeze({
        requiredPermission: 'admin.progression.view',
        targetType: 'USER',
        reasonRequired: false,
        mfaRequired: false,
        idempotencyRequired: false
    }),
    PROGRESSION_ADJUST: Object.freeze({
        requiredPermission: 'admin.progression.adjust',
        targetType: 'USER',
        reasonRequired: true,
        mfaRequired: true,
        idempotencyRequired: true
    }),
    AUDIT_READ: Object.freeze({
        requiredPermission: 'admin.audit.read',
        targetType: 'AUDIT',
        reasonRequired: false,
        mfaRequired: false,
        idempotencyRequired: false
    }),
    SYSTEM_INSPECT: Object.freeze({
        requiredPermission: 'admin.system.inspect',
        targetType: 'SYSTEM',
        reasonRequired: false,
        mfaRequired: false,
        idempotencyRequired: false
    })
});

const ADMINISTRATION_ERRORS = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_PRINCIPAL: 'INVALID_PRINCIPAL',
    PRINCIPAL_EXPIRED: 'PRINCIPAL_EXPIRED',
    UNKNOWN_ROLE: 'UNKNOWN_ROLE',
    UNKNOWN_PERMISSION: 'UNKNOWN_PERMISSION',
    ACCESS_DENIED: 'ACCESS_DENIED',
    UNKNOWN_OPERATION: 'UNKNOWN_OPERATION',
    INVALID_TARGET: 'INVALID_TARGET',
    INVALID_REASON: 'INVALID_REASON',
    MFA_REQUIRED: 'MFA_REQUIRED',
    SELF_ESCALATION_DENIED: 'SELF_ESCALATION_DENIED',
    OPERATION_UNAVAILABLE: 'OPERATION_UNAVAILABLE',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    IDEMPOTENCY_UNAVAILABLE: 'IDEMPOTENCY_UNAVAILABLE',
    OPERATION_FAILED: 'OPERATION_FAILED',
    AUDIT_WRITE_FAILED: 'AUDIT_WRITE_FAILED'
});

const SAFE_REASON_PATTERN = /\b(password|token|secret|credential|private[\s_-]*key|service[\s_-]*account|cookie|authorization)\b/i;
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const REASON_MAX_LENGTH = 500;
const IDEMPOTENCY_SCOPE = 'administration:v2';
const IDEMPOTENCY_RACE = Symbol('ADMINISTRATION_IDEMPOTENCY_RACE');

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function requestHash(value) {
    return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizePolicies(rolePermissions) {
    if (!isRecord(rolePermissions) ||
        Object.keys(rolePermissions).length !== ADMIN_ROLES.length ||
        ADMIN_ROLES.some((role) => !Object.hasOwn(rolePermissions, role))) {
        throw new TypeError(ADMINISTRATION_ERRORS.UNKNOWN_ROLE);
    }
    const output = {};
    for (const role of ADMIN_ROLES) {
        const permissions = rolePermissions[role];
        if (!Array.isArray(permissions) ||
            permissions.some((permission) =>
                !ADMIN_PERMISSIONS.includes(permission)) ||
            new Set(permissions).size !== permissions.length) {
            throw new TypeError(ADMINISTRATION_ERRORS.UNKNOWN_PERMISSION);
        }
        output[role] = Object.freeze([...permissions]);
    }
    return Object.freeze(output);
}

function createAdministrationService({
    resolvePrincipal,
    observability,
    persistence,
    clock,
    idFactory = () => crypto.randomUUID(),
    rolePolicyVersion = ROLE_POLICY_VERSION,
    rolePermissions = DEFAULT_ROLE_PERMISSIONS,
    operationAdapters = {}
} = {}) {
    if (typeof resolvePrincipal !== 'function' ||
        !observability || typeof observability.logAdminAction !== 'function' ||
        typeof clock !== 'function' || typeof idFactory !== 'function' ||
        !validId(rolePolicyVersion) || !isRecord(operationAdapters) ||
        Object.keys(operationAdapters).some((operation) =>
            !Object.hasOwn(OPERATION_DEFINITIONS, operation) ||
            typeof operationAdapters[operation] !== 'function')) {
        throw new TypeError('Valid administration adapters and configuration are required');
    }
    const policy = normalizePolicies(rolePermissions);
    if (!persistence || typeof persistence !== 'object') {
        throw new TypeError('Persistence with durable idempotency is required');
    }
    assertRepository(persistence.IdempotencyRepository, 'IdempotencyRepository');
    if (typeof persistence.runInTransaction !== 'function') {
        throw new TypeError('runInTransaction must be implemented');
    }

    function now() {
        const value = clock();
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError('The administration clock must return epoch milliseconds');
        }
        return value;
    }

    function validateReason(reason, required) {
        if (reason === undefined && !required) return { ok: true, reason: null };
        if (typeof reason !== 'string' ||
            reason.trim().length === 0 ||
            reason.length > REASON_MAX_LENGTH ||
            SAFE_REASON_PATTERN.test(reason)) {
            return { ok: false, error: { code: ADMINISTRATION_ERRORS.INVALID_REASON } };
        }
        return { ok: true, reason: reason.trim() };
    }

    async function resolveTrustedPrincipal(candidate) {
        if (!isRecord(candidate)) return failure(ADMINISTRATION_ERRORS.INVALID_PRINCIPAL);
        let principal;
        try {
            principal = await resolvePrincipal(candidate);
        } catch {
            return failure(ADMINISTRATION_ERRORS.INVALID_PRINCIPAL);
        }
        if (!exactKeys(principal, [
            'adminId',
            'sessionId',
            'authenticatedAt',
            'expiresAt',
            'roles',
            'authLevel',
            'schemaVersion'
        ], ['permissions'])) {
            return failure(ADMINISTRATION_ERRORS.INVALID_PRINCIPAL);
        }
        if (!validId(principal.adminId) ||
            !validId(principal.sessionId) ||
            !Number.isSafeInteger(principal.authenticatedAt) ||
            principal.authenticatedAt < 0 ||
            !Number.isSafeInteger(principal.expiresAt) ||
            principal.expiresAt <= principal.authenticatedAt ||
            !Number.isSafeInteger(principal.authLevel) ||
            principal.authLevel < AUTH_LEVELS.AUTHENTICATED ||
            principal.authLevel > AUTH_LEVELS.MFA ||
            principal.schemaVersion !== SCHEMA_VERSION ||
            !Array.isArray(principal.roles) ||
            principal.roles.length === 0 ||
            new Set(principal.roles).size !== principal.roles.length) {
            return failure(ADMINISTRATION_ERRORS.INVALID_PRINCIPAL);
        }
        if (principal.roles.some((role) => !ADMIN_ROLES.includes(role))) {
            return failure(ADMINISTRATION_ERRORS.UNKNOWN_ROLE);
        }
        const currentTime = now();
        if (principal.authenticatedAt > currentTime ||
            principal.expiresAt <= currentTime) {
            return failure(ADMINISTRATION_ERRORS.PRINCIPAL_EXPIRED);
        }
        const permissions = [...new Set(principal.roles.flatMap((role) =>
            policy[role]))].sort();
        return {
            ok: true,
            principal: Object.freeze({
                adminId: principal.adminId,
                sessionId: principal.sessionId,
                authenticatedAt: principal.authenticatedAt,
                expiresAt: principal.expiresAt,
                roles: Object.freeze([...principal.roles]),
                permissions: Object.freeze(permissions),
                authLevel: principal.authLevel,
                schemaVersion: principal.schemaVersion
            })
        };
    }

    async function authorize(principal, permission, context = {}) {
        if (!ADMIN_PERMISSIONS.includes(permission)) {
            return failure(ADMINISTRATION_ERRORS.UNKNOWN_PERMISSION);
        }
        if (!isRecord(context) ||
            Object.keys(context).some((key) => key !== 'targetId' && key !== 'operation')) {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        const resolved = await resolveTrustedPrincipal(principal);
        if (!resolved.ok) return resolved;
        if (!resolved.principal.permissions.includes(permission)) {
            return failure(ADMINISTRATION_ERRORS.ACCESS_DENIED);
        }
        if (context.operation === 'ADMIN_ROLE_GRANT' &&
            context.targetId === resolved.principal.adminId) {
            return failure(ADMINISTRATION_ERRORS.SELF_ESCALATION_DENIED);
        }
        return {
            ok: true,
            data: {
                principal: resolved.principal,
                permission,
                rolePolicyVersion
            }
        };
    }

    async function audit({
        principal,
        operation,
        targetType,
        targetId,
        outcome,
        reason,
        correlationId,
        errorCode
    }) {
        let eventId;
        let timestamp;
        let auditCorrelationId = correlationId;
        try {
            eventId = idFactory();
            timestamp = new Date(now()).toISOString();
            if (!auditCorrelationId) auditCorrelationId = idFactory();
        } catch {
            return false;
        }
        if (!validId(eventId) || !validId(auditCorrelationId)) return false;
        const event = {
            eventId,
            eventType: 'AdminOperation',
            schemaVersion: SCHEMA_VERSION,
            operation: validId(operation)
                ? operation.replaceAll('_', '.')
                : 'ADMIN_REQUEST',
            outcome,
            timestamp,
            correlationId: auditCorrelationId,
            actorId: principal?.adminId,
            sessionId: principal?.sessionId,
            metadata: {
                schemaVersion: SCHEMA_VERSION,
                rolePolicyVersion,
                operation: validId(operation) ? operation : 'ADMIN_REQUEST',
                targetType: targetType || 'UNKNOWN',
                ...(validId(targetId) ? { targetId } : {}),
                ...(principal ? {
                    adminId: principal.adminId,
                    sessionId: principal.sessionId
                } : {}),
                ...(reason ? { reason } : {}),
                ...(errorCode ? { errorCode } : {})
            }
        };
        try {
            const result = await observability.logAdminAction(event);
            return result !== false && result?.ok !== false;
        } catch {
            return false;
        }
    }

    async function rejectWithAudit(code, details = {}) {
        const logged = await audit({
            ...details,
            outcome: 'DENIED',
            errorCode: code
        });
        return logged
            ? failure(code)
            : failure(ADMINISTRATION_ERRORS.AUDIT_WRITE_FAILED);
    }

    function validateOperationRequest(operation, request) {
        const definition = OPERATION_DEFINITIONS[operation];
        if (!definition) return failure(ADMINISTRATION_ERRORS.UNKNOWN_OPERATION);
        if (!exactKeys(request, ['targetId'], [
            'reason',
            'idempotencyKey',
            'correlationId'
        ])) {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        if (!validId(request.targetId)) {
            return failure(ADMINISTRATION_ERRORS.INVALID_TARGET);
        }
        const reasonResult = validateReason(request.reason, definition.reasonRequired);
        if (!reasonResult.ok) return reasonResult;
        if (definition.idempotencyRequired && !validId(request.idempotencyKey)) {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        if (!definition.idempotencyRequired && request.idempotencyKey !== undefined &&
            !validId(request.idempotencyKey)) {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        if (request.correlationId !== undefined && !validId(request.correlationId)) {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        return {
            ok: true,
            definition,
            reason: reasonResult.reason,
            correlationId: request.correlationId
        };
    }

    async function execute(principal, operation, request) {
        const operationName = typeof operation === 'string' ? operation : 'ADMIN_REQUEST';
        const validated = validateOperationRequest(operation, request);
        if (!validated.ok) {
            return rejectWithAudit(validated.error.code, {
                operation: operationName,
                targetId: request?.targetId,
                correlationId: request?.correlationId
            });
        }
        const { definition, reason, correlationId } = validated;
        const targetId = request.targetId;
        const resolved = await resolveTrustedPrincipal(principal);
        if (!resolved.ok) {
            return rejectWithAudit(resolved.error.code, {
                operation,
                targetType: definition.targetType,
                targetId,
                correlationId
            });
        }
        const admin = resolved.principal;
        if (!admin.permissions.includes(definition.requiredPermission)) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.ACCESS_DENIED, {
                principal: admin,
                operation,
                targetType: definition.targetType,
                targetId,
                reason,
                correlationId
            });
        }
        if (definition.mfaRequired && admin.authLevel < AUTH_LEVELS.MFA) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.MFA_REQUIRED, {
                principal: admin,
                operation,
                targetType: definition.targetType,
                targetId,
                reason,
                correlationId
            });
        }
        if (operation === 'ADMIN_ROLE_GRANT' && targetId === admin.adminId) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.SELF_ESCALATION_DENIED, {
                principal: admin,
                operation,
                targetType: definition.targetType,
                targetId,
                reason,
                correlationId
            });
        }
        const handler = operationAdapters[operation];
        if (!handler) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.OPERATION_UNAVAILABLE, {
                principal: admin,
                operation,
                targetType: definition.targetType,
                targetId,
                reason,
                correlationId
            });
        }

        const requestIdentity = {
            operation,
            adminId: admin.adminId,
            targetId,
            reason
        };
        let response;
        let replayed = false;
        try {
            if (definition.idempotencyRequired) {
                const scope = `${IDEMPOTENCY_SCOPE}:${operation}`;
                const hash = requestHash(requestIdentity);
                response = await persistence.runInTransaction(async (tx) => {
                    const repository = tx.IdempotencyRepository;
                    const prior = await repository.getByKey(
                        scope, request.idempotencyKey, tx.transaction
                    );
                    if (prior) {
                        if (prior.requestHash !== hash) {
                            return failure(ADMINISTRATION_ERRORS.IDEMPOTENCY_CONFLICT);
                        }
                        replayed = true;
                        return prior.response;
                    }
                    const result = await handler({
                        principal: admin,
                        operation,
                        targetType: definition.targetType,
                        targetId,
                        reason,
                        transaction: tx.transaction
                    });
                    if (!isRecord(result) || typeof result.ok !== 'boolean') {
                        throw new TypeError('Administrative operation adapter returned an invalid result');
                    }
                    const claim = await repository.claim(scope, request.idempotencyKey, {
                        requestHash: hash,
                        response: result
                    }, tx.transaction);
                    if (!claim.claimed) {
                        throw IDEMPOTENCY_RACE;
                    }
                    return result;
                });
            } else {
                response = await handler({
                    principal: admin,
                    operation,
                    targetType: definition.targetType,
                    targetId,
                    reason,
                    transaction: null
                });
                if (!isRecord(response) || typeof response.ok !== 'boolean') {
                    throw new TypeError('Administrative operation adapter returned an invalid result');
                }
            }
        } catch (error) {
            if (error === IDEMPOTENCY_RACE) {
                try {
                    const prior = await persistence.IdempotencyRepository.getByKey(
                        `${IDEMPOTENCY_SCOPE}:${operation}`,
                        request.idempotencyKey
                    );
                    if (prior?.requestHash === requestHash(requestIdentity)) {
                        response = prior.response;
                        replayed = true;
                    } else {
                        response = failure(ADMINISTRATION_ERRORS.IDEMPOTENCY_CONFLICT);
                    }
                } catch {
                    return rejectWithAudit(ADMINISTRATION_ERRORS.IDEMPOTENCY_UNAVAILABLE, {
                        principal: admin,
                        operation,
                        targetType: definition.targetType,
                        targetId,
                        reason,
                        correlationId
                    });
                }
            } else {
                return rejectWithAudit(ADMINISTRATION_ERRORS.OPERATION_FAILED, {
                    principal: admin,
                    operation,
                    targetType: definition.targetType,
                    targetId,
                    reason,
                    correlationId
                });
            }
        }
        if (!response?.ok) {
            const code = response?.error?.code === ADMINISTRATION_ERRORS.IDEMPOTENCY_CONFLICT
                ? ADMINISTRATION_ERRORS.IDEMPOTENCY_CONFLICT
                : ADMINISTRATION_ERRORS.OPERATION_FAILED;
            const logged = await audit({
                principal: admin,
                operation,
                targetType: definition.targetType,
                targetId,
                outcome: 'FAILURE',
                reason,
                correlationId,
                errorCode: code
            });
            return logged ? response : failure(ADMINISTRATION_ERRORS.AUDIT_WRITE_FAILED);
        }
        const logged = await audit({
            principal: admin,
            operation,
            targetType: definition.targetType,
            targetId,
            outcome: replayed ? 'RETRY' : 'SUCCESS',
            reason,
            correlationId
        });
        return logged
            ? response
            : failure(ADMINISTRATION_ERRORS.AUDIT_WRITE_FAILED);
    }

    async function inspect(principal, resource) {
        if (!exactKeys(resource, ['resourceType', 'targetId'], ['correlationId'])) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.INVALID_REQUEST, {
                operation: 'ADMIN_INSPECT',
                targetId: resource?.targetId,
                correlationId: resource?.correlationId
            });
        }
        const operation = {
            MATCH: 'MATCH_INSPECT',
            USER: 'USER_VIEW',
            PROGRESSION: 'PROGRESSION_VIEW',
            AUDIT: 'AUDIT_READ',
            SYSTEM: 'SYSTEM_INSPECT'
        }[resource.resourceType];
        if (!operation) {
            return rejectWithAudit(ADMINISTRATION_ERRORS.UNKNOWN_OPERATION, {
                operation: 'ADMIN_INSPECT',
                targetId: resource.targetId,
                correlationId: resource.correlationId
            });
        }
        return execute(principal, operation, {
            targetId: resource.targetId,
            ...(resource.correlationId === undefined
                ? {}
                : { correlationId: resource.correlationId })
        });
    }

    async function getAuditContext(principal, operation, request) {
        const validated = validateOperationRequest(operation, request);
        if (!validated.ok) return validated;
        const authorized = await authorize(
            principal,
            validated.definition.requiredPermission,
            { operation, targetId: request.targetId }
        );
        if (!authorized.ok) return authorized;
        if (validated.definition.mfaRequired &&
            authorized.data.principal.authLevel < AUTH_LEVELS.MFA) {
            return failure(ADMINISTRATION_ERRORS.MFA_REQUIRED);
        }
        let timestamp;
        try {
            timestamp = new Date(now()).toISOString();
        } catch {
            return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        }
        const correlationId = validated.correlationId || idFactory();
        if (!validId(correlationId)) return failure(ADMINISTRATION_ERRORS.INVALID_REQUEST);
        return {
            ok: true,
            data: Object.freeze({
                adminId: authorized.data.principal.adminId,
                sessionId: authorized.data.principal.sessionId,
                operation,
                targetType: validated.definition.targetType,
                targetId: request.targetId,
                reason: validated.reason,
                correlationId,
                timestamp,
                schemaVersion: SCHEMA_VERSION
            })
        };
    }

    return Object.freeze({
        authorize,
        execute,
        inspect,
        getAuditContext
    });
}

module.exports = Object.freeze({
    ADMIN_ROLES,
    ADMIN_PERMISSIONS,
    ROLE_POLICY_VERSION,
    DEFAULT_ROLE_PERMISSIONS,
    AUTH_LEVELS,
    OPERATION_DEFINITIONS,
    ADMINISTRATION_ERRORS,
    createAdministrationService
});
