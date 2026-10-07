'use strict';

const { createMatchCoordinator } = require('../match-coordinator/v2');

function createGame(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('game options must be an object');
    }

    const {
        recovery,
        ...coordinatorOptions
    } = options;
    const coordinator = createMatchCoordinator(coordinatorOptions);
    const initialized = recovery === undefined
        ? coordinator.createMatch()
        : coordinator.restoreFromPersistedState(recovery);

    if (!initialized.ok) {
        throw new TypeError(`Unable to initialize game: ${initialized.error.code}`);
    }

    return Object.freeze({
        joinPlayer: (actorId, sessionId) => coordinator.addPlayer(actorId, sessionId),
        leavePlayer: (actorId, sessionId) => coordinator.removePlayer(actorId, sessionId),
        markReady: (actorId, sessionId) => coordinator.markReady(actorId, sessionId),
        startCountdown: () => coordinator.startCountdown(),
        start: () => coordinator.startMatch(),
        handleInput: (command) => coordinator.submitCommand(command),
        tick: () => coordinator.advanceTick(),
        finish: (reason) => coordinator.finishMatch(reason),
        restoreSession: (matchId, actorId, sessionId) =>
            coordinator.reassociatePlayerSession(matchId, actorId, sessionId),
        getState: () => coordinator.getSnapshot(),
        getEvents: () => coordinator.getEvents(),
        getResult: () => coordinator.getResult()
    });
}

module.exports = Object.freeze({ createGame });
