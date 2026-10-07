'use strict';

const assert = require('assert');
const contracts = require('../packages/contracts/v2');
const validators = require('../packages/contracts/v2/validation');

const { SCHEMA_VERSION, CONTRACT_ERRORS } = contracts;

function validCommand(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        commandId: 'cmd-1',
        sessionId: 'session-1',
        matchId: 'match-1',
        actorId: 'player-1',
        sequence: 1,
        type: 'MovePlayer',
        payload: { direction: { x: 1, y: 0 } },
        ...overrides
    };
}

function validEvent(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        eventId: 'event-1',
        matchId: 'match-1',
        sequence: 1,
        timestamp: 100,
        type: 'PlayerMoved',
        actorId: 'player-1',
        payload: {
            actorId: 'player-1',
            position: { x: 10, y: 20 },
            velocity: { x: 1, y: 0 }
        },
        ...overrides
    };
}

function validPrincipal(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        userId: 'user-1',
        provider: 'test-provider',
        sessionId: 'session-1',
        authenticatedAt: 100,
        expiresAt: 200,
        roles: ['player'],
        permissions: [],
        ...overrides
    };
}

function validState(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        match: {
            matchId: 'match-1',
            status: 'RUNNING',
            rulesVersion: 'rules-1',
            startedAt: 100
        },
        players: {
            'player-1': {
                actorId: 'player-1',
                teamId: null,
                position: { x: 10, y: 20 },
                velocity: { x: 0, y: 0 },
                health: { current: 100, max: 100 },
                shield: 0,
                energy: 50,
                movement: { direction: { x: 0, y: 0 }, dashTicks: 0 },
                weapons: { equipped: 'pistol', owned: ['pistol'] },
                ammunition: { pistol: 12 },
                cooldowns: { dash: 0 },
                reload: { ticksRemaining: 0, weapon: null },
                inventory: { medkit: 1 },
                score: 0,
                kills: 0,
                deaths: 0,
                respawn: { eligible: false, availableAt: null },
                alive: true
            }
        },
        teams: {},
        projectiles: [],
        loot: [],
        orbs: [],
        zone: { center: { x: 250, y: 250 }, radius: 200, phase: 0 },
        bankZone: { center: { x: 250, y: 250 }, radius: 130 },
        timers: { elapsedMs: 1000, remainingMs: 59000 },
        sequence: 0,
        ...overrides
    };
}

function validResult(overrides = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        resultId: 'result-1',
        matchId: 'match-1',
        rulesVersion: 'rules-1',
        startedAt: 100,
        finishedAt: 200,
        finishReason: 'LAST_PLAYER',
        participants: [{
            actorId: 'player-1',
            teamId: null,
            status: 'COMPLETED',
            statistics: { score: 10, kills: 1, deaths: 0 }
        }],
        rankings: [{ rank: 1, actorIds: ['player-1'], teamId: null }],
        teams: [],
        statistics: { durationMs: 100 },
        resultHash: 'a'.repeat(64),
        ...overrides
    };
}

function expectError(result, code) {
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, code);
    assert.strictEqual(typeof result.error.path, 'string');
}

assert.strictEqual(validators.validateGameCommand(validCommand()).ok, true);
assert.strictEqual(validators.validateGameCommand(validCommand({
    clientTimestamp: 150
})).ok, true);
for (const [field, code] of [
    ['commandId', CONTRACT_ERRORS.INVALID_COMMAND],
    ['actorId', CONTRACT_ERRORS.INVALID_COMMAND],
    ['matchId', CONTRACT_ERRORS.INVALID_COMMAND]
]) {
    const command = validCommand();
    delete command[field];
    expectError(validators.validateGameCommand(command), code);
}
expectError(validators.validateGameCommand(validCommand({ sequence: 0 })), CONTRACT_ERRORS.INVALID_SEQUENCE);
expectError(validators.validateGameCommand(validCommand({ sequence: 1.5 })), CONTRACT_ERRORS.INVALID_SEQUENCE);
expectError(validators.validateGameCommand(validCommand({ type: 'Teleport' })), CONTRACT_ERRORS.INVALID_COMMAND);
expectError(validators.validateGameCommand(validCommand({ schemaVersion: 2 })), CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION);
expectError(validators.validateGameCommand(validCommand({ schemaVersion: '1' })), CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION);
expectError(validators.validateGameCommand(validCommand({ payload: { direction: { x: 1 } } })), CONTRACT_ERRORS.INVALID_PAYLOAD);
expectError(validators.validateGameCommand(validCommand({ payload: { direction: { x: 1, y: 0 }, score: 500 } })), CONTRACT_ERRORS.INVALID_PAYLOAD);
expectError(validators.validateGameCommand(validCommand({ type: 'Shoot', payload: { angle: 0, damage: 100 } })), CONTRACT_ERRORS.INVALID_PAYLOAD);
expectError(validators.validateGameCommand(validCommand({ unexpected: true })), CONTRACT_ERRORS.INVALID_COMMAND);
expectError(validators.validateGameCommand(validCommand({ sequence: '1' })), CONTRACT_ERRORS.INVALID_SEQUENCE);

