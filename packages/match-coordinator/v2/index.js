'use strict';

const crypto = require('crypto');
const {
    SCHEMA_VERSION,
    MATCH_LIFECYCLE,
    MATCH_FINISH_REASONS
} = require('../../contracts/v2');
const {
    validateGameCommand,
    validateGameEvent,
    validateGameState,
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
    INVALID_RESULT: 'INVALID_RESULT',
    INVALID_RECOVERY_STATE: 'INVALID_RECOVERY_STATE'
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

function exactKeys(value, required) {
    return isRecord(value) && required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required.includes(key));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function validResultHash(result) {
    const unsigned = { ...result, resultHash: '' };
    return crypto.createHash('sha256').update(canonical(unsigned)).digest('hex') ===
        result.resultHash;
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
    let restored = false;
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

    function restoreFromPersistedState(recovery) {
        const fields = [
            'matchId', 'lifecycle', 'snapshot', 'snapshotVersion',
            'snapshotEventSequence', 'stateVersion', 'eventSequence', 'events',
            'resultVersion', 'result', 'resultLocked'
        ];
        if (engine) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, { status: lifecycle });
        }
        if (!exactKeys(recovery, fields) || recovery.matchId !== options.matchId ||
            !MATCH_LIFECYCLE.includes(recovery.lifecycle) ||
            !Number.isSafeInteger(recovery.snapshotVersion) || recovery.snapshotVersion < 1 ||
            !Number.isSafeInteger(recovery.snapshotEventSequence) || recovery.snapshotEventSequence < 0 ||
            !Number.isSafeInteger(recovery.stateVersion) || recovery.stateVersion < recovery.snapshotVersion ||
            !Number.isSafeInteger(recovery.eventSequence) || recovery.eventSequence < 0 ||
            !Array.isArray(recovery.events) || typeof recovery.resultLocked !== 'boolean' ||
            (recovery.resultVersion !== null &&
                (typeof recovery.resultVersion !== 'string' || !recovery.resultVersion.trim() ||
                    recovery.resultVersion.length > 256)) ||
            (recovery.result !== null && !isRecord(recovery.result))) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }

        const lockedLifecycle = ['RESULT_LOCKED', 'SETTLING', 'SETTLED']
            .includes(recovery.lifecycle);
        const snapshotLifecycle = lockedLifecycle ? 'RESULT_LOCKED' : recovery.lifecycle;
        const snapshot = recovery.snapshot;
        const snapshotFields = [
            'schemaVersion', 'matchId', 'status', 'memberActorIds', 'members',
            'readyActorIds', 'notReadyActorIds', 'gameState'
        ];
        if (!exactKeys(snapshot, snapshotFields) ||
            snapshot.schemaVersion !== SCHEMA_VERSION ||
            snapshot.matchId !== options.matchId || snapshot.status !== snapshotLifecycle ||
            !isRecord(snapshot.gameState) || !validateGameState(snapshot.gameState).ok ||
            snapshot.gameState.schemaVersion !== SCHEMA_VERSION ||
            snapshot.gameState.match.matchId !== options.matchId ||
            snapshot.gameState.match.status !== snapshotLifecycle ||
            snapshot.gameState.match.rulesVersion !== rulesVersion ||
            recovery.snapshotEventSequence !== recovery.eventSequence ||
            snapshot.gameState.sequence !== recovery.eventSequence ||
            recovery.events.length !== recovery.eventSequence) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }

        if (!Array.isArray(snapshot.members) || !Array.isArray(snapshot.memberActorIds) ||
            !Array.isArray(snapshot.readyActorIds) || !Array.isArray(snapshot.notReadyActorIds)) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }
        const restoredMembers = new Map();
        for (const membership of snapshot.members) {
            if (!exactKeys(membership, ['actorId', 'ready']) ||
                typeof membership.actorId !== 'string' || !membership.actorId.trim() ||
                typeof membership.ready !== 'boolean' || restoredMembers.has(membership.actorId)) {
                return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
            }
            restoredMembers.set(membership.actorId, {
                sessionId: null,
                ready: membership.ready
            });
        }
        const roster = [...restoredMembers.keys()].sort();
        const players = Object.keys(snapshot.gameState.players).sort();
        const readyActors = [...restoredMembers]
            .filter(([, membership]) => membership.ready)
            .map(([actorId]) => actorId)
            .sort();
        const notReadyActors = [...restoredMembers]
            .filter(([, membership]) => !membership.ready)
            .map(([actorId]) => actorId)
            .sort();
        if (canonical([...snapshot.memberActorIds].sort()) !== canonical(roster) ||
            canonical(players) !== canonical(roster) ||
            canonical([...snapshot.readyActorIds].sort()) !== canonical(readyActors) ||
            canonical([...snapshot.notReadyActorIds].sort()) !== canonical(notReadyActors) ||
            new Set(snapshot.memberActorIds).size !== snapshot.memberActorIds.length ||
            new Set(snapshot.readyActorIds).size !== snapshot.readyActorIds.length ||
            new Set(snapshot.notReadyActorIds).size !== snapshot.notReadyActorIds.length) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }
        if (['READY', 'COUNTDOWN', 'RUNNING', 'FINISHING', 'RESULT_LOCKED', 'SETTLING', 'SETTLED']
            .includes(recovery.lifecycle) &&
            (restoredMembers.size < 2 || [...restoredMembers.values()].some((member) => !member.ready))) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }
        if (recovery.lifecycle === 'WAITING' && restoredMembers.size >= 2 &&
            [...restoredMembers.values()].every((member) => member.ready)) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }

        const eventIds = new Set();
        for (let index = 0; index < recovery.events.length; index += 1) {
            const event = recovery.events[index];
            if (!validateGameEvent(event).ok || event.matchId !== options.matchId ||
                event.sequence !== index + 1 || eventIds.has(event.eventId)) {
                return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
            }
            eventIds.add(event.eventId);
        }

        if (lockedLifecycle !== recovery.resultLocked ||
            (recovery.resultLocked && (!recovery.result || !recovery.resultVersion)) ||
            (!recovery.resultLocked && (recovery.result || recovery.resultVersion)) ||
            (recovery.result && (!validateMatchResult(recovery.result).ok ||
                recovery.result.matchId !== options.matchId ||
                recovery.result.rulesVersion !== rulesVersion ||
                !validResultHash(recovery.result) ||
                canonical(recovery.result.participants.map((participant) => participant.actorId).sort()) !==
                    canonical(roster)))) {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }

        let restoredEngine;
        try {
            restoredEngine = createGameEngine(snapshot.gameState, rules, { clock });
        } catch {
            return failure(COORDINATOR_ERRORS.INVALID_RECOVERY_STATE);
        }
        engine = restoredEngine;
        lifecycle = recovery.lifecycle;
        result = recovery.result ? deepFreeze(clone(recovery.result)) : null;
        resultInvalid = false;
        restored = true;
        for (const [actorId, membership] of restoredMembers) {
            members.set(actorId, membership);
        }
        recordEvents(recovery.events);
        return {
            ok: true,
            snapshot: snapshotValue(),
            stateVersion: recovery.stateVersion,
            eventSequence: recovery.eventSequence,
            resultVersion: recovery.resultVersion,
            resultLocked: recovery.resultLocked
        };
    }

    function reassociatePlayerSession(matchId, actorId, sessionId) {
        if (!engine) return missingMatch();
        if (matchId !== options.matchId) return failure(COORDINATOR_ERRORS.MATCH_NOT_FOUND);
        if (!restored) {
            return failure(COORDINATOR_ERRORS.INVALID_LIFECYCLE, {
                reason: 'MATCH_NOT_RESTORED'
            });
        }
        if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 128) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { field: 'actorId' });
        }
        if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, { field: 'sessionId' });
        }
        const membership = members.get(actorId);
        if (!membership) return failure(COORDINATOR_ERRORS.PLAYER_NOT_MEMBER);
        const boundActor = sessions.get(sessionId);
        if (boundActor && boundActor !== actorId) {
            return failure(COORDINATOR_ERRORS.INVALID_COMMAND, {
                reason: 'SESSION_ACTOR_MISMATCH'
            });
        }
        for (const [memberId, member] of members) {
            if (memberId !== actorId && member.sessionId === sessionId) {
                return failure(COORDINATOR_ERRORS.INVALID_COMMAND, {
                    reason: 'SESSION_ACTOR_MISMATCH'
                });
            }
        }
        if (membership.sessionId === sessionId) {
            return { ok: true, reassociated: false, snapshot: snapshotValue() };
        }
        if (membership.sessionId) {
            sessions.delete(membership.sessionId);
            lastSequenceBySession.delete(membership.sessionId);
        }
        membership.sessionId = sessionId;
        sessions.set(sessionId, actorId);
        return { ok: true, reassociated: true, snapshot: snapshotValue() };
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
        restoreFromPersistedState,
        reassociatePlayerSession,
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
