'use strict';

const crypto = require('crypto');
const {
    SCHEMA_VERSION,
    MATCH_LIFECYCLE
} = require('../../contracts/v2');
const {
    validateGameEvent,
    validateNewGameEvent,
    validateGameState,
    validateMatchResult
} = require('../../contracts/v2/validation');
const { assertRepositories } = require('../../persistence/v2');

const RECOVERY_STATES = Object.freeze([
    'NOT_FOUND',
    'RECOVERABLE',
    'RESULT_LOCKED',
    'SETTLING',
    'SETTLED',
    'ABORT_REQUIRED'
]);

const MATCH_PERSISTENCE_ERRORS = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    MATCH_ALREADY_EXISTS: 'MATCH_ALREADY_EXISTS',
    INVALID_METADATA: 'INVALID_METADATA',
    INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
    STALE_VERSION: 'STALE_VERSION',
    WRITE_CONFLICT: 'WRITE_CONFLICT',
    INVALID_LIFECYCLE_TRANSITION: 'INVALID_LIFECYCLE_TRANSITION',
    INVALID_EVENT: 'INVALID_EVENT',
    DUPLICATE_EVENT_ID: 'DUPLICATE_EVENT_ID',
    INVALID_EVENT_SEQUENCE: 'INVALID_EVENT_SEQUENCE',
    INVALID_RESULT: 'INVALID_RESULT',
    RESULT_MATCH_MISMATCH: 'RESULT_MATCH_MISMATCH',
    RESULT_VERSION_MISMATCH: 'RESULT_VERSION_MISMATCH',
    RESULT_IMMUTABLE: 'RESULT_IMMUTABLE',
    RESULT_HASH_MISMATCH: 'RESULT_HASH_MISMATCH',
    RESULT_NOT_READY_TO_LOCK: 'RESULT_NOT_READY_TO_LOCK',
    RECOVERY_INCONSISTENT_STATE: 'RECOVERY_INCONSISTENT_STATE',
    PERSISTENCE_ERROR: 'PERSISTENCE_ERROR'
});

const ALLOWED_TRANSITIONS = Object.freeze({
    WAITING: Object.freeze(['READY']),
    READY: Object.freeze(['WAITING', 'COUNTDOWN']),
    COUNTDOWN: Object.freeze(['READY', 'RUNNING']),
    RUNNING: Object.freeze(['FINISHING']),
    FINISHING: Object.freeze([]),
    RESULT_LOCKED: Object.freeze(['SETTLING']),
    SETTLING: Object.freeze(['SETTLED']),
    SETTLED: Object.freeze([])
});

const FORBIDDEN_KEYS = Object.freeze([
    'password',
    'token',
    'secret',
    'credential',
    'wallet',
    'balance',
    'payment',
    'payout',
    'prize',
    'fee',
    'money',
    'roles',
    'permissions',
    'admin',
    'settlement'
]);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value, maxLength = 256) {
    return typeof value === 'string' && value.trim().length > 0 &&
        value.length <= maxLength;
}

function exactKeys(value, required, optional = []) {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowed.has(key));
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function containsForbidden(value, path = '$') {
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const found = containsForbidden(value[index], `${path}[${index}]`);
            if (found) return found;
        }
        return null;
    }
    if (!isRecord(value)) return null;
    for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase();
        if (FORBIDDEN_KEYS.some((part) => normalized.includes(part))) {
            return `${path}.${key}`;
        }
        const found = containsForbidden(child, `${path}.${key}`);
        if (found) return found;
    }
    return null;
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function calculateResultHash(result) {
    const unsigned = { ...result, resultHash: '' };
    return crypto.createHash('sha256').update(canonical(unsigned)).digest('hex');
}

function resultHashIsValid(result) {
    return validateMatchResult(result).ok &&
        calculateResultHash(result) === result.resultHash;
}

function storedResultValue(result) {
    return isRecord(result) && result.locked === true && isRecord(result.value)
        ? result.value
        : result;
}

function isStoredResultLocked(result) {
    return isRecord(result) &&
        Object.keys(result).length === 2 &&
        Object.hasOwn(result, 'locked') &&
        Object.hasOwn(result, 'value') &&
        result.locked === true &&
        isRecord(result.value);
}

function sameValue(left, right) {
    return canonical(left) === canonical(right);
}

function validateFinalSnapshot(snapshot, matchId, rulesVersion) {
    return isRecord(snapshot) &&
        snapshot.schemaVersion === SCHEMA_VERSION &&
        snapshot.matchId === matchId &&
        snapshot.status === 'RESULT_LOCKED' &&
        isRecord(snapshot.gameState) &&
        validateGameState(snapshot.gameState).ok &&
        snapshot.gameState.match.matchId === matchId &&
        snapshot.gameState.match.status === 'RESULT_LOCKED' &&
        snapshot.gameState.match.rulesVersion === rulesVersion;
}

