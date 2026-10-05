'use strict';

const assert = require('assert');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const {
    createProductionAdapterV2,
    RUNTIME_MODES,
    PRODUCTION_ADAPTER_ERROR_CODES
} = require('../packages/production-adapter/v2');

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function createAssignment(overrides = {}) {
    return {
        matchId: 'match-42',
        runtime: 'V2',
        assignmentId: 'assignment-42',
        policyVersion: 'runtime-routing-v1',
        assignedAt: 1_000,
        status: 'ASSIGNED',
        schemaVersion: SCHEMA_VERSION,
        ...overrides
    };
}

function makeRuntimeBoundary(initialAssignments = {}) {
    const assignments = new Map(Object.entries(initialAssignments));
    return {
        async getRuntimeAssignment(matchId) {
            const assignment = assignments.get(matchId);
            if (!assignment) {
                return { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
            }
            return { ok: true, data: { assignment: clone(assignment) } };
        },
        async resolveRuntimeAssignment(context) {
            return { ok: true, data: { assignment: clone(assignments.get(context.matchId)) } };
        },
        setAssignment(matchId, assignment) {
            assignments.set(matchId, clone(assignment));
        },
        snapshot(matchId) {
            return clone(assignments.get(matchId));
        }
    };
}

function makeObservability() {
    const events = [];
    return {
        events,
        async logEvent(event) {
            events.push(clone(event));
            return { ok: true };
        }
    };
}

function makeAdapter({ boundaryAssignments = {}, factoryDelayMs = 0 } = {}) {
    const observability = makeObservability();
    const runtimeBoundary = makeRuntimeBoundary(boundaryAssignments);
    const factoryCalls = [];
    let counter = 0;
    const adapter = createProductionAdapterV2({
        runtimeBoundary,
        bootstrapFactory: async (input) => {
            factoryCalls.push(clone(input));
            counter += 1;
            if (factoryDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, factoryDelayMs));
            }
            return { ok: true, runtime: 'V2', matchId: input.matchId, n: counter };
        },
        observability,
        clock: () => 1_000,
        idFactory: () => `instance-${factoryCalls.length + 1}-${counter + 1}`
    });
    return { adapter, observability, runtimeBoundary, factoryCalls };
}

