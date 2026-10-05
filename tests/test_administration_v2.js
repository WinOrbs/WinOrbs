'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    SCHEMA_VERSION
} = require('../packages/contracts/v2');
const { createObservabilityService } = require('../packages/observability/v2');
const {
    ADMINISTRATION_ERRORS,
    createAdministrationService
} = require('../packages/administration/v2');

function clone(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function cloneState(source) {
    return {
        idempotency: new Map([...source.idempotency].map(([key, value]) =>
            [key, clone(value)])),
        users: new Map([...source.users].map(([key, value]) => [key, clone(value)])),
        wallet: new Map([...source.wallet].map(([key, value]) => [key, clone(value)])),
        ledger: new Map([...source.ledger].map(([key, value]) => [key, clone(value)])),
        gameState: new Map([...source.gameState].map(([key, value]) => [key, clone(value)]))
    };
}

function makePersistence() {
    let state = {
        idempotency: new Map(),
        users: new Map([['user-1', { status: 'ACTIVE' }]]),
        wallet: new Map([['user-1', { balance: 125 }]]),
        ledger: new Map([['entry-1', { amount: 25 }]]),
        gameState: new Map([['match-1', { status: 'ACTIVE' }]])
    };
    let queue = Promise.resolve();
    const keyFor = (scope, key) => `${scope}\u0000${key}`;
    const repository = {
        async getByKey(scope, key, transaction) {
            return clone((transaction?.state || state).idempotency.get(keyFor(scope, key)) || null);
        },
        async claim(scope, key, value, transaction) {
            const records = (transaction?.state || state).idempotency;
            const id = keyFor(scope, key);
            if (records.has(id)) {
                return { claimed: false, record: clone(records.get(id)) };
            }
            const record = { ...clone(value), scope, key };
            records.set(id, record);
            return { claimed: true, record: clone(record) };
        }
    };
    return {
        IdempotencyRepository: repository,
        async runInTransaction(work) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            await previous;
            const staged = cloneState(state);
            try {
                const response = await work({
                    IdempotencyRepository: repository,
                    transaction: { state: staged }
                });
                state = staged;
                return response;
            } finally {
                release();
            }
        },
        snapshot() {
            return clone({
                users: [...state.users],
                wallet: [...state.wallet],
                ledger: [...state.ledger],
                gameState: [...state.gameState],
                idempotency: [...state.idempotency]
            });
        }
    };
}

function principal({
    adminId = 'admin-1',
    sessionId = 'session-1',
    expiresAt = 9000,
    roles = ['ADMIN'],
    authLevel = 2
} = {}) {
    return {
        adminId,
        sessionId,
        authenticatedAt: 100,
        expiresAt,
        roles,
        permissions: ['admin.system.inspect'],
        authLevel,
        schemaVersion: SCHEMA_VERSION
    };
}