assert.strictEqual(validators.validateGameEvent(validEvent()).ok, true);
for (const field of ['eventId', 'matchId', 'sequence']) {
    const event = validEvent();
    delete event[field];
    expectError(validators.validateGameEvent(event), CONTRACT_ERRORS.INVALID_EVENT);
}
expectError(validators.validateGameEvent(validEvent({ sequence: 0 })), CONTRACT_ERRORS.INVALID_SEQUENCE);
expectError(validators.validateGameEvent(validEvent({ type: 'UnknownEvent' })), CONTRACT_ERRORS.INVALID_EVENT);
expectError(validators.validateGameEvent(validEvent({ payload: {} })), CONTRACT_ERRORS.INVALID_PAYLOAD);
expectError(validators.validateGameEvent(validEvent({ payload: { ...validEvent().payload, balance: 10 } })), CONTRACT_ERRORS.INVALID_EVENT);
expectError(validators.validateGameEvent(validEvent({ unexpected: true })), CONTRACT_ERRORS.INVALID_EVENT);
expectError(validators.validateGameEvent(validEvent({ timestamp: '100' })), CONTRACT_ERRORS.INVALID_EVENT);
expectError(validators.validateNewGameEvent(validEvent({ actorId: 'another-player' })), CONTRACT_ERRORS.INVALID_EVENT);
const systemEvent = validEvent({
    type: 'ZoneUpdated',
    payload: { center: { x: 10, y: 20 }, radius: 50, phase: 1 }
});
delete systemEvent.actorId;
assert.strictEqual(validators.validateGameEvent(systemEvent).ok, true);
assert.strictEqual(validators.validateNewGameEvent(systemEvent).ok, true);
const actorEventWithoutActor = validEvent();
delete actorEventWithoutActor.actorId;
assert.strictEqual(validators.validateGameEvent(actorEventWithoutActor).ok, true);
expectError(validators.validateNewGameEvent(actorEventWithoutActor), CONTRACT_ERRORS.INVALID_EVENT);

assert.strictEqual(validators.validateGameState(validState()).ok, true);
for (const field of ['match', 'players', 'teams', 'zone', 'timers', 'sequence']) {
    const state = validState();
    delete state[field];
    expectError(validators.validateGameState(state), CONTRACT_ERRORS.INVALID_STATE);
}
expectError(validators.validateGameState(validState({ schemaVersion: 0 })), CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION);
expectError(validators.validateGameState(validState({
    players: { 'player-1': { ...validState().players['player-1'], actorId: 'player-2' } }
})), CONTRACT_ERRORS.INVALID_STATE);
expectError(validators.validateGameState(validState({ wallet: {} })), CONTRACT_ERRORS.INVALID_STATE);

assert.strictEqual(validators.validateMatchResult(validResult()).ok, true);
expectError(validators.validateMatchResult(validResult({ matchId: '' })), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({ participants: [] })), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({ schemaVersion: 99 })), CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION);
expectError(validators.validateMatchResult(validResult({ finishReason: 'UNKNOWN' })), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({ prize: 100 })), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({
    statistics: { walletBalance: 100 }
})), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({
    rankings: [{ rank: 1, actorIds: ['not-a-participant'], teamId: null }]
})), CONTRACT_ERRORS.INVALID_RESULT);
assert.strictEqual(validators.validateMatchResult(validResult({
    policyReference: 'policy-1'
})).ok, true);
expectError(validators.validateMatchResult(validResult({ unexpected: true })), CONTRACT_ERRORS.INVALID_RESULT);
expectError(validators.validateMatchResult(validResult({ finishedAt: '200' })), CONTRACT_ERRORS.INVALID_RESULT);

assert.strictEqual(validators.validateAuthenticatedPrincipal(validPrincipal()).ok, true);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ userId: '' })), CONTRACT_ERRORS.INVALID_PRINCIPAL);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ sessionId: '' })), CONTRACT_ERRORS.INVALID_PRINCIPAL);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ expiresAt: 100 })), CONTRACT_ERRORS.INVALID_PRINCIPAL);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ roles: ['player', 3] })), CONTRACT_ERRORS.INVALID_PRINCIPAL);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ admin: true })), CONTRACT_ERRORS.INVALID_PRINCIPAL);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ schemaVersion: 2 })), CONTRACT_ERRORS.UNSUPPORTED_SCHEMA_VERSION);
expectError(validators.validateAuthenticatedPrincipal(validPrincipal({ unexpected: true })), CONTRACT_ERRORS.INVALID_PRINCIPAL);

console.log('OK contracts v2: commands, events, state, results and principals validate strictly.');