async function run() {
    assert.deepStrictEqual(RUNTIME_MODES, ['LEGACY', 'V2']);
    assert.strictEqual(
        PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE,
        'CLOSED_INSTANCE');

    const observability = makeObservability();
    const runtimeBoundary = makeRuntimeBoundary({
        'match-legacy': createAssignment({ matchId: 'match-legacy', runtime: 'LEGACY' }),
        'match-v2': createAssignment({ matchId: 'match-v2', runtime: 'V2' }),
        'match-finished': createAssignment({ matchId: 'match-finished', status: 'FINISHED' }),
        'match-aborted': createAssignment({ matchId: 'match-aborted', status: 'ABORTED' })
    });
    const factoryCalls = [];
    const adapter = createProductionAdapterV2({
        runtimeBoundary,
        bootstrapFactory: async (input) => {
            factoryCalls.push(clone(input));
            return { ok: true, runtime: 'V2', matchId: input.matchId };
        },
        observability,
        clock: () => 1_000,
        idFactory: () => 'instance-1'
    });

    const legacyResult = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-legacy',
        runtime: 'LEGACY',
        assignmentId: 'assignment-legacy'
    }));
    assert.strictEqual(legacyResult.ok, true);
    assert.strictEqual(legacyResult.handled, false);
    assert.strictEqual(legacyResult.runtime, 'LEGACY');

    const created = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'V2',
        assignmentId: 'assignment-100'
    }));
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.handled, true);
    assert.strictEqual(created.runtime, 'V2');
    assert.strictEqual(created.instance.runtime, 'V2');
    assert.strictEqual(created.instance.status, 'ACTIVE');
    assert.strictEqual(factoryCalls.length, 1);

    const reused = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'V2',
        assignmentId: 'assignment-100'
    }));
    assert.strictEqual(reused.reused, true);
    assert.strictEqual(reused.ok, true);
    assert.strictEqual(reused.instance.assignmentId, 'assignment-100');
    assert.strictEqual(reused.instance.status, 'ACTIVE');
    assert.strictEqual(factoryCalls.length, 1, 'ACTIVE reuse must not execute bootstrap again');
    assert.strictEqual(reused.instance.assignmentId, created.instance.assignmentId);
    assert.strictEqual(reused.instance.matchId, 'match-100');
    assert.strictEqual(reused.instance.runtime, 'V2');
    assert.strictEqual(reused.instance.policyVersion, 'runtime-routing-v1');

    const conflict = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'V2',
        assignmentId: 'assignment-999'
    }));
    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.error.code, PRODUCTION_ADAPTER_ERROR_CODES.ASSIGNMENT_MISMATCH);
    assert.strictEqual(adapter.getInstance('match-100').assignmentId, 'assignment-100');
    assert.strictEqual(adapter.getInstance('match-100').status, 'ACTIVE');

    const runtimeConflict = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'LEGACY',
        assignmentId: 'assignment-100'
    }));
    assert.strictEqual(runtimeConflict.ok, false);
    assert.strictEqual(runtimeConflict.error.code, PRODUCTION_ADAPTER_ERROR_CODES.RUNTIME_MISMATCH);
    assert.strictEqual(adapter.getInstance('match-100').runtime, 'V2');
    assert.strictEqual(adapter.getInstance('match-100').status, 'ACTIVE');

    const doubleStart = await Promise.all([
        adapter.startAssignedMatch(createAssignment({
            matchId: 'match-200',
            runtime: 'V2',
            assignmentId: 'assignment-200'
        })),
        adapter.startAssignedMatch(createAssignment({
            matchId: 'match-200',
            runtime: 'V2',
            assignmentId: 'assignment-200'
        }))
    ]);
    assert.strictEqual(doubleStart[0].ok, true);
    assert.strictEqual(doubleStart[1].ok, true);
    assert.strictEqual(doubleStart[0].instance.assignmentId, 'assignment-200');
    assert.strictEqual(doubleStart[1].instance.assignmentId, 'assignment-200');
    assert.strictEqual(doubleStart[0].instance.runtime, 'V2');
    assert.strictEqual(doubleStart[1].instance.runtime, 'V2');

    const recovery = await adapter.recoverAssignedMatch('match-v2');
    assert.strictEqual(recovery.ok, true);
    assert.strictEqual(recovery.runtime, 'V2');
    assert.strictEqual(recovery.assignment.assignmentId, 'assignment-42');

    const noRecovery = await adapter.recoverAssignedMatch('match-aborted');
    assert.strictEqual(noRecovery.ok, false);
    assert.strictEqual(noRecovery.error.code, PRODUCTION_ADAPTER_ERROR_CODES.RECOVERY_REQUIRED);

    const alreadyFinished = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-finished',
        runtime: 'V2',
        assignmentId: 'assignment-finished',
        status: 'FINISHED'
    }));
    assert.strictEqual(alreadyFinished.ok, true);
    assert.strictEqual(alreadyFinished.handled, true);

    const invalid = await adapter.startAssignedMatch({
        matchId: 'bad-match',
        runtime: 'V2',
        assignmentId: 'bad',
        policyVersion: 'runtime-routing-v1',
        assignedAt: 'nope',
        status: 'ASSIGNED',
        schemaVersion: SCHEMA_VERSION
    });
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.error.code, PRODUCTION_ADAPTER_ERROR_CODES.INVALID_ASSIGNMENT);

    const closed = await adapter.closeInstance('match-100');
    assert.strictEqual(closed.ok, true);
    assert.strictEqual(closed.instance.status, 'CLOSED');
    assert.strictEqual(closed.instance.assignmentId, 'assignment-100');
    assert.strictEqual(closed.instance.runtime, 'V2');
    assert.strictEqual(closed.instance.matchId, 'match-100');
    assert.strictEqual(closed.instance.policyVersion, 'runtime-routing-v1');

    const factoryCallsBeforeClosed = factoryCalls.length;

    const closedSame = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'V2',
        assignmentId: 'assignment-100'
    }));
    assert.strictEqual(closedSame.ok, false);
    assert.strictEqual(closedSame.error.code, PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE);
    assert.strictEqual(closedSame.reused || false, false);
    assert.strictEqual(factoryCalls.length, factoryCallsBeforeClosed);

    const closedRuntime = await adapter.startAssignedMatch(createAssignment({
        matchId: 'match-100',
        runtime: 'LEGACY',
        assignmentId: 'assignment-100'
    }));
    assert.strictEqual(closedRuntime.ok, false);
    assert.strictEqual(closedRuntime.error.code, PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE);
    assert.strictEqual(adapter.getInstance('match-100').status, 'CLOSED');
    assert.strictEqual(adapter.getInstance('match-100').assignmentId, 'assignment-100');
    assert.strictEqual(adapter.getInstance('match-100').runtime, 'V2');

    const closedConcurrent = await Promise.all([
        adapter.startAssignedMatch(createAssignment({
            matchId: 'match-100',
            runtime: 'V2',
            assignmentId: 'assignment-100'
        })),
        adapter.startAssignedMatch(createAssignment({
            matchId: 'match-100',
            runtime: 'V2',
            assignmentId: 'assignment-100'
        }))
    ]);
    assert.strictEqual(closedConcurrent[0].ok, false);
    assert.strictEqual(closedConcurrent[1].ok, false);
    assert.strictEqual(closedConcurrent[0].error.code, PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE);
    assert.strictEqual(closedConcurrent[1].error.code, PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE);
    assert.strictEqual(adapter.getInstance('match-100').status, 'CLOSED');
    assert.strictEqual(factoryCalls.length, factoryCallsBeforeClosed);

    const closedRecovery = await adapter.recoverAssignedMatch('match-100');
    assert.strictEqual(closedRecovery.ok, false);
    assert.ok(
        [PRODUCTION_ADAPTER_ERROR_CODES.CLOSED_INSTANCE, PRODUCTION_ADAPTER_ERROR_CODES.AUTHORITY_NOT_FOUND].includes(closedRecovery.error.code));
    assert.strictEqual(adapter.getInstance('match-100').status, 'CLOSED');

    const authority = await adapter.getRuntimeAssignment('match-v2');
    assert.strictEqual(authority.ok, true);
    assert.strictEqual(authority.data.assignment.assignmentId, 'assignment-42');
    assert.strictEqual(authority.data.assignment.runtime, 'V2');

    {
        const ctx = makeAdapter({
            boundaryAssignments: {
                'match-rec': createAssignment({ matchId: 'match-rec', assignmentId: 'assignment-rec' })
            }
        });
        assert.strictEqual(ctx.adapter.getInstance('match-rec'), null);
        const authorityBefore = clone((await ctx.adapter.getRuntimeAssignment('match-rec')).data.assignment);
        const rec = await ctx.adapter.recoverAssignedMatch('match-rec');
        assert.strictEqual(rec.ok, true);
        assert.strictEqual(rec.runtime, 'V2');
        assert.strictEqual(rec.assignment.assignmentId, 'assignment-rec');
        assert.strictEqual(ctx.adapter.getInstance('match-rec').status, 'ACTIVE');
        const authorityAfter = (await ctx.adapter.getRuntimeAssignment('match-rec')).data.assignment;
        assert.deepStrictEqual(authorityAfter, authorityBefore);
        assert.strictEqual(ctx.factoryCalls.length, 1);
    }

    {
        const ctx = makeAdapter({
            boundaryAssignments: {
                'match-fin': createAssignment({ matchId: 'match-fin', status: 'FINISHED' }),
                'match-ab': createAssignment({ matchId: 'match-ab', status: 'ABORTED' })
            }
        });
        const fin = await ctx.adapter.recoverAssignedMatch('match-fin');
        assert.strictEqual(fin.ok, false);
        assert.strictEqual(fin.error.code, PRODUCTION_ADAPTER_ERROR_CODES.RECOVERY_REQUIRED);
        const ab = await ctx.adapter.recoverAssignedMatch('match-ab');
        assert.strictEqual(ab.ok, false);
        assert.strictEqual(ab.error.code, PRODUCTION_ADAPTER_ERROR_CODES.RECOVERY_REQUIRED);
        assert.strictEqual(ctx.factoryCalls.length, 0);
    }

    {
        const localAssignment = createAssignment({ matchId: 'match-inc', assignmentId: 'assignment-local' });
        const ctx = makeAdapter({
            boundaryAssignments: {
                'match-inc': clone(localAssignment)
            }
        });
        const started = await ctx.adapter.startAssignedMatch(clone(localAssignment));
        assert.strictEqual(started.ok, true);
        ctx.runtimeBoundary.setAssignment('match-inc', createAssignment({
            matchId: 'match-inc',
            assignmentId: 'assignment-authority-changed'
        }));
        const authorityBefore = ctx.runtimeBoundary.snapshot('match-inc');
        const rec = await ctx.adapter.recoverAssignedMatch('match-inc');
        assert.strictEqual(rec.ok, false);
        assert.strictEqual(rec.error.code, PRODUCTION_ADAPTER_ERROR_CODES.ASSIGNMENT_MISMATCH);
        assert.deepStrictEqual(ctx.runtimeBoundary.snapshot('match-inc'), authorityBefore);
        assert.strictEqual(ctx.adapter.getInstance('match-inc').assignmentId, 'assignment-local');
    }

    assert.ok(observability.events.some((event) => event.operation === 'runtime.adapter.start.accepted'));
    assert.ok(observability.events.some((event) => event.operation === 'runtime.adapter.recovery'));
    assert.ok(observability.events.some((event) => event.operation === 'runtime.adapter.closed'));
    assert.ok(
        observability.events.some((event) =>
            event.operation === 'runtime.adapter.start.rejected' &&
            (event.metadata?.reason === 'CLOSED_INSTANCE' || event.reason === 'CLOSED_INSTANCE')));
    assert.ok(!observability.events.some((event) => JSON.stringify(event).toLowerCase().includes('token')));
    assert.ok(!observability.events.some((event) => JSON.stringify(event).toLowerCase().includes('secret')));

    const source = require('fs').readFileSync(__dirname + '/../packages/production-adapter/v2/index.js', 'utf8');
    assert.ok(!/require\(["'].*server\.js["']\)|import .* from ["'].*server\.js["']/.test(source));
    assert.ok(!/require\(["'].*firebase["']\)|require\(["'].*firestore["']\)|require\(["'].*socket\.io["']\)|require\(["'].*express["']\)/i.test(source));
    assert.ok(!/require\(["'].*economy["']\)|require\(["'].*settlement["']\)|require\(["'].*progression["']\)|require\(["'].*game-engine["']\)/i.test(source));
    assert.ok(!source.includes('server.js'));
    assert.ok(!source.includes('firebase'));
    assert.ok(!source.includes('firestore'));
    assert.ok(!source.includes('socket.io'));
    assert.ok(!source.includes('express'));
    assert.ok(!source.includes('economy'));
    assert.ok(!source.includes('settlement'));
    assert.ok(!source.includes('progression'));
    assert.ok(!source.includes('game-engine'));
    assert.ok(!/MatchResult|payout|gameplay/i.test(source));
    assert.ok(!source.includes('firebase-admin'));
    assert.ok(!/\.listen\(|app\.get\(|app\.post\(|createServer/i.test(source));
    assert.ok(!/serviceAccount|private_key|FIREBASE|apiKey/i.test(source));

    console.log('production adapter v2 tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
