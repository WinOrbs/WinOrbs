'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const {
    COORDINATOR_ERRORS,
    createMatchCoordinator
} = require('../packages/match-coordinator/v2');

function command(matchId, actorId, sequence, commandId = `command-${sequence}`) {
    return {
        schemaVersion: SCHEMA_VERSION,
        commandId,
        sessionId: `session-${actorId}`,
        matchId,
        actorId,
        sequence,
        type: 'MovePlayer',
        payload: { direction: { x: 1, y: 0 } }
    };
}

function createRunningMatch(options = {}) {
    const coordinator = createMatchCoordinator({
        matchId: 'match-coordinator-test',
        rules: { matchDurationMs: null },
        clock: () => 1000,
        ...options
    });
    assert.strictEqual(coordinator.createMatch().snapshot.status, 'WAITING');
    assert.strictEqual(coordinator.addPlayer('actor-1', 'session-actor-1').ok, true);
    assert.strictEqual(coordinator.addPlayer('actor-2', 'session-actor-2').ok, true);
    assert.strictEqual(coordinator.markReady('actor-1', 'session-actor-1').snapshot.status, 'WAITING');
    assert.strictEqual(coordinator.markReady('actor-2', 'session-actor-2').snapshot.status, 'READY');
    assert.strictEqual(coordinator.startCountdown().snapshot.status, 'COUNTDOWN');
    assert.strictEqual(coordinator.startMatch().snapshot.status, 'RUNNING');
    return coordinator;
}

function recoveryFixture(coordinator, overrides = {}) {
    const snapshot = coordinator.getSnapshot().snapshot;
    const events = coordinator.getEvents().events;
    return {
        matchId: snapshot.matchId,
        lifecycle: snapshot.status,
        snapshot,
        snapshotVersion: 1,
        snapshotEventSequence: snapshot.gameState.sequence,
        stateVersion: 2,
        eventSequence: snapshot.gameState.sequence,
        events,
        resultVersion: null,
        result: null,
        resultLocked: false,
        ...overrides
    };
}

function containsSensitiveKey(value) {
    if (Array.isArray(value)) return value.some(containsSensitiveKey);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
        /wallet|balance|payout|payment|secret|token|admin|credential/i.test(key) ||
        containsSensitiveKey(child));
}

// Individual readiness drives global READY only when at least two members are all ready.
{
    assert.throws(() => createMatchCoordinator({ matchId: 'missing-clock' }), TypeError);
    const coordinator = createMatchCoordinator({
        matchId: 'lifecycle-match',
        clock: () => 1000
    });
    assert.strictEqual(coordinator.getSnapshot().error.code, COORDINATOR_ERRORS.MATCH_NOT_FOUND);
    assert.strictEqual(coordinator.createMatch().snapshot.status, 'WAITING');
    assert.strictEqual(coordinator.createMatch().error.code, COORDINATOR_ERRORS.INVALID_LIFECYCLE);
    assert.strictEqual(coordinator.startCountdown().error.code, COORDINATOR_ERRORS.INVALID_LIFECYCLE);
    assert.strictEqual(coordinator.startMatch().error.code, COORDINATOR_ERRORS.INVALID_LIFECYCLE);
    assert.strictEqual(coordinator.addPlayer('actor-1', 'session-1').ok, true);
    assert.strictEqual(coordinator.addPlayer('actor-1', 'session-1').error.code,
        COORDINATOR_ERRORS.PLAYER_ALREADY_MEMBER);
    assert.strictEqual(coordinator.addPlayer('').error.code, COORDINATOR_ERRORS.INVALID_COMMAND);
    assert.strictEqual(coordinator.markReady('missing', 'session-1').error.code,
        COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
    assert.strictEqual(coordinator.markReady('actor-1', 'wrong-session').error.code,
        COORDINATOR_ERRORS.SESSION_MISMATCH);
    const oneReady = coordinator.markReady('actor-1', 'session-1');
    assert.strictEqual(oneReady.snapshot.status, 'WAITING');
    assert.deepStrictEqual(oneReady.snapshot.readyActorIds, ['actor-1']);
    assert.deepStrictEqual(oneReady.snapshot.notReadyActorIds, []);
    assert.strictEqual(coordinator.markReady('actor-1', 'session-1').snapshot.status, 'WAITING');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot.readyActorIds, ['actor-1']);

    assert.strictEqual(coordinator.addPlayer('actor-2', 'session-2').snapshot.status, 'WAITING');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot.notReadyActorIds, ['actor-2']);
    assert.strictEqual(coordinator.markReady('actor-1', 'session-1').snapshot.status, 'WAITING');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot.notReadyActorIds, ['actor-2']);
    assert.strictEqual(coordinator.markReady('actor-2', 'session-1').error.code,
        COORDINATOR_ERRORS.SESSION_MISMATCH);
    assert.strictEqual(coordinator.markReady('actor-2', 'session-2').snapshot.status, 'READY');
    assert.deepStrictEqual(coordinator.getSnapshot().snapshot.readyActorIds,
        ['actor-1', 'actor-2']);

    const withNewMember = coordinator.addPlayer('actor-3', 'session-3');
    assert.strictEqual(withNewMember.snapshot.status, 'WAITING');
    assert.deepStrictEqual(withNewMember.snapshot.readyActorIds, ['actor-1', 'actor-2']);
    assert.deepStrictEqual(withNewMember.snapshot.notReadyActorIds, ['actor-3']);
    assert.strictEqual(coordinator.markReady('actor-3', 'session-3').snapshot.status, 'READY');

    assert.strictEqual(coordinator.removePlayer('actor-3', 'session-3').snapshot.status,
        'READY');
    const afterLeave = coordinator.removePlayer('actor-1', 'session-1');
    assert.strictEqual(afterLeave.snapshot.status, 'WAITING');
    assert.deepStrictEqual(afterLeave.snapshot.memberActorIds, ['actor-2']);
    assert.deepStrictEqual(afterLeave.snapshot.readyActorIds, ['actor-2']);
    assert.strictEqual(coordinator.startCountdown().error.code,
        COORDINATOR_ERRORS.INVALID_LIFECYCLE);
    assert.strictEqual(coordinator.removePlayer('missing', 'session-1').error.code,
        COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
}