function makeService({
    persistence = makePersistence(),
    events = [],
    principals = {
        root: principal({ adminId: 'root-1', roles: ['SUPER_ADMIN'] }),
        admin: principal(),
        'admin-low-auth': principal({ authLevel: 1 }),
        support: principal({ adminId: 'support-1', roles: ['SUPPORT'] }),
        auditor: principal({ adminId: 'auditor-1', roles: ['AUDITOR'] }),
        expired: principal({ expiresAt: 500 }),
        'unknown-role': principal({ roles: ['GOD_MODE'] })
    },
    adapters = {},
    observability = null
} = {}) {
    let eventSequence = 0;
    let handlerCalls = 0;
    const resolvePrincipal = async (candidate) => {
        if (candidate?.credential === 'missing') return null;
        const value = principals[candidate?.credential];
        return value ? clone(value) : null;
    };
    const fakeObservability = {
        async logAdminAction(event) {
            events.push(clone(event));
            return { ok: true };
        }
    };
    const operationAdapters = {
        MATCH_INSPECT: async ({ targetId }) => {
            handlerCalls += 1;
            return { ok: true, data: { matchId: targetId } };
        },
        USER_VIEW: async ({ targetId }) => {
            handlerCalls += 1;
            return { ok: true, data: { userId: targetId } };
        },
        USER_SUSPEND: async ({ targetId, transaction }) => {
            handlerCalls += 1;
            transaction.state.users.set(targetId, { status: 'SUSPENDED' });
            return { ok: true, data: { userId: targetId, status: 'SUSPENDED' } };
        },
        USER_UNSUSPEND: async ({ targetId, transaction }) => {
            handlerCalls += 1;
            transaction.state.users.set(targetId, { status: 'ACTIVE' });
            return { ok: true, data: { userId: targetId, status: 'ACTIVE' } };
        },
        MATCH_TERMINATE: async ({ targetId, transaction }) => {
            handlerCalls += 1;
            transaction.state.gameState.set(targetId, { status: 'TERMINATED' });
            return { ok: true, data: { matchId: targetId, status: 'TERMINATED' } };
        },
        ...adapters
    };
    const service = createAdministrationService({
        resolvePrincipal,
        observability: observability || fakeObservability,
        persistence,
        clock: () => 1000,
        idFactory: () => `admin-event-${++eventSequence}`,
        operationAdapters
    });
    return {
        service,
        persistence,
        events,
        handlerCalls: () => handlerCalls
    };
}

