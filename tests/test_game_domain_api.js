'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../packages/contracts/v2');
const { createGame } = require('../packages/game');

function createRunningGame(options = {}) {
    const game = createGame({
        matchId: options.matchId || 'domain-api-match',
        rules: options.rules || { matchDurationMs: null },
        clock: options.clock || (() => 1000)
    });
    assert.strictEqual(game.joinPlayer('player-1', 'session-1').ok, true);
    assert.strictEqual(game.joinPlayer('player-2', 'session-2').ok, true);
    assert.strictEqual(game.markReady('player-1', 'session-1').snapshot.status, 'WAITING');
    assert.strictEqual(game.markReady('player-2', 'session-2').snapshot.status, 'READY');
    assert.strictEqual(game.startCountdown().snapshot.status, 'COUNTDOWN');
    assert.strictEqual(game.start().snapshot.status, 'RUNNING');
    return game;
}

function command(matchId, actorId, sessionId, sequence, type, payload) {
    return {
        schemaVersion: SCHEMA_VERSION,
        commandId: `${actorId}-${sequence}`,
        sessionId,
        matchId,
        actorId,
        sequence,
        type,
        payload
    };
}

function makeRecovery(game, matchId) {
    const snapshot = game.getState().snapshot;
    const events = game.getEvents().events;
    return {
        matchId,
        lifecycle: snapshot.status,
        snapshot,
        snapshotVersion: 1,
        snapshotEventSequence: snapshot.gameState.sequence,
        stateVersion: 2,
        eventSequence: snapshot.gameState.sequence,
        events,
        resultVersion: null,
        result: null,
        resultLocked: false
    };
}

assert.throws(() => createGame({ matchId: 'missing-clock' }), /clock must be a function/);

// Roster changes are domain operations and do not depend on a transport session store.
{
    const game = createGame({
        matchId: 'roster-match',
        rules: { matchDurationMs: null },
        clock: () => 10
    });
    assert.strictEqual(game.getState().snapshot.status, 'WAITING');
    assert.strictEqual(game.joinPlayer('player-1', 'session-1').ok, true);
    assert.strictEqual(game.joinPlayer('player-2', 'session-2').snapshot.memberActorIds.length, 2);
    assert.strictEqual(game.leavePlayer('player-2', 'wrong-session').ok, false);
    assert.strictEqual(game.leavePlayer('player-2', 'session-2').ok, true);
    assert.deepStrictEqual(game.getState().snapshot.memberActorIds, ['player-1']);
}

// Movement, combat, damage, elimination and match completion use the existing engine rules.
{
    let now = 1000;
    const game = createRunningGame({
        clock: () => now,
        rules: {
            matchDurationMs: null,
            spawnPoints: [{ x: 100, y: 100 }, { x: 150, y: 100 }],
            weapons: { pistol: { damage: 120 } }
        }
    });
    const move = game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 1, 'MovePlayer',
        { direction: { x: 1, y: 0 } }
    ));
    assert.strictEqual(move.ok, true);
    const moved = game.tick();
    assert.strictEqual(moved.snapshot.gameState.players['player-1'].position.x, 105.5);
    assert.ok(moved.events.some((event) => event.type === 'PlayerMoved'));

    const shot = game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 2, 'Shoot', { angle: 0 }
    ));
    assert.strictEqual(shot.ok, true);
    assert.ok(shot.events.some((event) => event.type === 'ShotFired'));
    now += 121;
    const impact = game.tick();
    assert.ok(impact.events.some((event) => event.type === 'DamageApplied'));
    assert.ok(impact.events.some((event) => event.type === 'PlayerDied'));
    assert.ok(impact.events.some((event) => event.type === 'PlayerKilled'));
    assert.strictEqual(impact.snapshot.gameState.players['player-2'].alive, false);
    assert.strictEqual(impact.snapshot.gameState.players['player-1'].kills, 1);

    const finished = game.finish('ABANDONED');
    assert.strictEqual(finished.ok, true);
    assert.strictEqual(finished.snapshot.status, 'RESULT_LOCKED');
    assert.ok(finished.events.some((event) => event.type === 'MatchFinished'));
    assert.strictEqual(game.getResult().result.finishReason, 'ABANDONED');
}

// Invalid input and cooldowns are rejected without bypassing engine validation or timing.
{
    let now = 500;
    const game = createRunningGame({ clock: () => now });
    const invalid = game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 1, 'Shoot', { angle: Infinity }
    ));
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.error.code, 'INVALID_COMMAND');
    const shot = game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 1, 'Shoot', { angle: 0 }
    ));
    assert.strictEqual(shot.ok, true);
    now += 100;
    assert.strictEqual(game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 2, 'Shoot', { angle: 0 }
    )).ok, false);
    now += 21;
    assert.strictEqual(game.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 3, 'Shoot', { angle: 0 }
    )).ok, true);
}

// Restored games retain authoritative state while rebinding only the returning session.
{
    const source = createRunningGame();
    source.handleInput(command(
        'domain-api-match', 'player-1', 'session-1', 1, 'MovePlayer',
        { direction: { x: 1, y: 0 } }
    ));
    source.tick();
    const recovery = makeRecovery(source, 'domain-api-match');
    const restored = createGame({
        matchId: 'domain-api-match',
        rules: { matchDurationMs: null },
        clock: () => 1000,
        recovery
    });
    assert.deepStrictEqual(restored.getState().snapshot, recovery.snapshot);
    assert.strictEqual(restored.restoreSession(
        'domain-api-match', 'player-1', 'session-returned'
    ).ok, true);
    const resumed = restored.handleInput(command(
        'domain-api-match', 'player-1', 'session-returned', 1, 'MovePlayer',
        { direction: { x: 0, y: 1 } }
    ));
    assert.strictEqual(resumed.ok, true);
    assert.strictEqual(restored.restoreSession(
        'domain-api-match', 'player-1', 'session-returned'
    ).reassociated, false);
}

// The public domain entry point and its required dependencies stay transport- and storage-free.
{
    const source = fs.readFileSync(path.join(__dirname, '../packages/game/index.js'), 'utf8');
    const imports = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
        .map((match) => match[1]);
    assert.deepStrictEqual(imports, ['../match-coordinator/v2']);
    assert.doesNotMatch(source, /console\.|process\.env|Date\.now|Math\.random|fetch\(/);
}

console.log('OK game domain API: lifecycle, simulation, events and session recovery are transport-independent.');