function makeDiagnostic(matchId, code, match, action) {
    return {
        matchId,
        type: code,
        snapshotVersion: match?.matchPersistence?.snapshot?.stateVersion ?? null,
        eventSequence: match?.matchPersistence?.eventSequence ?? null,
        resultVersion: match?.resultVersion ?? null,
        recommendedAction: action
    };
}

function createMatchPersistence({ persistence, clock = Date.now } = {}) {
    assertRepositories(persistence);
    if (typeof clock !== 'function') {
        throw new TypeError('A server clock function is required');
    }

    function validateStoredMatch(match) {
        return isRecord(match) &&
            isId(match.matchId) &&
            MATCH_LIFECYCLE.includes(match.status) &&
            isId(match.rulesVersion) &&
            isRecord(match.matchPersistence) &&
            match.matchPersistence.schemaVersion === SCHEMA_VERSION &&
            Number.isSafeInteger(match.matchPersistence.stateVersion) &&
            Number.isSafeInteger(match.matchPersistence.eventSequence) &&
            Array.isArray(match.matchPersistence.events) &&
            Array.isArray(match.matchPersistence.transitions) &&
            Array.isArray(match.matchPersistence.diagnostics);
    }

    async function readMatch(matchId) {
        if (!isId(matchId)) return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        try {
            const match = await persistence.MatchRepository.getById(matchId);
            return { ok: true, match };
        } catch {
            return failure(MATCH_PERSISTENCE_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function withMatchTransaction(
        matchId,
        expectedStateVersion,
        operation,
        { allowStaleForIdempotency = false } = {}
    ) {
        if (!isId(matchId) || !Number.isSafeInteger(expectedStateVersion) ||
            expectedStateVersion < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        try {
            return await persistence.runInTransaction(async (tx) => {
                const match = await tx.MatchRepository.getById(matchId, tx.transaction);
                if (!match) return failure(MATCH_PERSISTENCE_ERRORS.MATCH_NOT_FOUND);
                if (!validateStoredMatch(match)) {
                    return failure(MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE, {
                        diagnostic: makeDiagnostic(
                            matchId,
                            'INVALID_PERSISTED_MATCH_METADATA',
                            match,
                            'ABORT_MATCH_AND_INSPECT_PERSISTED_RECORD'
                        )
                    });
                }
                const versionMatches =
                    match.matchPersistence.stateVersion === expectedStateVersion;
                if (!versionMatches && !allowStaleForIdempotency) {
                    return failure(MATCH_PERSISTENCE_ERRORS.STALE_VERSION, {
                        expectedStateVersion,
                        actualStateVersion: match.matchPersistence.stateVersion
                    });
                }
                return operation(tx, match, versionMatches);
            });
        } catch {
            return failure(MATCH_PERSISTENCE_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function createMatch(request) {
        if (!exactKeys(request, ['matchId', 'rulesVersion'], ['metadata']) ||
            !isId(request.matchId) || !isId(request.rulesVersion) ||
            (request.metadata !== undefined && !isRecord(request.metadata)) ||
            containsForbidden(request.metadata || {})) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_METADATA);
        }
        const metadata = request.metadata || {};
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        const match = {
            matchId: request.matchId,
            status: 'WAITING',
            rulesVersion: request.rulesVersion,
            result: null,
            resultVersion: null,
            matchPersistence: {
                schemaVersion: SCHEMA_VERSION,
                stateVersion: 1,
                eventSequence: 0,
                snapshot: null,
                resultVersion: null,
                resultLockedAt: null,
                createdAt: now,
                metadata: clone(metadata),
                events: [],
                transitions: [{
                    from: null,
                    to: 'WAITING',
                    version: 1,
                    timestamp: now
                }],
                diagnostics: []
            }
        };
        try {
            await persistence.runInTransaction(async (tx) => {
                const existing = await tx.MatchRepository.getById(
                    request.matchId, tx.transaction
                );
                if (existing) throw Object.assign(new Error('match exists'), {
                    matchPersistenceCode: MATCH_PERSISTENCE_ERRORS.MATCH_ALREADY_EXISTS
                });
                await tx.MatchRepository.create(request.matchId, match, tx.transaction);
            });
            return { ok: true, match: deepFreeze(clone(match)) };
        } catch (error) {
            if (error?.matchPersistenceCode) return failure(error.matchPersistenceCode);
            return failure(MATCH_PERSISTENCE_ERRORS.PERSISTENCE_ERROR);
        }
    }

    async function loadMatch(matchId) {
        const loaded = await readMatch(matchId);
        if (!loaded.ok) return loaded;
        if (!loaded.match) return failure(MATCH_PERSISTENCE_ERRORS.MATCH_NOT_FOUND);
        if (!validateStoredMatch(loaded.match)) {
            return failure(MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE, {
                diagnostic: makeDiagnostic(
                    matchId,
                    'INVALID_PERSISTED_MATCH_METADATA',
                    loaded.match,
                    'ABORT_MATCH_AND_INSPECT_PERSISTED_RECORD'
                )
            });
        }
        const match = loaded.match;
        return {
            ok: true,
            match: deepFreeze(clone({
                matchId: match.matchId,
                status: match.status,
                rulesVersion: match.rulesVersion,
                result: clone(storedResultValue(match.result)),
                resultVersion: match.resultVersion,
                matchPersistence: match.matchPersistence
            }))
        };
    }

    async function loadSnapshot(matchId) {
        const loaded = await loadMatch(matchId);
        if (!loaded.ok) return loaded;
        return {
            ok: true,
            snapshot: loaded.match.matchPersistence.snapshot
                ? deepFreeze(clone(loaded.match.matchPersistence.snapshot))
                : null,
            lifecycle: loaded.match.status,
            stateVersion: loaded.match.matchPersistence.stateVersion,
            eventSequence: loaded.match.matchPersistence.eventSequence
        };
    }

    async function loadEvents(matchId, fromSequence = 1) {
        if (!Number.isSafeInteger(fromSequence) || fromSequence < 1) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        const loaded = await loadMatch(matchId);
        if (!loaded.ok) return loaded;
        return {
            ok: true,
            events: deepFreeze(clone(loaded.match.matchPersistence.events
                .filter((event) => event.sequence >= fromSequence))),
            eventSequence: loaded.match.matchPersistence.eventSequence
        };
    }

    async function saveSnapshot(request) {
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'snapshotVersion',
            'snapshotEventSequence',
            'snapshot'
        ]) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.snapshotVersion) ||
            !Number.isSafeInteger(request.snapshotEventSequence) ||
            !isRecord(request.snapshot) ||
            containsForbidden(request.snapshot)) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
        }
        const candidate = request.snapshot;
        const match = await readMatch(request.matchId);
        if (!match.ok) return match;
        if (!match.match) return failure(MATCH_PERSISTENCE_ERRORS.MATCH_NOT_FOUND);
        if (!validateStoredMatch(match.match)) {
            return failure(MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE);
        }
        if (request.snapshotVersion <=
            (match.match.matchPersistence.snapshot?.stateVersion || 0)) {
            return failure(MATCH_PERSISTENCE_ERRORS.STALE_VERSION, {
                snapshotVersion: match.match.matchPersistence.snapshot?.stateVersion || 0
            });
        }
        const validation = validateGameState(candidate.gameState);
        if (!validation.ok ||
            candidate.schemaVersion !== SCHEMA_VERSION ||
            candidate.matchId !== request.matchId ||
            candidate.status !== match.match.status ||
            candidate.gameState.match.matchId !== request.matchId ||
            candidate.gameState.match.status !== match.match.status ||
            candidate.gameState.match.rulesVersion !== match.match.rulesVersion ||
            request.snapshotEventSequence < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
        }

        const timestamp = clock();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        return withMatchTransaction(
            request.matchId,
            request.expectedStateVersion,
            async (tx, current) => {
                if (current.matchPersistence.resultLockedAt ||
                    ['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(current.status)) {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
                }
                const existingSnapshot = current.matchPersistence.snapshot;
                if (existingSnapshot &&
                    request.snapshotVersion <= existingSnapshot.stateVersion) {
                    return failure(MATCH_PERSISTENCE_ERRORS.STALE_VERSION, {
                        snapshotVersion: existingSnapshot.stateVersion
                    });
                }
                const stateVersion = current.matchPersistence.stateVersion + 1;
                const saved = {
                    stateVersion: request.snapshotVersion,
                    eventSequence: request.snapshotEventSequence,
                    savedAt: timestamp,
                    value: clone(candidate)
                };
                await tx.MatchRepository.update(request.matchId, {
                    matchPersistence: {
                        ...current.matchPersistence,
                        stateVersion,
                        snapshot: saved
                    }
                }, tx.transaction);
                return {
                    ok: true,
                    snapshot: deepFreeze(clone(saved)),
                    stateVersion
                };
            }
        );
    }

    async function appendEvents(request) {
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'events'
        ]) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.expectedStateVersion) ||
            !Array.isArray(request.events) ||
            request.events.length < 1) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        const now = clock();
        if (!Number.isFinite(now) || now < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        return withMatchTransaction(
            request.matchId,
            request.expectedStateVersion,
            async (tx, match) => {
                if (match.matchPersistence.resultLockedAt ||
                    ['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(match.status)) {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_EVENT);
                }
                const knownIds = new Set(match.matchPersistence.events
                    .map((event) => event.eventId));
                let expectedSequence = match.matchPersistence.eventSequence + 1;
                const additions = [];
                for (const input of request.events) {
                    if (!exactKeys(input, [
                        'eventId',
                        'matchId',
                        'sequence',
                        'type',
                        'payload'
                    ], ['actorId'])) {
                        return failure(MATCH_PERSISTENCE_ERRORS.INVALID_EVENT);
                    }
                    if (knownIds.has(input.eventId) ||
                        additions.some((event) => event.eventId === input.eventId)) {
                        return failure(MATCH_PERSISTENCE_ERRORS.DUPLICATE_EVENT_ID);
                    }
                    if (input.matchId !== request.matchId ||
                        input.sequence !== expectedSequence) {
                        return failure(MATCH_PERSISTENCE_ERRORS.INVALID_EVENT_SEQUENCE, {
                            expectedSequence,
                            suppliedSequence: input.sequence
                        });
                    }
                    const event = {
                        schemaVersion: SCHEMA_VERSION,
                        eventId: input.eventId,
                        matchId: request.matchId,
                        sequence: input.sequence,
                        timestamp: now,
                        type: input.type,
                        payload: clone(input.payload),
                        ...(input.actorId === undefined ? {} : { actorId: input.actorId })
                    };
                    if (!validateNewGameEvent(event).ok) {
                        return failure(MATCH_PERSISTENCE_ERRORS.INVALID_EVENT);
                    }
                    additions.push(event);
                    expectedSequence += 1;
                }

                const events = [...match.matchPersistence.events, ...additions];
                const stateVersion = match.matchPersistence.stateVersion + 1;
                await tx.MatchRepository.update(request.matchId, {
                    matchPersistence: {
                        ...match.matchPersistence,
                        stateVersion,
                        eventSequence: additions[additions.length - 1].sequence,
                        events
                    }
                }, tx.transaction);
                return {
                    ok: true,
                    events: deepFreeze(clone(additions)),
                    eventSequence: additions[additions.length - 1].sequence,
                    stateVersion
                };
            }
        );
    }

    async function transitionLifecycle(request) {
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'to'
        ], ['settlementVersion']) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.expectedStateVersion) ||
            !MATCH_LIFECYCLE.includes(request.to) ||
            (request.settlementVersion !== undefined && !isId(request.settlementVersion))) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        return withMatchTransaction(
            request.matchId,
            request.expectedStateVersion,
            async (tx, match) => {
                const from = match.status;
                if (!MATCH_LIFECYCLE.includes(from) ||
                    !ALLOWED_TRANSITIONS[from]?.includes(request.to) ||
                    request.to === 'SETTLED' && !isId(request.settlementVersion)) {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION, {
                        from,
                        to: request.to
                    });
                }
                if (request.to === 'SETTLING' && !match.matchPersistence.resultLockedAt) {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION, {
                        from,
                        to: request.to
                    });
                }
                if (request.to === 'SETTLED' &&
                    match.status !== 'SETTLING') {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_LIFECYCLE_TRANSITION, {
                        from,
                        to: request.to
                    });
                }
                const version = match.matchPersistence.stateVersion + 1;
                await tx.MatchRepository.update(request.matchId, {
                    status: request.to,
                    matchPersistence: {
                        ...match.matchPersistence,
                        stateVersion: version,
                        transitions: [
                            ...match.matchPersistence.transitions,
                            {
                                from,
                                to: request.to,
                                version,
                                timestamp: now,
                                ...(request.settlementVersion
                                    ? { settlementVersion: request.settlementVersion }
                                    : {})
                            }
                        ]
                    }
                }, tx.transaction);
                return { ok: true, from, to: request.to, stateVersion: version };
            }
        );
    }

    async function saveResult(request) {
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'resultVersion',
            'result'
        ]) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.expectedStateVersion) ||
            !isId(request.resultVersion) ||
            !isRecord(request.result)) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        if (!validateMatchResult(request.result).ok) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_RESULT);
        }
        if (request.result.matchId !== request.matchId) {
            return failure(MATCH_PERSISTENCE_ERRORS.RESULT_MATCH_MISMATCH);
        }
        if (!resultHashIsValid(request.result)) {
            return failure(MATCH_PERSISTENCE_ERRORS.RESULT_HASH_MISMATCH);
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        return withMatchTransaction(
            request.matchId,
            request.expectedStateVersion,
            async (tx, match) => {
                const persistedResult = storedResultValue(match.result);
                if (match.matchPersistence.resultLockedAt) {
                    const sameResult = sameValue(persistedResult, request.result) &&
                        match.resultVersion === request.resultVersion;
                    if (sameResult) {
                        return {
                            ok: true,
                            result: deepFreeze(clone(persistedResult)),
                            resultVersion: match.resultVersion,
                            stateVersion: match.matchPersistence.stateVersion
                        };
                    }
                    await recordDiagnostic(tx, match, makeDiagnostic(
                        request.matchId,
                        'RESULT_REPLACEMENT_AFTER_LOCK',
                        match,
                        'PRESERVE_LOCKED_RESULT_AND_INVESTIGATE_CALLER'
                    ));
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
                }
                if (match.status !== 'FINISHING') {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_NOT_READY_TO_LOCK);
                }
                if (match.result) {
                    const sameResult = sameValue(persistedResult, request.result) &&
                        match.resultVersion === request.resultVersion;
                    if (sameResult) return {
                        ok: true,
                        result: deepFreeze(clone(persistedResult)),
                        resultVersion: match.resultVersion,
                        stateVersion: match.matchPersistence.stateVersion
                    };
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_VERSION_MISMATCH);
                }
                if (request.result.rulesVersion !== match.rulesVersion) {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_VERSION_MISMATCH);
                }
                const stateVersion = match.matchPersistence.stateVersion + 1;
                await tx.MatchRepository.update(request.matchId, {
                    result: clone(request.result),
                    resultVersion: request.resultVersion,
                    matchPersistence: {
                        ...match.matchPersistence,
                        stateVersion,
                        resultVersion: request.resultVersion
                    }
                }, tx.transaction);
                return {
                    ok: true,
                    result: deepFreeze(clone(request.result)),
                    resultVersion: request.resultVersion,
                    stateVersion
                };
            }
        );
    }

    async function recordDiagnostic(tx, match, diagnostic) {
        const timestamp = clock();
        const entry = {
            ...diagnostic,
            diagnosticId: crypto.createHash('sha256')
                .update(JSON.stringify([
                    diagnostic.matchId,
                    diagnostic.type,
                    timestamp,
                    match.matchPersistence.diagnostics.length
                ]))
                .digest('hex'),
            timestamp
        };
        const stateVersion = match.matchPersistence.stateVersion + 1;
        await tx.MatchRepository.update(match.matchId, {
            matchPersistence: {
                ...match.matchPersistence,
                stateVersion,
                diagnostics: [...match.matchPersistence.diagnostics, entry]
            }
        }, tx.transaction);
        return entry;
    }

    async function lockResult(request) {
        const hasSnapshotFields = request &&
            ['snapshotVersion', 'snapshotEventSequence', 'snapshot']
                .some((key) => Object.hasOwn(request, key));
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'resultVersion',
            'resultId',
            'resultHash'
        ], [
            'snapshotVersion',
            'snapshotEventSequence',
            'snapshot'
        ]) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.expectedStateVersion) ||
            !isId(request.resultVersion) ||
            !isId(request.resultId) ||
            typeof request.resultHash !== 'string' ||
            !/^[a-f0-9]{64}$/i.test(request.resultHash) ||
            (hasSnapshotFields &&
                (request.snapshot === undefined ||
                    request.snapshotVersion === undefined ||
                    request.snapshotEventSequence === undefined)) ||
            (request.snapshot !== undefined &&
                (!Number.isSafeInteger(request.snapshotVersion) ||
                    !Number.isSafeInteger(request.snapshotEventSequence) ||
                    !isRecord(request.snapshot)))) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        if (request.snapshot !== undefined) {
            if (containsForbidden(request.snapshot)) {
                return failure(MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
            }
            const loaded = await loadMatch(request.matchId);
            if (!loaded.ok) return loaded;
            return finalizeResult({
                matchId: request.matchId,
                expectedStateVersion: request.expectedStateVersion,
                resultVersion: request.resultVersion,
                snapshotVersion: request.snapshotVersion,
                snapshotEventSequence: request.snapshotEventSequence,
                snapshot: request.snapshot,
                result: loaded.match.result
            });
        }

        const loaded = await loadMatch(request.matchId);
        if (!loaded.ok) return loaded;
        const match = loaded.match;
        const result = match.result;
        const stored = await readMatch(request.matchId);
        if (!stored.ok) return stored;
        if (!isStoredResultLocked(stored.match?.result) ||
            !stored.match?.matchPersistence?.snapshot ||
            stored.match.matchPersistence.snapshot.value?.status !== 'RESULT_LOCKED' ||
            !match.matchPersistence.resultLockedAt ||
            !['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(match.status) ||
            result?.resultId !== request.resultId ||
            result?.resultHash !== request.resultHash ||
            match.resultVersion !== request.resultVersion) {
            return failure(MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
        }
        if (!validateMatchResult(result).ok ||
            !resultHashIsValid(result) ||
            result.matchId !== request.matchId ||
            match.resultVersion !== match.matchPersistence.resultVersion) {
            return failure(MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE);
        }
        return {
            ok: true,
            result: deepFreeze(clone(result)),
            status: match.status,
            stateVersion: match.matchPersistence.stateVersion
        };
    }

    async function finalizeResult(request) {
        if (!exactKeys(request, [
            'matchId',
            'expectedStateVersion',
            'resultVersion',
            'snapshotVersion',
            'snapshotEventSequence',
            'snapshot',
            'result'
        ]) ||
            !isId(request.matchId) ||
            !Number.isSafeInteger(request.expectedStateVersion) ||
            !isId(request.resultVersion) ||
            !Number.isSafeInteger(request.snapshotVersion) ||
            !Number.isSafeInteger(request.snapshotEventSequence) ||
            !isRecord(request.snapshot) ||
            !isRecord(request.result) ||
            containsForbidden(request.snapshot)) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }
        if (!validateMatchResult(request.result).ok) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_RESULT);
        }
        if (request.result.matchId !== request.matchId) {
            return failure(MATCH_PERSISTENCE_ERRORS.RESULT_MATCH_MISMATCH);
        }
        if (!resultHashIsValid(request.result)) {
            return failure(MATCH_PERSISTENCE_ERRORS.RESULT_HASH_MISMATCH);
        }
        const now = clock();
        if (!Number.isSafeInteger(now) || now < 0) {
            return failure(MATCH_PERSISTENCE_ERRORS.INVALID_REQUEST);
        }

        return withMatchTransaction(
            request.matchId,
            request.expectedStateVersion,
            async (tx, match, versionMatches) => {
                if (!validateFinalSnapshot(
                    request.snapshot,
                    request.matchId,
                    match.rulesVersion
                ) || request.snapshotEventSequence !==
                    match.matchPersistence.eventSequence) {
                    return failure(MATCH_PERSISTENCE_ERRORS.INVALID_SNAPSHOT);
                }
                const snapshot = match.matchPersistence.snapshot;
                const alreadyFinalized =
                    isStoredResultLocked(match.result) &&
                    match.matchPersistence.resultLockedAt &&
                    ['RESULT_LOCKED', 'SETTLING', 'SETTLED'].includes(match.status) &&
                    match.resultVersion === request.resultVersion &&
                    match.matchPersistence.resultVersion === request.resultVersion &&
                    sameValue(storedResultValue(match.result), request.result) &&
                    snapshot?.stateVersion === request.snapshotVersion &&
                    snapshot?.eventSequence === request.snapshotEventSequence &&
                    sameValue(snapshot?.value, request.snapshot);
                if (alreadyFinalized) {
                    return {
                        ok: true,
                        result: deepFreeze(clone(request.result)),
                        snapshot: deepFreeze(clone(snapshot)),
                        status: match.status,
                        stateVersion: match.matchPersistence.stateVersion
                    };
                }
                if (isStoredResultLocked(match.result) ||
                    match.matchPersistence.resultLockedAt) {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
                }
                if (!versionMatches) {
                    return failure(MATCH_PERSISTENCE_ERRORS.STALE_VERSION, {
                        expectedStateVersion: request.expectedStateVersion,
                        actualStateVersion: match.matchPersistence.stateVersion
                    });
                }
                if (match.status !== 'FINISHING') {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_NOT_READY_TO_LOCK);
                }
                if (request.result.rulesVersion !== match.rulesVersion) {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_VERSION_MISMATCH);
                }
                if (match.result &&
                    (!sameValue(storedResultValue(match.result), request.result) ||
                        match.resultVersion !== request.resultVersion ||
                        match.matchPersistence.resultVersion !== request.resultVersion)) {
                    return failure(MATCH_PERSISTENCE_ERRORS.RESULT_IMMUTABLE);
                }
                const previousSnapshotVersion = snapshot?.stateVersion || 0;
                if (request.snapshotVersion <= previousSnapshotVersion) {
                    return failure(MATCH_PERSISTENCE_ERRORS.STALE_VERSION, {
                        snapshotVersion: previousSnapshotVersion
                    });
                }

                const stateVersion = match.matchPersistence.stateVersion + 1;
                const savedSnapshot = {
                    stateVersion: request.snapshotVersion,
                    eventSequence: request.snapshotEventSequence,
                    savedAt: now,
                    value: clone(request.snapshot)
                };
                const matchPersistence = {
                    ...match.matchPersistence,
                    stateVersion,
                    snapshot: savedSnapshot,
                    resultVersion: request.resultVersion,
                    resultLockedAt: now,
                    transitions: [
                        ...match.matchPersistence.transitions,
                        {
                            from: 'FINISHING',
                            to: 'RESULT_LOCKED',
                            version: stateVersion,
                            timestamp: now
                        }
                    ]
                };
                await tx.MatchRepository.update(request.matchId, {
                    status: 'RESULT_LOCKED',
                    result: {
                        locked: true,
                        value: clone(request.result)
                    },
                    resultVersion: request.resultVersion,
                    matchPersistence
                }, tx.transaction);
                return {
                    ok: true,
                    result: deepFreeze(clone(request.result)),
                    snapshot: deepFreeze(clone(savedSnapshot)),
                    status: 'RESULT_LOCKED',
                    stateVersion
                };
            },
            { allowStaleForIdempotency: true }
        );
    }

    async function loadResult(matchId) {
        const loaded = await loadMatch(matchId);
        if (!loaded.ok) return loaded;
        const match = loaded.match;
        if (!match.result) return { ok: true, result: null, locked: false };
        const valid = validateMatchResult(match.result).ok &&
            resultHashIsValid(match.result) &&
            match.result.matchId === matchId;
        if (!valid) {
            return failure(MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE, {
                diagnostic: makeDiagnostic(
                    matchId,
                    'RESULT_HASH_OR_SCHEMA_INVALID',
                    match,
                    'VERIFY_RESULT_SOURCE_AND_ABORT_IF_UNTRUSTED'
                )
            });
        }
        return {
            ok: true,
            result: deepFreeze(clone(match.result)),
            resultVersion: match.resultVersion,
            locked: Boolean(match.matchPersistence.resultLockedAt)
        };
    }

    function diagnoseRecovery(matchId, match, type, action) {
        return {
            ok: false,
            error: {
                code: MATCH_PERSISTENCE_ERRORS.RECOVERY_INCONSISTENT_STATE,
                diagnostic: makeDiagnostic(matchId, type, match, action)
            }
        };
    }

    function abortRequired(matchId, match, type, action) {
        return {
            ok: true,
            state: 'ABORT_REQUIRED',
            matchId,
            diagnostic: makeDiagnostic(matchId, type, match, action)
        };
    }

    function eventHistoryProblem(match) {
        const events = match.matchPersistence.events;
        let expected = 1;
        const ids = new Set();
        for (const event of events) {
            if (!validateGameEvent(event).ok || event.matchId !== match.matchId) {
                return 'INVALID_PERSISTED_EVENT';
            }
            if (ids.has(event.eventId)) return 'DUPLICATE_PERSISTED_EVENT_ID';
            ids.add(event.eventId);
            if (event.sequence !== expected) return 'EVENT_SEQUENCE_GAP';
            expected += 1;
        }
        if (expected - 1 !== match.matchPersistence.eventSequence) {
            return 'EVENT_CURSOR_MISMATCH';
        }
        return null;
    }

    async function recoverMatch(matchId) {
        const loaded = await readMatch(matchId);
        if (!loaded.ok) return loaded;
        if (!loaded.match) return { ok: true, state: 'NOT_FOUND', matchId };
        const storedMatch = loaded.match;
        if (!validateStoredMatch(storedMatch)) {
            return diagnoseRecovery(
                matchId,
                storedMatch,
                'INVALID_PERSISTED_MATCH_METADATA',
                'ABORT_MATCH_AND_INSPECT_PERSISTED_RECORD'
            );
        }
        const match = {
            ...storedMatch,
            result: clone(storedResultValue(storedMatch.result))
        };
        const consistencyIssue = eventHistoryProblem(match);
        if (consistencyIssue) {
            return diagnoseRecovery(
                matchId,
                match,
                consistencyIssue,
                'DO_NOT_REPLAY_OR_CONTINUE_UNTIL_EVENT_HISTORY_IS_VERIFIED'
            );
        }
        const snapshot = match.matchPersistence.snapshot;
        const lockedLifecycle = ['RESULT_LOCKED', 'SETTLING', 'SETTLED']
            .includes(match.status);
        const snapshotLifecycle = lockedLifecycle ? 'RESULT_LOCKED' : match.status;
        if (snapshot) {
            const validSnapshot = isRecord(snapshot.value) &&
                validateGameState(snapshot.value.gameState).ok &&
                snapshot.value.matchId === matchId &&
                snapshot.value.status === snapshotLifecycle &&
                snapshot.value.gameState.match.status === snapshotLifecycle &&
                snapshot.value.gameState.match.rulesVersion === match.rulesVersion;
            if (!validSnapshot) {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'SNAPSHOT_INVALID_OR_LIFECYCLE_MISMATCH',
                    'ABORT_MATCH_AND_INSPECT_SNAPSHOT'
                );
            }
            if (snapshot.eventSequence > match.matchPersistence.eventSequence) {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'SNAPSHOT_AHEAD_OF_EVENT_LOG',
                    'ABORT_MATCH_AND_RECONCILE_SNAPSHOT_WITH_EVENT_LOG'
                );
            }
        }
        if (lockedLifecycle &&
            !match.matchPersistence.resultLockedAt) {
            return diagnoseRecovery(
                matchId,
                match,
                'LOCKED_LIFECYCLE_WITHOUT_RESULT_LOCK',
                'ABORT_MATCH_AND_INSPECT_RESULT_LOCK'
            );
        }
        if (lockedLifecycle &&
            (!isStoredResultLocked(storedMatch.result) || !snapshot ||
                snapshot.eventSequence !== match.matchPersistence.eventSequence)) {
            return diagnoseRecovery(
                matchId,
                match,
                !snapshot
                    ? 'LOCKED_RESULT_SNAPSHOT_MISSING'
                    : 'LOCKED_RESULT_SNAPSHOT_INCONSISTENT',
                'ABORT_MATCH_AND_INSPECT_FINAL_AGGREGATE'
            );
        }
        if (isStoredResultLocked(storedMatch.result) && !lockedLifecycle) {
            return diagnoseRecovery(
                matchId,
                match,
                'RESULT_LOCK_MARKER_WITHOUT_LOCKED_LIFECYCLE',
                'ABORT_MATCH_AND_INSPECT_RESULT_LOCK'
            );
        }
        if (match.result) {
            if (!resultHashIsValid(match.result) || match.result.matchId !== matchId ||
                match.resultVersion !== match.matchPersistence.resultVersion) {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'RESULT_HASH_OR_VERSION_INCONSISTENT',
                    'VERIFY_RESULT_SOURCE_AND_ABORT_IF_UNTRUSTED'
                );
            }
        }
        if (match.matchPersistence.resultLockedAt) {
            if (match.status !== 'RESULT_LOCKED' &&
                match.status !== 'SETTLING' && match.status !== 'SETTLED') {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'LOCKED_RESULT_LIFECYCLE_MISMATCH',
                    'ABORT_MATCH_AND_INSPECT_RESULT_LOCK'
                );
            }
            if (!match.result) {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'RESULT_LOCK_MISSING_RESULT',
                    'ABORT_MATCH_AND_INSPECT_RESULT_LOCK'
                );
            }
            if (!isStoredResultLocked(storedMatch.result)) {
                return diagnoseRecovery(
                    matchId,
                    match,
                    'RESULT_LOCK_MARKER_MISSING',
                    'ABORT_MATCH_AND_INSPECT_RESULT_LOCK'
                );
            }
        }
        if (match.status === 'RESULT_LOCKED') {
            return {
                ok: true,
                state: 'RESULT_LOCKED',
                match: deepFreeze(clone(match)),
                replayRequired: Boolean(snapshot &&
                    snapshot.eventSequence < match.matchPersistence.eventSequence)
            };
        }
        if (match.status === 'SETTLING') {
            return {
                ok: true,
                state: 'SETTLING',
                match: deepFreeze(clone(match)),
                replayRequired: false
            };
        }
        if (match.status === 'SETTLED') {
            return {
                ok: true,
                state: 'SETTLED',
                match: deepFreeze(clone(match)),
                replayRequired: false
            };
        }
        if (match.status === 'FINISHING' && !match.result) {
            return abortRequired(
                matchId,
                match,
                'FINISHING_WITHOUT_RESULT',
                'ABORT_MATCH_OR_REGENERATE_RESULT_FROM_AUTHORITATIVE_SOURCE'
            );
        }
        if (match.status === 'FINISHING' && match.result) {
            return {
                ok: true,
                state: 'RECOVERABLE',
                match: deepFreeze(clone(match)),
                actionRequired: 'LOCK_VALID_PERSISTED_RESULT',
                replayRequired: false
            };
        }
        if (snapshot &&
            snapshot.eventSequence < match.matchPersistence.eventSequence) {
            return {
                ok: true,
                state: 'RECOVERABLE',
                match: deepFreeze(clone(match)),
                actionRequired: 'REPLAY_AUTHORITATIVE_EVENTS_WITH_GAME_ENGINE',
                replayRequired: true
            };
        }
        if (match.status === 'RUNNING' && !snapshot) {
            return abortRequired(
                matchId,
                match,
                'RUNNING_WITHOUT_SNAPSHOT',
                'ABORT_MATCH_OR_RESTORE_FROM_VERIFIED_EVENT_HISTORY'
            );
        }
        if (snapshot &&
            snapshot.eventSequence !== match.matchPersistence.eventSequence) {
            return diagnoseRecovery(
                matchId,
                match,
                'SNAPSHOT_EVENT_CURSOR_MISMATCH',
                'ABORT_MATCH_AND_RECONCILE_SNAPSHOT_WITH_EVENT_LOG'
            );
        }
        return {
            ok: true,
            state: 'RECOVERABLE',
            match: deepFreeze(clone(match)),
            actionRequired: 'CONTINUE_FROM_PERSISTED_SNAPSHOT',
            replayRequired: false
        };
    }

    return Object.freeze({
        createMatch,
        loadMatch,
        loadSnapshot,
        loadEvents,
        loadResult,
        saveSnapshot,
        appendEvents,
        saveResult,
        finalizeResult,
        lockResult,
        transitionLifecycle,
        recoverMatch
    });
}

module.exports = Object.freeze({
    RECOVERY_STATES,
    MATCH_PERSISTENCE_ERRORS,
    ALLOWED_TRANSITIONS,
    createMatchPersistence
});