async function run() {
    const context = makeService();
    const support = { credential: 'support' };
    const root = { credential: 'root' };
    const admin = { credential: 'admin' };

    const permitted = await context.service.authorize(support, 'admin.match.inspect');
    assert.equal(permitted.ok, true);
    assert.deepEqual(permitted.data.principal.permissions, [
        'admin.match.inspect',
        'admin.match.view',
        'admin.progression.view',
        'admin.user.view'
    ]);
    assert.equal((await context.service.authorize(support, 'admin.user.suspend'))
        .error.code, ADMINISTRATION_ERRORS.ACCESS_DENIED);
    assert.equal((await context.service.authorize(support, 'admin.not-real'))
        .error.code, ADMINISTRATION_ERRORS.UNKNOWN_PERMISSION);
    assert.equal((await context.service.authorize({ credential: 'missing' }, 'admin.user.view'))
        .error.code, ADMINISTRATION_ERRORS.INVALID_PRINCIPAL);
    assert.equal((await context.service.authorize({ credential: 'expired' }, 'admin.user.view'))
        .error.code, ADMINISTRATION_ERRORS.PRINCIPAL_EXPIRED);
    assert.equal((await context.service.authorize({ credential: 'unknown-role' }, 'admin.user.view'))
        .error.code, ADMINISTRATION_ERRORS.UNKNOWN_ROLE);

    assert.equal((await context.service.execute(support, 'UNLISTED_OPERATION', {
        targetId: 'user-1'
    })).error.code, ADMINISTRATION_ERRORS.UNKNOWN_OPERATION);
    assert.equal((await context.service.execute({ credential: 'admin-low-auth' }, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'suspend-low-auth'
    })).error.code, ADMINISTRATION_ERRORS.MFA_REQUIRED);
    assert.equal((await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        idempotencyKey: 'suspend-no-reason'
    })).error.code, ADMINISTRATION_ERRORS.INVALID_REASON);
    assert.equal((await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Includes token-like credential',
        idempotencyKey: 'suspend-secret-reason'
    })).error.code, ADMINISTRATION_ERRORS.INVALID_REASON);
    assert.equal((await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'r'.repeat(501),
        idempotencyKey: 'suspend-long-reason'
    })).error.code, ADMINISTRATION_ERRORS.INVALID_REASON);
    assert.equal((await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: {},
        reason: 'Repeated abuse reports',
        idempotencyKey: 'suspend-invalid-target'
    })).error.code, ADMINISTRATION_ERRORS.INVALID_TARGET);

    const withReason = await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'suspend-user-1',
        correlationId: 'corr-suspend-1'
    });
    assert.equal(withReason.ok, true);
    assert.equal(withReason.data.status, 'SUSPENDED');
    assert.equal(context.events.at(-1).outcome, 'SUCCESS');
    assert.equal(context.events.at(-1).schemaVersion, SCHEMA_VERSION);
    assert.equal(context.events.at(-1).correlationId, 'corr-suspend-1');
    assert.equal(context.events.at(-1).actorId, 'admin-1');
    assert.equal(context.events.at(-1).sessionId, 'session-1');
    assert.equal(context.events.at(-1).metadata.adminId, 'admin-1');
    assert.equal(context.events.at(-1).metadata.operation, 'USER_SUSPEND');
    assert.equal(context.events.at(-1).metadata.reason, 'Repeated abuse reports');
    assert.equal(context.events.at(-1).metadata.schemaVersion, SCHEMA_VERSION);
    assert.equal(context.persistence.snapshot().users[0][1].status, 'SUSPENDED');

    const callsBeforeRetry = context.handlerCalls();
    const retry = await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'suspend-user-1',
        correlationId: 'corr-suspend-retry'
    });
    assert.equal(retry.ok, true);
    assert.deepEqual(retry, withReason);
    assert.equal(context.handlerCalls(), callsBeforeRetry);
    assert.equal(context.events.at(-1).outcome, 'RETRY');
    assert.equal(context.events.at(-1).correlationId, 'corr-suspend-retry');

    const incompatible = await context.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-2',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'suspend-user-1'
    });
    assert.equal(incompatible.error.code, ADMINISTRATION_ERRORS.IDEMPOTENCY_CONFLICT);
    assert.equal(context.persistence.snapshot().users.length, 1);

    const spoofedPrivilege = await context.service.execute(
        { credential: 'support', roles: ['SUPER_ADMIN'], permissions: ['admin.user.suspend'] },
        'USER_SUSPEND',
        {
            targetId: 'user-2',
            reason: 'Attempted privilege spoof',
            idempotencyKey: 'spoofed-suspend'
        }
    );
    assert.equal(spoofedPrivilege.error.code, ADMINISTRATION_ERRORS.ACCESS_DENIED);
    const spoofedAdminId = await context.service.execute({
        credential: 'support',
        adminId: 'root-1'
    }, 'USER_VIEW', {
        targetId: 'user-1',
        correlationId: 'corr-canonical-admin'
    });
    assert.equal(spoofedAdminId.ok, true);
    assert.equal(context.events.at(-1).actorId, 'support-1');
    assert.equal(context.events.at(-1).metadata.adminId, 'support-1');
    assert.equal((await context.service.execute(admin, 'USER_VIEW', {
        targetId: 'user-1',
        adminId: 'root-1'
    })).error.code, ADMINISTRATION_ERRORS.INVALID_REQUEST);
    assert.equal((await context.service.execute(admin, 'USER_VIEW', {
        targetId: 'user-1',
        roles: ['SUPER_ADMIN']
    })).error.code, ADMINISTRATION_ERRORS.INVALID_REQUEST);

    assert.equal((await context.service.execute(root, 'ADMIN_ROLE_GRANT', {
        targetId: 'root-1',
        reason: 'Self grant',
        idempotencyKey: 'self-escalation'
    })).error.code, ADMINISTRATION_ERRORS.UNKNOWN_OPERATION);
    assert.equal((await context.service.authorize(root, 'admin.role.grant'))
        .error.code, ADMINISTRATION_ERRORS.UNKNOWN_PERMISSION);

    const noMfaContext = makeService({
        principals: { admin: principal({ authLevel: 1 }) }
    });
    const reasonOnly = await noMfaContext.service.getAuditContext(
        { credential: 'admin' },
        'USER_SUSPEND',
        {
            targetId: 'user-1',
            reason: 'Repeated abuse reports',
            idempotencyKey: 'context-key'
        }
    );
    assert.equal(reasonOnly.error.code, ADMINISTRATION_ERRORS.MFA_REQUIRED);

    const auditContext = await context.service.getAuditContext(root, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Review complete',
        idempotencyKey: 'context-key',
        correlationId: 'corr-context'
    });
    assert.equal(auditContext.ok, true);
    assert.equal(auditContext.data.correlationId, 'corr-context');
    assert.equal(auditContext.data.adminId, 'root-1');

    const inspected = await context.service.inspect(support, {
        resourceType: 'MATCH',
        targetId: 'match-1',
        correlationId: 'corr-inspect'
    });
    assert.equal(inspected.ok, true);
    assert.equal(context.events.at(-1).correlationId, 'corr-inspect');
    assert.equal(context.events.at(-1).operation, 'MATCH.INSPECT');

    const authorizedButUnimplemented = await context.service.execute(root, 'PROGRESSION_ADJUST', {
        targetId: 'user-1',
        reason: 'No connected progression service',
        idempotencyKey: 'progression-adjust-unavailable'
    });
    assert.equal(authorizedButUnimplemented.error.code,
        ADMINISTRATION_ERRORS.OPERATION_UNAVAILABLE);
    assert.equal(context.persistence.snapshot().wallet[0][1].balance, 125);
    assert.equal(context.persistence.snapshot().ledger.length, 1);
    assert.equal(context.persistence.snapshot().gameState[0][1].status, 'ACTIVE');

    const unknownFinancialOperation = await context.service.execute(root, 'WALLET_ADJUST', {
        targetId: 'user-1'
    });
    assert.equal(unknownFinancialOperation.error.code,
        ADMINISTRATION_ERRORS.UNKNOWN_OPERATION);
    const unknownGameplayOperation = await context.service.execute(root, 'MATCH_FORCE_WIN', {
        targetId: 'match-1'
    });
    assert.equal(unknownGameplayOperation.error.code,
        ADMINISTRATION_ERRORS.UNKNOWN_OPERATION);
    assert.equal(context.persistence.snapshot().wallet[0][1].balance, 125);
    assert.equal(context.persistence.snapshot().ledger.length, 1);
    assert.equal(context.persistence.snapshot().gameState[0][1].status, 'ACTIVE');

    const rejectedEvent = context.events.find((event) =>
        event.metadata.errorCode === ADMINISTRATION_ERRORS.ACCESS_DENIED);
    assert.ok(rejectedEvent);
    const serializedAudit = JSON.stringify(context.events);
    for (const forbidden of [
        /password/i,
        /token/i,
        /secret/i,
        /credential/i,
        /privatekey/i,
        /serviceaccount/i,
        /cookie/i,
        /authorization/i
    ]) {
        assert.doesNotMatch(serializedAudit, forbidden);
    }
    assert.ok(context.events.every((event) =>
        event.eventType === 'AdminOperation' &&
        event.metadata.rolePolicyVersion === 'admin-role-policy-v1'));

    const deliveredEvents = [];
    const validatedObservability = createObservabilityService({
        sink: async (event) => {
            deliveredEvents.push(event);
            return true;
        },
        clock: () => 1000
    });
    const validatedAudit = makeService({
        observability: validatedObservability
    });
    assert.equal((await validatedAudit.service.execute(support, 'USER_VIEW', {
        targetId: 'user-1'
    })).ok, true);
    assert.equal(deliveredEvents.length, 1);
    assert.equal(deliveredEvents[0].category, 'ADMIN');
    assert.equal(deliveredEvents[0].operation, 'USER.VIEW');
    assert.equal(deliveredEvents[0].metadata.operation, 'USER_VIEW');
    assert.equal(deliveredEvents[0].metadata.adminId, 'support-1');

    const idempotentPersistence = makePersistence();
    let idempotentCalls = 0;
    const idempotentAdapter = makeService({
        persistence: idempotentPersistence,
        adapters: {
            USER_SUSPEND: async () => {
                idempotentCalls += 1;
                return { ok: true, data: { status: 'SUSPENDED' } };
            }
        }
    });
    const first = await idempotentAdapter.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-2',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'durable-key'
    });
    const restartedService = makeService({
        persistence: idempotentPersistence,
        adapters: {
            USER_SUSPEND: async () => {
                idempotentCalls += 1;
                return { ok: true, data: { status: 'SUSPENDED' } };
            }
        }
    });
    const afterRestart = await restartedService.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-2',
        reason: 'Repeated abuse reports',
        idempotencyKey: 'durable-key'
    });
    assert.equal(first.ok, true);
    assert.deepEqual(afterRestart, first);
    assert.equal(idempotentCalls, 1);

    const concurrentPersistence = makePersistence();
    let concurrentCalls = 0;
    const concurrentService = makeService({
        persistence: concurrentPersistence,
        adapters: {
            USER_SUSPEND: async () => {
                concurrentCalls += 1;
                return { ok: true, data: { status: 'SUSPENDED' } };
            }
        }
    });
    const concurrentResponses = await Promise.all([
        concurrentService.service.execute(admin, 'USER_SUSPEND', {
            targetId: 'user-3',
            reason: 'Repeated abuse reports',
            idempotencyKey: 'concurrent-key'
        }),
        concurrentService.service.execute(admin, 'USER_SUSPEND', {
            targetId: 'user-3',
            reason: 'Repeated abuse reports',
            idempotencyKey: 'concurrent-key'
        })
    ]);
    assert.deepEqual(concurrentResponses[0], concurrentResponses[1]);
    assert.equal(concurrentCalls, 1);

    const failingEvents = [];
    const failingObservability = makeService({ events: failingEvents });
    assert.equal((await failingObservability.service.execute(
        { credential: 'support' },
        'USER_SUSPEND',
        {
            targetId: 'user-1',
            reason: 'Not authorized',
            idempotencyKey: 'denied'
        }
    )).error.code, ADMINISTRATION_ERRORS.ACCESS_DENIED);
    assert.ok(failingEvents.length > 0);

    const operationFailure = makeService({
        adapters: {
            USER_SUSPEND: async () => ({ ok: false, error: { code: 'DOMAIN_REJECTED' } })
        }
    });
    assert.equal((await operationFailure.service.execute(admin, 'USER_SUSPEND', {
        targetId: 'user-1',
        reason: 'Domain rejects suspension',
        idempotencyKey: 'domain-reject'
    })).error.code, 'DOMAIN_REJECTED');
    assert.equal(operationFailure.events.at(-1).outcome, 'FAILURE');

    const auditFailure = makeService({
        observability: {
            async logAdminAction() {
                return { ok: false };
            }
        }
    });
    assert.equal((await auditFailure.service.execute(support, 'USER_VIEW', {
        targetId: 'user-1'
    })).error.code, ADMINISTRATION_ERRORS.AUDIT_WRITE_FAILED);

    const source = fs.readFileSync(path.join(
        __dirname,
        '../packages/administration/v2/index.js'
    ), 'utf8');
    assert.doesNotMatch(source,
        /\brequire\s*\(\s*['"][^'"]*(?:firebase|firestore|express|socket\.io|server\.js|public\/|game-engine|economy|settlement|progression)[^'"]*['"]\s*\)/i);
    assert.doesNotMatch(source,
        /\b(?:WalletRepository|LedgerRepository|MatchRepository|ProgressionRepository|GameState)\b/);
    assert.match(source, /IdempotencyRepository/);
    assert.match(source, /observability\.logAdminAction/);

    console.log('OK administration v2: deny-by-default authorization, audited operations and durable idempotency.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
