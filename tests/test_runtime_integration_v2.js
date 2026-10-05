'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const { createObservabilityService } = require('../packages/observability/v2');
const {
    DEFAULT_ROUTING_POLICY,
    RUNTIME_INTEGRATION_ERRORS,
    createRuntimeIntegrationBoundary
} = require('../packages/runtime-integration/v2');

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cloneMap(map) {
    return new Map([...map].map(([key, value]) => [key, clone(value)]));
}

function makePersistence(matchIds = ['match-1', 'match-2', 'match-3']) {
    let state = {
        matches: new Map(matchIds.map((matchId) => [matchId, {
            matchId,
            status: 'WAITING',
            matchPersistence: { stateVersion: 1 }
        }])),
        idempotency: new Map()
    };
    let queue = Promise.resolve();
    const idKey = (scope, key) => `${scope}\u0000${key}`;
    function current(transaction) {
        return transaction?.state || state;
    }
    const repositories = {
        MatchRepository: {
            async getById(matchId, transaction) {
                return clone(current(transaction).matches.get(matchId) || null);
            },
            async create(matchId, value, transaction) {
                current(transaction).matches.set(matchId, clone(value));
            },
            async update(matchId, patch, transaction) {
                const target = current(transaction).matches;
                target.set(matchId, { ...target.get(matchId), ...clone(patch) });
            },
            async claimSettlement() {
                return { claimed: false, settlement: null };
            }
        },
        IdempotencyRepository: {
            async getByKey(scope, key, transaction) {
                return clone(current(transaction).idempotency.get(idKey(scope, key)) || null);
            },
            async claim(scope, key, value, transaction) {
                const records = current(transaction).idempotency;
                const id = idKey(scope, key);
                if (records.has(id)) {
                    return { claimed: false, record: clone(records.get(id)) };
                }
                const record = { ...clone(value), scope, key };
                records.set(id, record);
                return { claimed: true, record: clone(record) };
            }
        },
        async runInTransaction(work) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            await previous;
            const staged = {
                matches: cloneMap(state.matches),
                idempotency: cloneMap(state.idempotency)
            };
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
        },
        getMatch(matchId) {
            return clone(state.matches.get(matchId) || null);
        },
        setMatch(matchId, value) {
            state.matches.set(matchId, clone(value));
        },
        idempotencyCount() {
            return state.idempotency.size;
        }
    };
    return repositories;
}

function makeObservability(events = []) {
    return {
        events,
        async logEvent(event) {
            events.push(clone(event));
            return { ok: true };
        }
    };
}

function policy(overrides = {}) {
    return {
        enabled: true,
        rolloutPercentage: 0,
        allowlist: [],
        denylist: [],
        testUsers: [],
        testMatches: [],
        killSwitch: false,
        policyVersion: 'routing-test-v1',
        ...overrides
    };
}

function makeBoundary({
    persistence = makePersistence(),
    events = [],
    routing = DEFAULT_ROUTING_POLICY,
    ids = null
} = {}) {
    let sequence = 0;
    return {
        persistence,
        events,
        boundary: createRuntimeIntegrationBoundary({
            persistence,
            observability: makeObservability(events),
            clock: () => 10000,
            idFactory: ids || (() => `assignment-${++sequence}`),
            policy: routing
        })
    };
}

const v2Context = (matchId, extras = {}) => ({
    matchId,
    userId: 'test-user',
    correlationId: `corr-${matchId}`,
    ...extras
});