// Commands require a running match, membership, a matching ID, and ordered unique identity.
{
    const coordinator = createRunningMatch();
    assert.strictEqual(coordinator.submitCommand(command('match-coordinator-test', 'outsider', 1))
        .error.code, COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
    assert.strictEqual(coordinator.submitCommand(command('wrong-match', 'actor-1', 1))
        .error.code, COORDINATOR_ERRORS.INVALID_COMMAND);
    const first = command('match-coordinator-test', 'actor-1', 1);
    const accepted = coordinator.submitCommand(first);
    assert.strictEqual(accepted.ok, true);
    assert.strictEqual(coordinator.submitCommand(first).error.code,
        COORDINATOR_ERRORS.COMMAND_DUPLICATE);
    assert.strictEqual(coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 1, 'another-command'
    )).error.code, COORDINATOR_ERRORS.INVALID_SEQUENCE);
    assert.strictEqual(coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 3
    )).error.code, COORDINATOR_ERRORS.INVALID_SEQUENCE);
    const second = coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 2
    ));
    assert.strictEqual(second.ok, true);
    assert.strictEqual(coordinator.submitCommand({
        ...command('match-coordinator-test', 'actor-1', 3),
        unexpected: true
    }).error.code, COORDINATOR_ERRORS.INVALID_COMMAND);
}

// Ticks accumulate only Engine events and expose a safe, detached authoritative snapshot.
{
    const coordinator = createRunningMatch();
    const submitted = coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 1
    ));
    assert.strictEqual(submitted.ok, true);
    const tick = coordinator.advanceTick();
    assert.strictEqual(tick.ok, true);
    assert.strictEqual(tick.snapshot.gameState.timers.elapsedMs, 1000 / 60);
    assert.ok(tick.events.some((item) => item.type === 'PlayerMoved'));
    assert.strictEqual(containsSensitiveKey(coordinator.getSnapshot().snapshot), false);
    const events = coordinator.getEvents();
    assert.ok(events.events.some((item) => item.type === 'PlayerMoved'));
    assert.ok(Object.isFrozen(events.events));
    assert.notStrictEqual(events.events, coordinator.getEvents().events);
    const detached = coordinator.getSnapshot().snapshot;
    assert.ok(Object.isFrozen(detached));
    assert.notStrictEqual(detached.gameState, tick.snapshot.gameState);
}

