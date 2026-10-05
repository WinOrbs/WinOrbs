'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    OBSERVABILITY_CATEGORIES,
    OBSERVABILITY_ERRORS,
    OBSERVABILITY_OUTCOMES,
    createObservabilityService
} = require('../packages/observability/v2');

async function run() {
    const emitted = [];
    const service = createObservabilityService({
        sink: { write: async (event) => emitted.push(event) },
        clock: () => new Date('2026-10-04T12:30:00.000Z')
    });
    const base = (eventId, extra = {}) => ({
        eventId,
        eventType: 'match.started',
        operation: 'match.start',
        outcome: 'SUCCESS',
        ...extra
    });

    const callerEvent = base('event-1', {
        category: 'MATCH',
        correlationId: 'corr-1',
        requestId: 'req-1',
        actorId: 'actor-1',
        matchId: 'match-1',
        metadata: { mode: 'ranked' }
    });
    const valid = await service.logEvent(callerEvent);
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(valid.data.schemaVersion, 1);
    assert.strictEqual(valid.data.eventId, 'event-1');
    assert.strictEqual(valid.data.timestamp, '2026-10-04T12:30:00.000Z');
    assert.strictEqual(valid.data.correlationId, 'corr-1');
    assert.strictEqual(valid.data.requestId, 'req-1');
    assert.strictEqual(valid.data.actorId, 'actor-1');
    assert.strictEqual(valid.data.matchId, 'match-1');
    assert.deepStrictEqual(valid.data.metadata, { mode: 'ranked' });
    assert.ok(OBSERVABILITY_CATEGORIES.includes(valid.data.category));
    assert.ok(OBSERVABILITY_OUTCOMES.includes(valid.data.outcome));
    assert.strictEqual(Object.isFrozen(valid.data), true);
    assert.strictEqual(Object.isFrozen(valid.data.metadata), true);
    assert.strictEqual(emitted.length, 1);
    callerEvent.metadata.mode = 'changed-after-emission';
    assert.strictEqual(valid.data.metadata.mode, 'ranked');
    assert.strictEqual(emitted[0].metadata.mode, 'ranked');

    assert.strictEqual((await service.logEvent(base('bad-category', {
        category: 'UNKNOWN'
    }))).error.code, OBSERVABILITY_ERRORS.INVALID_CATEGORY);
    assert.strictEqual((await service.logEvent(base('bad-outcome', {
        category: 'SYSTEM',
        outcome: 'MAYBE'
    }))).error.code, OBSERVABILITY_ERRORS.INVALID_OUTCOME);
    assert.strictEqual((await service.logEvent({
        eventType: 'missing.id',
        operation: 'test',
        outcome: 'SUCCESS',
        category: 'SYSTEM'
    })).error.code, OBSERVABILITY_ERRORS.MISSING_EVENT_ID);
    assert.strictEqual((await service.logEvent(base('bad-timestamp', {
        category: 'SYSTEM',
        timestamp: 'not-a-date'
    }))).error.code, OBSERVABILITY_ERRORS.MISSING_TIMESTAMP);

    const sensitive = await service.logEvent(base('sanitize-1', {
        category: 'SYSTEM',
        metadata: {
            keep: 'value',
            password: 'pw',
            access_token: 'token',
            secretValue: 'secret',
            credential: 'credential',
            privateKeyPem: 'private key',
            serviceAccount: { key: 'account' },
            authorization: 'Bearer credentials',
            cookie: 'cookie-value',
            nested: { safe: true, payment_credential: 'payment' }
        }
    }));
    assert.strictEqual(sensitive.ok, true);
    assert.deepStrictEqual(sensitive.data.metadata, {
        keep: 'value',
        nested: { safe: true }
    });
    const serializedSensitive = JSON.stringify(sensitive.data);
    for (const forbidden of [
        'pw', 'token', 'secret', 'credential', 'private key', 'account',
        'Bearer', 'cookie-value', 'payment'
    ]) {
        assert.strictEqual(serializedSensitive.includes(forbidden), false);
    }

    const security = await service.logSecurityEvent(base('security-1', {
        category: 'SYSTEM',
        eventType: 'authorization.denied',
        outcome: 'DENIED',
        actorId: 'actor-1'
    }));
    const admin = await service.logAdminAction(base('admin-1', {
        category: 'SYSTEM',
        eventType: 'admin.action',
        actorId: 'admin-1',
        metadata: { targetResource: 'match:match-1', reason: 'support request' }
    }));
    const match = await service.logMatchEvent(base('match-event-1', {
        category: 'SYSTEM'
    }));
    const recovery = await service.logRecoveryEvent(base('recovery-1', {
        category: 'SYSTEM',
        eventType: 'recovery.attempted',
        outcome: 'STARTED'
    }));
    const economy = await service.logEconomyEvent(base('economy-1', {
        category: 'SYSTEM',
        eventType: 'ledger.appended',
        outcome: 'COMPLETED'
    }));
    assert.deepStrictEqual(
        [security.data.category, admin.data.category, match.data.category,
            recovery.data.category, economy.data.category],
        ['SECURITY', 'ADMIN', 'MATCH', 'RECOVERY', 'ECONOMY']
    );

    const context = service.createCorrelationContext({
        requestId: 'request-2',
        actorId: 'actor-2',
        sessionId: 'session-2',
        matchId: 'match-2'
    });
    assert.strictEqual(context.ok, true);
    assert.ok(context.data.correlationId);
    assert.strictEqual(context.data.requestId, 'request-2');
    assert.strictEqual(Object.isFrozen(context.data), true);
    assert.strictEqual(service.createCorrelationContext({ token: 'sensitive' })
        .error.code, OBSERVABILITY_ERRORS.INVALID_CORRELATION_CONTEXT);

    assert.strictEqual((await service.logEvent(base('duplicate', {
        category: 'SYSTEM'
    }))).ok, true);
    assert.strictEqual((await service.logEvent(base('duplicate', {
        category: 'SYSTEM'
    }))).error.code, OBSERVABILITY_ERRORS.INVALID_EVENT);

    let releaseSink;
    const concurrentService = createObservabilityService({
        sink: () => new Promise((resolve) => { releaseSink = resolve; }),
        clock: () => 1
    });
    const pending = concurrentService.logEvent(base('concurrent', { category: 'SYSTEM' }));
    const repeated = await concurrentService.logEvent(base('concurrent', {
        category: 'SYSTEM'
    }));
    assert.strictEqual(repeated.error.code, OBSERVABILITY_ERRORS.INVALID_EVENT);
    releaseSink();
    assert.strictEqual((await pending).ok, true);

    const invalidClock = createObservabilityService({
        sink: async () => {},
        clock: () => 'invalid'
    });
    assert.strictEqual((await invalidClock.logEvent(base('clock-error', {
        category: 'SYSTEM'
    }))).error.code, OBSERVABILITY_ERRORS.MISSING_TIMESTAMP);
    const failedSink = createObservabilityService({
        sink: async () => { throw new Error('private sink details'); },
        clock: () => 1
    });
    const sinkFailure = await failedSink.logEvent(base('sink-error', {
        category: 'ERROR'
    }));
    assert.strictEqual(sinkFailure.error.code, OBSERVABILITY_ERRORS.SINK_FAILURE);
    assert.strictEqual(JSON.stringify(sinkFailure).includes('private sink details'), false);
    const rejectedSink = createObservabilityService({
        sink: async () => ({ ok: false }),
        clock: () => 1
    });
    assert.strictEqual((await rejectedSink.logEvent(base('sink-rejected', {
        category: 'ERROR'
    }))).error.code, OBSERVABILITY_ERRORS.SINK_FAILURE);

    const source = fs.readFileSync(
        path.join(__dirname, '../packages/observability/v2/index.js'), 'utf8'
    );
    const importPaths = [
        ...source.matchAll(/require\(['"]([^'"]+)['"]\)|from ['"]([^'"]+)['"]/g)
    ].map((match) => (match[1] || match[2]).toLowerCase());
    for (const forbiddenImport of [
        'economy', 'settlement', 'game-engine', 'firebase', 'firestore',
        'express', 'socket.io', 'server.js'
    ]) {
        assert.strictEqual(importPaths.some((importPath) =>
            importPath.includes(forbiddenImport)), false, `Forbidden dependency: ${forbiddenImport}`);
    }

    console.log('OK observability v2: structured, sanitized immutable events and isolated sink failures.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