async function run() {
    assert.equal(DEFAULT_ROUTING_POLICY.enabled, false);
    assert.equal(DEFAULT_ROUTING_POLICY.rolloutPercentage, 0);
    assert.equal(DEFAULT_ROUTING_POLICY.killSwitch, true);
    assert.deepEqual(DEFAULT_ROUTING_POLICY.allowlist, []);
    assert.deepEqual(DEFAULT_ROUTING_POLICY.denylist, []);

    const defaults = makeBoundary();
    const defaultAssignment = await defaults.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    });
    assert.equal(defaultAssignment.data.assignment.runtime, 'LEGACY');
    assert.equal(defaultAssignment.data.assignment.status, 'ASSIGNED');

    const allowlisted = makeBoundary({
        routing: policy({ allowlist: ['match-1'] })
    });
    const allowlistAssignment = await allowlisted.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    });
    assert.equal(allowlistAssignment.data.assignment.runtime, 'V2');

    const denylisted = makeBoundary({
        routing: policy({ allowlist: ['match-1'], denylist: ['match-1'] })
    });
    assert.equal((await denylisted.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).data.assignment.runtime, 'LEGACY');

    const rolloutZero = makeBoundary({
        routing: policy({ rolloutPercentage: 0 })
    });
    assert.equal((await rolloutZero.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).data.assignment.runtime, 'LEGACY');
    assert.ok(rolloutZero.events.some((event) =>
        event.metadata.eventName === 'runtime.v2.blocked'));

    const rolloutFull = makeBoundary({
        routing: policy({ rolloutPercentage: 100 })
    });
    assert.equal((await rolloutFull.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).data.assignment.runtime, 'V2');

    const testUser = makeBoundary({
        routing: policy({ testUsers: ['test-user'] })
    });
    assert.equal((await testUser.boundary.resolveRuntimeAssignment(
        v2Context('match-1')
    )).data.assignment.runtime, 'V2');
    const testMatch = makeBoundary({
        routing: policy({ testMatches: ['match-1'] })
    });
    assert.equal((await testMatch.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).data.assignment.runtime, 'V2');

    const killEnabled = makeBoundary({
        routing: policy({ allowlist: ['match-1'], killSwitch: true })
    });
    const killAssignment = await killEnabled.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    });
    assert.equal(killAssignment.data.assignment.runtime, 'LEGACY');
    assert.ok(killEnabled.events.some((event) =>
        event.metadata.eventName === 'runtime.kill_switch'));

    const stickyPersistence = makePersistence();
    const beforeSwitch = makeBoundary({
        persistence: stickyPersistence,
        routing: policy({ allowlist: ['match-1'] })
    });
    const initialV2 = await beforeSwitch.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'sticky-initial'
    });
    assert.equal(initialV2.data.assignment.runtime, 'V2');
    const active = await beforeSwitch.boundary.activateMatch('match-1');
    assert.equal(active.data.assignment.status, 'ACTIVE');
    const afterSwitch = makeBoundary({
        persistence: stickyPersistence,
        routing: policy({ killSwitch: true })
    });
    const keptV2 = await afterSwitch.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'sticky-retry'
    });
    assert.equal(keptV2.data.assignment.runtime, 'V2');
    assert.equal(keptV2.data.assignment.status, 'ACTIVE');
    const newAfterSwitch = await afterSwitch.boundary.resolveRuntimeAssignment({
        matchId: 'match-2'
    });
    assert.equal(newAfterSwitch.data.assignment.runtime, 'LEGACY');

    const repeated = makeBoundary({
        routing: policy({ allowlist: ['match-1'] })
    });
    const created = await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'same-key',
        correlationId: 'corr-original'
    });
    const createdAgain = await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'same-key',
        correlationId: 'corr-retry'
    });
    assert.deepEqual(createdAgain, created);
    assert.equal(repeated.persistence.idempotencyCount(), 1);
    assert.equal(repeated.events.at(-1).metadata.eventName, 'runtime.assignment.reused');

    const incompatibleKey = await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'same-key',
        requestedMode: 'LEGACY'
    });
    assert.equal(incompatibleKey.error.code, RUNTIME_INTEGRATION_ERRORS.IDEMPOTENCY_CONFLICT);
    assert.equal((await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'try-switch-to-legacy',
        requestedMode: 'LEGACY'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT);
    const requestedV2Conflict = await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-2',
        requestedMode: 'V2'
    });
    assert.equal(requestedV2Conflict.error.code,
        RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT);
    const requestedLegacyConflict = await makeBoundary({
        routing: policy({ rolloutPercentage: 100 })
    }).boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        requestedMode: 'LEGACY'
    });
    assert.equal(requestedLegacyConflict.error.code,
        RUNTIME_INTEGRATION_ERRORS.ASSIGNMENT_CONFLICT);
    assert.equal((await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-3',
        runtime: 'V2'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.INVALID_REQUEST);

    assert.equal((await repeated.boundary.activateMatch('match-1')).ok, true);
    assert.equal((await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'status-refresh'
    })).data.assignment.status, 'ACTIVE');
    assert.equal((await repeated.boundary.finishMatch('match-1')).data.assignment.status,
        'FINISHED');
    assert.equal((await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'finished-recovery'
    })).data.assignment.status, 'FINISHED');
    assert.equal((await repeated.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'same-key'
    })).data.assignment.status, 'FINISHED');
    assert.equal((await repeated.boundary.activateMatch('match-1')).error.code,
        RUNTIME_INTEGRATION_ERRORS.INVALID_TRANSITION);

    const aborted = makeBoundary({
        routing: policy({ allowlist: ['match-2'] })
    });
    await aborted.boundary.resolveRuntimeAssignment({ matchId: 'match-2' });
    assert.equal((await aborted.boundary.abortMatch('match-2')).data.assignment.status,
        'ABORTED');
    assert.equal((await aborted.boundary.resolveRuntimeAssignment({
        matchId: 'match-2',
        idempotencyKey: 'aborted-recovery'
    })).data.assignment.status, 'ABORTED');
    assert.equal((await aborted.boundary.activateMatch('match-2')).error.code,
        RUNTIME_INTEGRATION_ERRORS.INVALID_TRANSITION);

    const concurrent = makeBoundary({
        routing: policy({ rolloutPercentage: 100 })
    });
    const concurrentRequests = await Promise.all([
        concurrent.boundary.resolveRuntimeAssignment({
            matchId: 'match-1',
            idempotencyKey: 'parallel-a'
        }),
        concurrent.boundary.resolveRuntimeAssignment({
            matchId: 'match-1',
            idempotencyKey: 'parallel-b'
        })
    ]);
    assert.deepEqual(concurrentRequests[0], concurrentRequests[1]);
    assert.equal(concurrent.persistence.getMatch('match-1').runtimeAssignment.runtime, 'V2');
    assert.equal(concurrent.persistence.idempotencyCount(), 2);

    const restartPersistence = makePersistence();
    const firstProcess = makeBoundary({
        persistence: restartPersistence,
        routing: policy({ allowlist: ['match-1'] })
    });
    const beforeRestart = await firstProcess.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'restart-key'
    });
    const restartedProcess = makeBoundary({
        persistence: restartPersistence,
        routing: policy({ killSwitch: true })
    });
    const afterRestart = await restartedProcess.boundary.resolveRuntimeAssignment({
        matchId: 'match-1',
        idempotencyKey: 'restart-key'
    });
    assert.deepEqual(afterRestart, beforeRestart);

    const inconsistentPersistence = makePersistence();
    const malformedMatch = inconsistentPersistence.getMatch('match-1');
    malformedMatch.runtimeAssignment = {
        matchId: 'different-match',
        runtime: 'V2',
        assignmentId: 'orphan',
        policyVersion: 'routing-old',
        assignedAt: 10,
        status: 'ACTIVE',
        schemaVersion: SCHEMA_VERSION
    };
    inconsistentPersistence.setMatch('match-1', malformedMatch);
    const inconsistent = makeBoundary({ persistence: inconsistentPersistence });
    assert.equal((await inconsistent.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);
    const duplicatePersistence = makePersistence();
    const duplicateMatch = duplicatePersistence.getMatch('match-1');
    duplicateMatch.runtimeAssignments = [
        {
            matchId: 'match-1',
            runtime: 'LEGACY',
            assignmentId: 'legacy-assignment',
            policyVersion: 'routing-old',
            assignedAt: 1,
            status: 'ACTIVE',
            schemaVersion: SCHEMA_VERSION
        },
        {
            matchId: 'match-1',
            runtime: 'V2',
            assignmentId: 'v2-assignment',
            policyVersion: 'routing-new',
            assignedAt: 2,
            status: 'ACTIVE',
            schemaVersion: SCHEMA_VERSION
        }
    ];
    duplicatePersistence.setMatch('match-1', duplicateMatch);
    assert.equal((await makeBoundary({
        persistence: duplicatePersistence
    }).boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.AUTHORITY_CONFLICT);

    const noMatch = makeBoundary({ persistence: makePersistence([]) });
    assert.equal((await noMatch.boundary.resolveRuntimeAssignment({
        matchId: 'missing'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.MATCH_NOT_FOUND);
    const failedSinkEvents = [];
    const sinkFailurePersistence = makePersistence();
    const sinkFailure = createRuntimeIntegrationBoundary({
        persistence: sinkFailurePersistence,
        observability: { async logEvent() { return { ok: false }; } },
        clock: () => 10000,
        idFactory: () => 'sink-failure-assignment',
        policy: policy({ allowlist: ['match-1'] })
    });
    assert.equal((await sinkFailure.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).error.code, RUNTIME_INTEGRATION_ERRORS.OBSERVABILITY_ERROR);
    assert.equal(sinkFailurePersistence.getMatch('match-1')
        .runtimeAssignment.assignmentId, 'sink-failure-assignment');
    const sinkFailureRetry = makeBoundary({
        persistence: sinkFailurePersistence,
        events: failedSinkEvents,
        routing: policy({ killSwitch: true })
    });
    assert.equal((await sinkFailureRetry.boundary.resolveRuntimeAssignment({
        matchId: 'match-1'
    })).data.assignment.runtime, 'V2');
    assert.throws(() => makeBoundary({
        routing: { ...policy(), unexpected: true }
    }), /INVALID_POLICY/);
    assert.throws(() => makeBoundary({
        routing: { ...policy(), rolloutPercentage: 101 }
    }), /INVALID_POLICY/);

    const capturedEvents = [];
    const observability = createObservabilityService({
        sink: async (event) => {
            capturedEvents.push(event);
            return true;
        },
        clock: () => 10000
    });
    let eventId = 0;
    const integrated = createRuntimeIntegrationBoundary({
        persistence: makePersistence(),
        observability,
        clock: () => 10000,
        idFactory: () => `integration-event-${++eventId}`,
        policy: policy({ allowlist: ['match-1'] })
    });
    const observedAssignment = await integrated.resolveRuntimeAssignment({
        matchId: 'match-1',
        correlationId: 'corr-observed'
    });
    assert.equal(observedAssignment.ok, true);
    assert.equal(capturedEvents[0].operation, 'runtime.assignment.created');
    assert.equal(capturedEvents[0].correlationId, 'corr-observed');
    assert.equal(capturedEvents[0].matchId, 'match-1');
    assert.equal(capturedEvents[0].metadata.assignmentId,
        observedAssignment.data.assignment.assignmentId);
    assert.equal(capturedEvents[0].metadata.runtime, 'V2');
    assert.equal(capturedEvents[0].metadata.policyVersion, 'routing-test-v1');
    assert.doesNotMatch(JSON.stringify(capturedEvents),
        /password|token|secret|credential|privateKey|serviceAccount|cookie|authorization/i);

    const eventNames = new Set(defaults.events.map((event) => event.metadata.eventName));
    assert.ok(eventNames.has('runtime.assignment.created'));
    assert.ok(repeated.events.some((event) =>
        event.metadata.eventName === 'runtime.assignment.reused'));
    assert.ok(repeated.events.some((event) =>
        event.metadata.eventName === 'runtime.assignment.rejected' ||
        event.metadata.eventName === 'runtime.authority_conflict'));

    const source = fs.readFileSync(path.join(
        __dirname,
        '../packages/runtime-integration/v2/index.js'
    ), 'utf8');
    assert.doesNotMatch(source,
        /\brequire\s*\(\s*['"][^'"]*(?:server\.js|firebase|firestore|express|socket\.io|economy|settlement|progression|game-engine|public\/)[^'"]*['"]\s*\)/i);
    assert.doesNotMatch(source,
        /\b(?:WalletRepository|LedgerRepository|ProgressionRepository|Economy|Settlement|GameEngine)\b/);
    assert.match(source, /MatchRepository/);
    assert.match(source, /IdempotencyRepository/);

    console.log('OK runtime integration v2: sticky runtime authority, transactional assignment and fail-closed rollout.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