// Result locking is validated, immutable, one-shot, and rejects all later gameplay.
{
    let now = 5000;
    const coordinator = createRunningMatch({ clock: () => now });
    now = 6000;
    const finished = coordinator.finishMatch('ABANDONED');
    assert.strictEqual(finished.ok, true);
    assert.strictEqual(finished.snapshot.status, 'RESULT_LOCKED');
    assert.strictEqual(finished.result.matchId, 'match-coordinator-test');
    assert.strictEqual(Object.isFrozen(finished.result), true);
    assert.strictEqual(coordinator.getResult().result.resultHash, finished.result.resultHash);
    assert.strictEqual(coordinator.finishMatch('ABANDONED').error.code,
        COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
    assert.strictEqual(coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 1
    )).error.code, COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
    assert.strictEqual(coordinator.advanceTick().error.code,
        COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
    assert.throws(() => {
        finished.result.rankings[0].rank = 99;
    }, TypeError);
    assert.strictEqual(coordinator.getResult().result.rankings[0].rank, 1);
    assert.ok(coordinator.getEvents().events.some((item) => item.type === 'MatchFinished'));
}

// A time limit determined by the Engine follows the same immutable result path.
{
    let now = 1000;
    const coordinator = createRunningMatch({
        rules: { tickMs: 10, matchDurationMs: 10 },
        clock: () => now
    });
    now = 1010;
    const tick = coordinator.advanceTick();
    assert.strictEqual(tick.ok, true);
    assert.strictEqual(tick.snapshot.status, 'RESULT_LOCKED');
    assert.strictEqual(tick.result.finishReason, 'TIME_LIMIT');
    assert.strictEqual(coordinator.submitCommand(command(
        'match-coordinator-test', 'actor-1', 1
    )).error.code, COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
}

// Identical seeded operations produce byte-for-byte equivalent results and domain events.
{
    function run() {
        const coordinator = createRunningMatch({
            rules: { matchDurationMs: null },
            clock: () => 1234
        });
        coordinator.submitCommand(command('match-coordinator-test', 'actor-1', 1));
        coordinator.advanceTick();
        coordinator.finishMatch('ABANDONED');
        return {
            result: coordinator.getResult().result,
            events: coordinator.getEvents().events,
            snapshot: coordinator.getSnapshot().snapshot
        };
    }
    assert.deepStrictEqual(run(), run());
}

// Recovery restores the exact state and keeps session reassociation memory-only.
{
    const source = createRunningMatch();
    source.submitCommand(command('match-coordinator-test', 'actor-1', 1));
    source.advanceTick();
    const persisted = recoveryFixture(source, { stateVersion: 12 });
    const restored = createMatchCoordinator({
        matchId: 'match-coordinator-test',
        rules: { matchDurationMs: null },
        clock: () => 1000
    });
    assert.strictEqual(restored.reassociatePlayerSession(
        'match-coordinator-test', 'actor-1', 'session-new'
    ).error.code, COORDINATOR_ERRORS.MATCH_NOT_FOUND);
    const hydration = restored.restoreFromPersistedState(persisted);
    assert.strictEqual(hydration.ok, true, JSON.stringify(hydration.error || null));
    assert.strictEqual(hydration.stateVersion, 12);
    assert.strictEqual(hydration.eventSequence, persisted.eventSequence);
    assert.deepStrictEqual(restored.getSnapshot().snapshot, persisted.snapshot);
    assert.deepStrictEqual(restored.getEvents().events, persisted.events);

    const beforeSnapshot = restored.getSnapshot().snapshot;
    const beforeEvents = restored.getEvents().events;
    const reassociated = restored.reassociatePlayerSession(
        'match-coordinator-test', 'actor-1', 'session-new'
    );
    assert.strictEqual(reassociated.ok, true);
    assert.strictEqual(reassociated.reassociated, true);
    assert.strictEqual(restored.reassociatePlayerSession(
        'match-coordinator-test', 'actor-1', 'session-new'
    ).reassociated, false);
    assert.strictEqual(restored.reassociatePlayerSession(
        'wrong-match', 'actor-1', 'another-session'
    ).error.code, COORDINATOR_ERRORS.MATCH_NOT_FOUND);
    assert.strictEqual(restored.reassociatePlayerSession(
        'match-coordinator-test', 'missing-actor', 'another-session'
    ).error.code, COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
    assert.strictEqual(restored.reassociatePlayerSession(
        'match-coordinator-test', 'actor-2', 'session-new'
    ).error.code, COORDINATOR_ERRORS.INVALID_COMMAND);
    assert.strictEqual(restored.reassociatePlayerSession(
        'match-coordinator-test', 'actor-2', ''
    ).error.code, COORDINATOR_ERRORS.INVALID_COMMAND);
    assert.deepStrictEqual(restored.getSnapshot().snapshot, beforeSnapshot);
    assert.deepStrictEqual(restored.getEvents().events, beforeEvents);
    const newSessionCommand = {
        ...command('match-coordinator-test', 'actor-1', 1, 'recovered-command'),
        sessionId: 'session-new'
    };
    assert.strictEqual(restored.submitCommand(newSessionCommand).ok, true);
    assert.strictEqual(restored.submitCommand({
        ...newSessionCommand,
        commandId: 'old-session-command',
        sessionId: 'session-actor-1',
        sequence: 2
    }).error.code, COORDINATOR_ERRORS.SESSION_MISMATCH);

    for (const mutate of [
        (state) => { state.matchId = 'other-match'; },
        (state) => { state.eventSequence -= 1; },
        (state) => { state.stateVersion = 0; },
        (state) => { state.snapshot.gameState.match.rulesVersion = 'other-rules'; },
        (state) => { state.snapshot.readyActorIds = ['missing-actor']; },
        (state) => { state.snapshot.members[0].actorId = 'missing-actor'; },
        (state) => {
            state.lifecycle = 'WAITING';
            state.snapshot.status = 'WAITING';
            state.snapshot.gameState.match.status = 'WAITING';
        }
    ]) {
        const corrupt = structuredClone(persisted);
        mutate(corrupt);
        const target = createMatchCoordinator({
            matchId: 'match-coordinator-test',
            rules: { matchDurationMs: null },
            clock: () => 1000
        });
        assert.strictEqual(target.restoreFromPersistedState(corrupt).error.code,
            COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        assert.strictEqual(target.getSnapshot().error.code, COORDINATOR_ERRORS.MATCH_NOT_FOUND);
    }
}

// Locked results restore immutably through RESULT_LOCKED, SETTLING and SETTLED.
{
    const source = createRunningMatch();
    const finished = source.finishMatch('ABANDONED');
    const lockedState = recoveryFixture(source, {
        lifecycle: 'RESULT_LOCKED',
        snapshot: finished.snapshot,
        snapshotEventSequence: finished.snapshot.gameState.sequence,
        eventSequence: finished.snapshot.gameState.sequence,
        events: source.getEvents().events,
        resultVersion: 'result-v1',
        result: finished.result,
        resultLocked: true
    });
    for (const lifecycle of ['RESULT_LOCKED', 'SETTLING', 'SETTLED']) {
        const state = structuredClone(lockedState);
        state.lifecycle = lifecycle;
        const restored = createMatchCoordinator({
            matchId: 'match-coordinator-test',
            rules: { matchDurationMs: null },
            clock: () => 1000
        });
        assert.strictEqual(restored.restoreFromPersistedState(state).ok, true);
        assert.strictEqual(restored.getSnapshot().snapshot.status, lifecycle);
        assert.deepStrictEqual(restored.getResult().result, finished.result);
        assert.strictEqual(restored.finishMatch('ABANDONED').ok, false);
        assert.strictEqual(restored.submitCommand(command(
            'match-coordinator-test', 'actor-1', 1
        )).ok, false);
        assert.deepStrictEqual(restored.getEvents().events, state.events);
    }
    const corruptResult = structuredClone(lockedState);
    corruptResult.result.resultHash = '0'.repeat(64);
    const target = createMatchCoordinator({
        matchId: 'match-coordinator-test',
        rules: { matchDurationMs: null },
        clock: () => 1000
    });
    assert.strictEqual(target.restoreFromPersistedState(corruptResult).error.code,
        COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
}

// The Coordinator boundary has no runtime, transport, persistence, or economy imports.
{
    const source = fs.readFileSync(path.join(__dirname,
        '../packages/match-coordinator/v2/index.js'), 'utf8');
    const requiredModules = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
        .map((match) => match[1]);
    assert.deepStrictEqual(requiredModules, [
        'crypto',
        '../../contracts/v2',
        '../../contracts/v2/validation',
        '../../game-engine/v2'
    ]);
}

console.log('OK match coordinator v2: in-memory lifecycle, membership, commands, ticks and locked results.');
