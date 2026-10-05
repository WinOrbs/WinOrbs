'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
    MATCH_PERMISSIONS,
    createIdentityService
} = require('../packages/identity/v2');
const {
    APPLICATION_RECOVERY_ERRORS,
    createApplicationRecoveryBoundary
} = require('../packages/application-recovery/v2');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function gameState(matchId, status = 'RUNNING') {
    return {
        schemaVersion: 1,
        match: { matchId, status, rulesVersion: 'rules-v2', startedAt: 1 },
        players: {},
        teams: {},
        projectiles: [],
        loot: [],
        orbs: [],
        zone: { center: { x: 1, y: 1 }, radius: 100, phase: 0 },
        bankZone: { center: { x: 1, y: 1 }, radius: 10 },
        timers: { elapsedMs: 1, remainingMs: 10 },
        sequence: 1
    };
}

function validResult(matchId = 'match-1') {
    const result = {
        schemaVersion: 1,
        resultId: `result-${matchId}`,
        matchId,
        rulesVersion: 'rules-v2',
        startedAt: 1,
        finishedAt: 2,
        finishReason: 'TIME_LIMIT',
        participants: [{
            actorId: 'player-1',
            teamId: null,
            status: 'COMPLETED',
            statistics: { score: 1, kills: 0, deaths: 0 }
        }],
        rankings: [{ rank: 1, actorIds: ['player-1'], teamId: null }],
        teams: [],
        statistics: { durationMs: 1 },
        resultHash: ''
    };
    result.resultHash = crypto.createHash('sha256')
        .update(canonical(result))
        .digest('hex');
    return result;
}

