'use strict';

const {
    SCHEMA_VERSION,
    MATCH_FINISH_REASONS
} = require('../../contracts/v2');
const {
    validateGameCommand,
    validateMatchResult
} = require('../../contracts/v2/validation');
const {
    createInitialGameState,
    createGameEngine
} = require('../../game-engine/v2');

const COORDINATOR_ERRORS = Object.freeze({
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    INVALID_LIFECYCLE: 'INVALID_LIFECYCLE',
    PLAYER_NOT_MEMBER: 'PLAYER_NOT_MEMBER',
    PLAYER_ALREADY_MEMBER: 'PLAYER_ALREADY_MEMBER',
    SESSION_MISMATCH: 'SESSION_MISMATCH',
    INVALID_COMMAND: 'INVALID_COMMAND',
    COMMAND_DUPLICATE: 'COMMAND_DUPLICATE',
    INVALID_SEQUENCE: 'INVALID_SEQUENCE',
    MATCH_RESULT_LOCKED: 'MATCH_RESULT_LOCKED',
    INVALID_RESULT: 'INVALID_RESULT'
});
const MAX_CACHED_COMMANDS = 10000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function failure(code, details = {}) {
    return { ok: false, error: { code, ...details } };
}

function createMatchCoordinator(options = {}) {
    if (!isRecord(options) || typeof options.matchId !== 'string' ||
        !options.matchId.trim() || options.matchId.length > 128) {
        throw new TypeError('matchId must be a non-empty string');
    }
    const rules = options.rules === undefined ? {} : options.rules;
    if (!isRecord(rules)) throw new TypeError('rules must be an object');
    const clock = options.clock;
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    const rulesVersion = options.rulesVersion === undefined ? 'v2' : options.rulesVersion;
    const durationMs = options.durationMs;
    const zone = options.zone;
    const bankZone = options.bankZone;

    let engine = null;
    let lifecycle = null;
    let result = null;
    let resultInvalid = false;
    const members = new Map();
    const events = [];
    const sessions = new Map();
    const lastSequenceBySession = new Map();
    const commands = new Map();

    function missingMatch() {
        return failure(COORDINATOR_ERRORS.MATCH_NOT_FOUND);
    }

    function snapshotValue() {
        const gameState = engine.getState();
        const memberStatuses = [...members.entries()]
            .map(([actorId, membership]) => ({
                actorId,
                ready: membership.ready
            }))
            .sort((a, b) => a.actorId.localeCompare(b.actorId));
        const readyActorIds = memberStatuses
            .filter((membership) => membership.ready)
            .map((membership) => membership.actorId);
        const notReadyActorIds = memberStatuses
            .filter((membership) => !membership.ready)
            .map((membership) => membership.actorId);
        return deepFreeze(clone({
            schemaVersion: SCHEMA_VERSION,
            matchId: options.matchId,
            status: lifecycle,
            memberActorIds: memberStatuses.map((membership) => membership.actorId),
            members: memberStatuses,
            readyActorIds,
            notReadyActorIds,
            gameState
        }));
    }

    function recordEvents(items) {
        events.push(...clone(items || []));
    }

    function makeSnapshotResult() {
        return { ok: true, snapshot: snapshotValue() };
    }

    function createMatch() {
        if (engine) return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        const initialState = createInitialGameState({
            matchId: options.matchId,
            rulesVersion,
            rules,
            durationMs,
            zone,
            bankZone
        });
        engine = createGameEngine(initialState, rules, { clock });
        lifecycle = 'WAITING';
        return makeSnapshotResult();
    }

    function syncReadinessLifecycle() {
        if (!['WAITING', 'READY'].includes(lifecycle)) return null;
        const allReady = members.size >= 2 &&
            [...members.values()].every((membership) => membership.ready);
        const target = allReady ? 'READY' : 'WAITING';
        if (lifecycle === target) return null;
        const changed = engine.transition(target);
        if (!changed.ok) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                cause: changed.error.code
            });
        }
        lifecycle = target;
        recordEvents(changed.events);
        return null;
    }

    function addPlayer(actorId, sessionId) {
        if (!engine) return missingMatch();
        if (!['WAITING', 'READY'].includes(lifecycle)) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 128) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { field: 'actorId' });
        }
        if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { field: 'sessionId' });
        }
        if (members.has(actorId)) return failure(COORDINATOR_ERRORS.PLAYER_ALREADY_MEMBER);
        const added = engine.addPlayer(actorId);
        if (!added.ok) return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { cause: added.error.code });
        members.set(actorId, { sessionId, ready: false });
        const lifecycleError = syncReadinessLifecycle();
        if (lifecycleError) return lifecycleError;
        return makeSnapshotResult();
    }

    function removePlayer(actorId, sessionId) {
        if (!engine) return missingMatch();
        if (!['WAITING', 'READY'].includes(lifecycle)) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        if (!members.has(actorId)) return failure(COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
        if (members.get(actorId).sessionId !== sessionId) {
            return failure(COORDINATOR_ERRORS.SESSION_MISMATCH);
        }
        const removed = engine.removePlayer(actorId);
        if (!removed.ok) return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { cause: removed.error.code });
        members.delete(actorId);
        const lifecycleError = syncReadinessLifecycle();
        if (lifecycleError) return lifecycleError;
        return makeSnapshotResult();
    }

    function transition(expected, target) {
        if (!engine) return missingMatch();
        if (lifecycle !== expected) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                expected,
                status: lifecycle
            });
        }
        const changed = engine.transition(target);
        if (!changed.ok) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { cause: changed.error.code });
        }
        lifecycle = target;
        recordEvents(changed.events);
        return makeSnapshotResult();
    }

    function markReady(actorId, sessionId) {
        if (!engine) return missingMatch();
        if (!['WAITING', 'READY'].includes(lifecycle)) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        if (!members.has(actorId)) {
            return failure(COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
        }
        const membership = members.get(actorId);
        if (membership.sessionId !== sessionId) {
            return failure(COORDINATOR_ERRORS.SESSION_MISMATCH);
        }
        if (!membership.ready) membership.ready = true;
        const lifecycleError = syncReadinessLifecycle();
        if (lifecycleError) return lifecycleError;
        return makeSnapshotResult();
    }

    function startCountdown() {
        return transition('READY', 'COUNTDOWN');
    }

    function startMatch() {
        if (lifecycle === null) return missingMatch();
        if (lifecycle !== 'COUNTDOWN') {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                expected: 'COUNTDOWN',
                status: lifecycle
            });
        }
        if (members.size < 2 ||
            [...members.values()].some((membership) => !membership.ready)) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                reason: 'MATCH_REQUIRES_READY_MEMBERS'
            });
        }
        return transition('COUNTDOWN', 'RUNNING');
    }

    function commandError(validation) {
        if (validation.error.code === 'INVALID_SEQUENCE') {
            return failure(COORDINATOR_ERRORS.INVALID_SEQUENCE, {
                path: validation.error.path
            });
        }
        return failure(COORDINATOR_ERRORS.INVALID_COMMAND, {
            cause: validation.error.code,
            path: validation.error.path
        });
    }

    function submitCommand(command) {
        if (!engine) return missingMatch();
        if (lifecycle === 'RESULT_LOCKED') {
            return failure(COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
        }
        const validation = validateGameCommand(command);
        if (!validation.ok) return commandError(validation);
        if (command.matchId !== options.matchId) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { reason: 'MATCH_MISMATCH' });
        }
        if (lifecycle !== 'RUNNING') {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        if (!members.has(command.actorId)) {
            return failure(COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
        }
        if (members.get(command.actorId).sessionId !== command.sessionId) {
            return failure(COORDINATOR_ERRORS.SESSION_MISMATCH);
        }

        const commandKey = JSON.stringify([command.sessionId, command.commandId]);
        if (commands.has(commandKey)) {
            return failure(COORDINATOR_ERRORS.COMMAND_DUPLICATE);
        }
        const boundActor = sessions.get(command.sessionId);
        if (boundActor && boundActor !== command.actorId) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, {
                reason: 'SESSION_ACTOR_MISMATCH'
            });
        }
        const expectedSequence = (lastSequenceBySession.get(command.sessionId) || 0) + 1;
        if (command.sequence !== expectedSequence) {
            return failure(COORDINATOR_ERRORS.INVALID_SEQUENCE, { expected: expectedSequence });
        }

        const response = engine.execute(command);
        sessions.set(command.sessionId, command.actorId);
        lastSequenceBySession.set(command.sessionId, command.sequence);
        commands.set(commandKey, true);
        if (commands.size > MAX_CACHED_COMMANDS) {
            commands.delete(commands.keys().next().value);
        }
        if (!response.ok) {
            return failure(
                response.error.code === 'INVALID_SEQUENCE'
                    ? COORDINATOR_ERRORS.INVALID_SEQUENCE
                    : response.error.code === 'PLAYER_NOT_FOUND'
                        ? COORDINATOR_ERRORS.PLAYER_NOT_MEMBER
                        : response.error.code === 'COMMAND_ID_REUSE'
                            ? COORDINATOR_ERRORS.COMMAND_DUPLICATE
                            : COORDINATOR_ERRORS.INVALID_COMMAND,
                { cause: response.error.code }
            );
        }
        recordEvents(response.events);
        return {
            ok: true,
            snapshot: snapshotValue(),
            events: deepFreeze(clone(response.events))
        };
    }

    function lockResult(engineResponse) {
        lifecycle = 'FINISHING';
        const validation = validateMatchResult(engineResponse.result);
        if (!validation.ok || engineResponse.result.matchId !== options.matchId) {
            resultInvalid = true;
            lifecycle = 'RESULT_LOCKED';
            recordEvents(engineResponse.events);
            return failure(COORDINATOR_ERRORS.INVALID_RESULT, {
                path: validation.error?.path || '$.matchId'
            });
        }
        result = deepFreeze(clone(engineResponse.result));
        lifecycle = 'RESULT_LOCKED';
        recordEvents(engineResponse.events);
        return {
            ok: true,
            snapshot: snapshotValue(),
            result: deepFreeze(clone(result)),
            events: deepFreeze(clone(engineResponse.events))
        };
    }

    function advanceTick() {
        if (!engine) return missingMatch();
        if (lifecycle === 'RESULT_LOCKED') {
            return failure(COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
        }
        if (lifecycle !== 'RUNNING') {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        const response = engine.advanceTick();
        if (!response.ok) return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
            cause: response.error.code
        });
        if (response.result) return lockResult(response);
        recordEvents(response.events);
        return {
            ok: true,
            snapshot: snapshotValue(),
            events: deepFreeze(clone(response.events)),
            result: null
        };
    }

    function finishMatch(finishReason) {
        if (!engine) return missingMatch();
        if (lifecycle === 'RESULT_LOCKED') {
            return failure(COORDINATOR_ERRORS.MATCH_RESULT_LOCKED);
        }
        if (lifecycle !== 'RUNNING' || !MATCH_FINISH_REASONS.includes(finishReason)) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        lifecycle = 'FINISHING';
        const response = engine.finishMatch(finishReason);
        if (!response.ok) {
            lifecycle = 'RUNNING';
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                cause: response.error.code
            });
        }
        return lockResult(response);
    }

    function getSnapshot() {
        if (!engine) return missingMatch();
        return makeSnapshotResult();
    }

    function getEvents() {
        if (!engine) return missingMatch();
        return { ok: true, events: deepFreeze(clone(events)) };
    }

    function getResult() {
        if (!engine) return missingMatch();
        if (resultInvalid) return failure(COORDINATOR_ERRORS.INVALID_RESULT);
        if (!result) {
            return lifecycle === 'RESULT_LOCKED'
                ? failure(COORDINATOR_ERRORS.INVALID_RESULT)
                : { ok: true, result: null };
        }
        return { ok: true, result: deepFreeze(clone(result)) };
    }

    return Object.freeze({
        createMatch,
        addPlayer,
        removePlayer,
        markReady,
        startCountdown,
        startMatch,
        submitCommand,
        advanceTick,
        finishMatch,
        getSnapshot,
        getEvents,
        getResult
    });
}

module.exports = Object.freeze({
    COORDINATOR_ERRORS,
    createMatchCoordinator
});
