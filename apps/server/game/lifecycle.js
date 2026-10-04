'use strict';

const MATCH_STATUS = Object.freeze({
    CREATED: 'CREATED',
    WAITING: 'WAITING',
    READY: 'READY',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    ENDING: 'ENDING',
    RESULT_LOCKED: 'RESULT_LOCKED',
    COMPLETED: 'COMPLETED'
});

const TRANSITIONS = Object.freeze({
    CREATED: ['WAITING'],
    WAITING: ['READY', 'STARTING'],
    READY: ['STARTING', 'WAITING'],
    STARTING: ['RUNNING', 'WAITING'],
    RUNNING: ['ENDING'],
    ENDING: ['RESULT_LOCKED'],
    RESULT_LOCKED: ['COMPLETED'],
    COMPLETED: ['WAITING']
});

function canTransition(from, to) {
    return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function transition(state, to) {
    const from = state && state.status;
    if (!canTransition(from, to)) {
        return { ok: false, error: 'INVALID_MATCH_TRANSITION', from, to };
    }
    return { ok: true, state: Object.assign({}, state, { status: to }) };
}

module.exports = Object.freeze({ MATCH_STATUS, canTransition, transition });