function matchRecord({
    matchId = 'match-1',
    status = 'RUNNING',
    state = 'RECOVERABLE',
    snapshot = true,
    result = null
} = {}) {
    const storedResult = result === undefined ? validResult(matchId) : result;
    const locked = ['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(status);
    const snapshotValue = snapshot ? {
        schemaVersion: 1,
        matchId,
        status,
        memberActorIds: ['player-1', 'result-reader', 'viewer-id'],
        members: [
            { actorId: 'player-1', ready: true },
            { actorId: 'result-reader', ready: true },
            { actorId: 'viewer-id', ready: true }
        ],
        readyActorIds: ['player-1', 'result-reader', 'viewer-id'],
        notReadyActorIds: [],
        gameState: gameState(matchId, status)
    } : null;
    return {
        match: {
            matchId,
            status,
            rulesVersion: 'rules-v2',
            result: locked ? storedResult : null,
            resultVersion: locked ? 'result-v1' : null,
            matchPersistence: {
                schemaVersion: 1,
                stateVersion: 7,
                eventSequence: 2,
                resultVersion: locked ? 'result-v1' : null,
                createdAt: 100,
                resultLockedAt: locked ? 200 : null,
                metadata: { mode: 'ranked', map: 'arena-1' },
                snapshot: snapshotValue ? {
                    stateVersion: 6,
                    eventSequence: 1,
                    savedAt: 150,
                    value: snapshotValue
                } : null
            }
        },
        recovery: state,
        storedResult
    };
}

function createIdentity() {
    const permissions = {
        'player-1': [...MATCH_PERMISSIONS],
        'viewer-id': ['match.view'],
        'outsider-id': [],
        'result-reader': ['match.result.read']
    };
    return createIdentityService({
        authenticate: async (credential) => {
            if (!['player', 'viewer', 'noAccess', 'resultOnly'].includes(credential)) {
                return null;
            }
            return {
                userId: credential === 'player'
                    ? 'player-1'
                    : credential === 'viewer'
                        ? 'viewer-id'
                        : credential === 'resultOnly'
                            ? 'result-reader'
                            : 'outsider-id',
                provider: 'test',
                sessionId: `session-${credential}`,
                expiresAt: 5000
            };
        },
        resolveAuthorization: async ({ userId }) => ({
            roles: ['player'],
            permissions: permissions[userId]
        }),
        validateSession: async () => true,
        clock: () => 1000
    });
}

function makeRecoveryService(fixtures) {
    const calls = {
        loadMatch: 0,
        recoverMatch: 0,
        loadSnapshot: 0,
        loadEvents: 0,
        loadResult: 0,
        writes: 0,
        economy: 0,
        settlement: 0,
        engine: 0
    };
    function find(matchId) {
        return fixtures.get(matchId) || null;
    }
    return {
        calls,
        async loadMatch(matchId) {
            calls.loadMatch += 1;
            const item = find(matchId);
            return item
                ? { ok: true, match: clone(item.match) }
                : { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
        },
        async recoverMatch(matchId) {
            calls.recoverMatch += 1;
            const item = find(matchId);
            return item
                ? {
                    ok: true,
                    state: item.recovery,
                    match: clone(item.match),
                    ...(item.recovery === 'RECOVERABLE'
                        ? { replayRequired: true, actionRequired: 'REPLAY_AUTHORITATIVE_EVENTS' }
                        : {}),
                    ...(item.recovery === 'ABORT_REQUIRED'
                        ? { diagnostic: { type: 'EVENT_SEQUENCE_GAP' } }
                        : {})
                }
                : { ok: true, state: 'NOT_FOUND', matchId };
        },
        async loadSnapshot(matchId) {
            calls.loadSnapshot += 1;
            const item = find(matchId);
            return item
                ? {
                    ok: true,
                    snapshot: clone(item.match.matchPersistence.snapshot),
                    lifecycle: item.match.status,
                    stateVersion: item.match.matchPersistence.stateVersion,
                    eventSequence: item.match.matchPersistence.eventSequence
                }
                : { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
        },
        async loadEvents(matchId, fromSequence) {
            calls.loadEvents += 1;
            const item = find(matchId);
            return item
                ? {
                    ok: true,
                    events: [
                        { eventId: 'event-1', matchId, sequence: 1, type: 'MatchStarted' },
                        { eventId: 'event-2', matchId, sequence: 2, type: 'MatchFinished' }
                    ].filter((event) => event.sequence >= fromSequence),
                    eventSequence: 2
                }
                : { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
        },
        async loadResult(matchId) {
            calls.loadResult += 1;
            const item = find(matchId);
            const locked = item && ['RESULT_LOCKED', 'SETTLING', 'SETTLED']
                .includes(item.match.status);
            return item
                ? {
                    ok: true,
                    result: locked ? clone(item.match.result) : null,
                    resultVersion: locked ? item.match.resultVersion : null,
                    locked: Boolean(locked)
                }
                : { ok: false, error: { code: 'MATCH_NOT_FOUND' } };
        },
        async saveSnapshot() { calls.writes += 1; },
        async appendEvents() { calls.writes += 1; },
        async transitionLifecycle() { calls.writes += 1; },
        async lockResult() { calls.writes += 1; },
        async saveResult() { calls.writes += 1; }
    };
}

async function run() {
    const identity = createIdentity();
    const fixtures = new Map([
        ['match-1', matchRecord()],
        ['locked', matchRecord({ matchId: 'locked', status: 'RESULT_LOCKED', state: 'RESULT_LOCKED' })],
        ['settling', matchRecord({ matchId: 'settling', status: 'SETTLING', state: 'SETTLING' })],
        ['settled', matchRecord({ matchId: 'settled', status: 'SETTLED', state: 'SETTLED' })],
        ['abort', matchRecord({ matchId: 'abort', state: 'ABORT_REQUIRED' })],
        ['no-snapshot', matchRecord({ matchId: 'no-snapshot', snapshot: false, state: 'ABORT_REQUIRED' })]
    ]);
    const recoveryService = makeRecoveryService(fixtures);
    const boundary = createApplicationRecoveryBoundary({ identity, recoveryService });
    async function principal(credential = 'player') {
        const result = await identity.authenticate({ credential });
        assert.strictEqual(result.ok, true);
        return result.principal;
    }

    // Authentication, permission and per-match membership are both required.
    assert.strictEqual((await boundary.recoverMatch({}, 'match-1')).error.code,
        APPLICATION_RECOVERY_ERRORS.AUTHENTICATION_REQUIRED);
    assert.strictEqual((await boundary.recoverMatch(
        await principal('noAccess'), 'match-1'
    )).error.code, APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);
    const unauthorizedIdentity = createIdentityService({
        authenticate: async () => ({
            userId: 'outsider-id',
            provider: 'test',
            sessionId: 'outsider-session',
            expiresAt: 5000
        }),
        resolveAuthorization: async () => ({
            roles: ['player'],
            permissions: ['match.view']
        }),
        validateSession: async () => true,
        clock: () => 1000
    });
    const outsider = await unauthorizedIdentity.authenticate({ credential: 'x' });
    const outsiderBoundary = createApplicationRecoveryBoundary({
        identity: unauthorizedIdentity,
        recoveryService
    });
    assert.strictEqual((await outsiderBoundary.getMatchMetadata(
        outsider.principal, 'match-1'
    )).error.code, APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);
    assert.strictEqual((await outsiderBoundary.recoverMatch(
        outsider.principal, 'match-1'
    )).error.code, APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);

    // Preserve Match Persistence recovery semantics; never replay or repair.
    for (const [matchId, expectedState] of [
        ['missing-match', 'NOT_FOUND'],
        ['match-1', 'RECOVERABLE'],
        ['locked', 'RESULT_LOCKED'],
        ['settling', 'SETTLING'],
        ['settled', 'SETTLED']
    ]) {
        if (expectedState === 'NOT_FOUND') {
            const response = await boundary.recoverMatch(await principal(), matchId);
            assert.strictEqual(response.ok, true);
            assert.strictEqual(response.data.state, 'NOT_FOUND');
        } else {
            const response = await boundary.recoverMatch(await principal(), matchId);
            assert.strictEqual(response.ok, true);
            assert.strictEqual(response.data.state, expectedState);
            if (expectedState === 'RECOVERABLE') {
                assert.strictEqual(response.data.replayRequired, true);
                assert.strictEqual(response.data.actionRequired,
                    'REPLAY_AUTHORITATIVE_EVENTS');
            }
        }
    }
    const abort = await boundary.recoverMatch(await principal(), 'abort');
    assert.strictEqual(abort.error.code, APPLICATION_RECOVERY_ERRORS.RECOVERY_ABORT_REQUIRED);
    assert.strictEqual(abort.data.state, 'ABORT_REQUIRED');
    assert.strictEqual((await boundary.recoverMatch(
        await principal(), 'no-snapshot'
    )).error.code, APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);

    // Metadata and persisted snapshot/event sequence are returned as read-only copies.
    const metadata = await boundary.getMatchMetadata(await principal(), 'match-1');
    assert.strictEqual(metadata.ok, true);
    assert.strictEqual(metadata.data.lifecycle, 'RUNNING');
    assert.strictEqual(metadata.data.schemaVersion, 1);
    assert.strictEqual(metadata.data.stateVersion, 7);
    assert.strictEqual(metadata.data.eventSequence, 2);
    assert.strictEqual(metadata.data.resultVersion, null);
    assert.deepStrictEqual(metadata.data.metadata, { mode: 'ranked', map: 'arena-1' });

    const expectedSnapshot = clone(fixtures.get('match-1').match.matchPersistence.snapshot);
    const snapshotResponse = await boundary.getMatchSnapshot(await principal(), 'match-1');
    assert.deepStrictEqual(snapshotResponse.data.snapshot, expectedSnapshot);
    assert.strictEqual(Object.isFrozen(snapshotResponse.data.snapshot.value), true);
    assert.strictEqual((await boundary.getMatchEvents(await principal(), 'match-1', {
        fromSequence: 2
    })).data.events[0].sequence, 2);
    const allEvents = await boundary.getMatchEvents(await principal(), 'match-1');
    assert.deepStrictEqual(allEvents.data.events.map((event) => event.sequence), [1, 2]);
    assert.strictEqual(Object.isFrozen(allEvents.data.events), true);
    assert.strictEqual((await boundary.getMatchEvents(await principal(), 'match-1', {
        fromSequence: 0
    })).error.code, APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);

    // MatchResult reads require result permission, a locked state and integrity match.
    const resultPrincipalResponse = await identity.authenticate({ credential: 'player' });
    const result = validResult('locked');
    fixtures.set('locked', matchRecord({
        matchId: 'locked',
        status: 'RESULT_LOCKED',
        state: 'RESULT_LOCKED',
        result
    }));
    const lockedResult = await boundary.getMatchResult(
        resultPrincipalResponse.principal,
        'locked'
    );
    assert.strictEqual(lockedResult.ok, true);
    assert.strictEqual(lockedResult.data.result.resultId, result.resultId);
    assert.strictEqual(Object.isFrozen(lockedResult.data.result), true);
    assert.strictEqual((await boundary.getMatchResult(
        await principal('viewer'),
        'locked'
    )).error.code, APPLICATION_RECOVERY_ERRORS.AUTHORIZATION_DENIED);
    assert.strictEqual((await boundary.getMatchResult(
        await principal('resultOnly'),
        'locked'
    )).ok, true);

    // Reject client injection and invalid IDs/options without calling recovery.
    const beforeInvalid = recoveryService.calls.loadMatch;
    assert.strictEqual((await boundary.getMatchSnapshot(await principal(), '../bad'))
        .error.code, APPLICATION_RECOVERY_ERRORS.INVALID_MATCH_ID);
    assert.strictEqual((await boundary.getMatchEvents(await principal(), 'match-1', {
        sequence: 99
    })).error.code, APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
    assert.strictEqual((await boundary.getMatchMetadata(await principal(), 'match-1', {
        payout: 5
    })).error.code, APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
    assert.strictEqual(recoveryService.calls.loadMatch, beforeInvalid);
    assert.strictEqual((await boundary.recoverMatch(await principal(), 'match-1', {
        winnerId: 'player-1'
    })).error.code, APPLICATION_RECOVERY_ERRORS.INVALID_RECOVERY_REQUEST);
    for (const error of [
        await boundary.getMatchEvents(await principal(), 'match-1', { balance: 5 }),
        await boundary.getMatchResult(await principal(), 'no-such-match')
    ]) {
        if (!error.ok) {
            assert.strictEqual(Object.hasOwn(error.error, 'stack'), false);
        }
    }

    // A persisted Result that changes between read surfaces fails closed.
    const badResult = validResult('locked');
    badResult.resultHash = 'f'.repeat(64);
    fixtures.set('tampered', matchRecord({
        matchId: 'tampered',
        status: 'RESULT_LOCKED',
        state: 'RESULT_LOCKED',
        result: badResult
    }));
    assert.strictEqual((await boundary.getMatchResult(
        await principal(), 'tampered'
    )).error.code, APPLICATION_RECOVERY_ERRORS.RECOVERY_INTEGRITY_ERROR);

    // No storage writes or calls into financial/gameplay services occur.
    assert.strictEqual(recoveryService.calls.writes, 0);
    assert.strictEqual(recoveryService.calls.economy, 0);
    assert.strictEqual(recoveryService.calls.settlement, 0);
    assert.strictEqual(recoveryService.calls.engine, 0);
    assert.strictEqual(recoveryService.calls.loadResult > 0, true);
    assert.deepStrictEqual(recoveryService.calls && {
        writes: recoveryService.calls.writes,
        economy: recoveryService.calls.economy,
        settlement: recoveryService.calls.settlement,
        engine: recoveryService.calls.engine
    }, { writes: 0, economy: 0, settlement: 0, engine: 0 });

    console.log('OK application recovery v2: identity-authorized, membership-scoped, read-only recovery boundary.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
