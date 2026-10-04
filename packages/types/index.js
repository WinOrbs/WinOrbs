'use strict';

/**
 * WinOrbs 2.0 — shared protocol vocabulary.
 *
 * These constants are transport/domain labels only. They do not contain
 * gameplay authority or client-controlled business values.
 */

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

const COMMANDS = Object.freeze([
    'JOIN_MATCH',
    'LEAVE_MATCH',
    'PLAYER_MOVE',
    'PLAYER_SHOOT',
    'COLLECT_ORB'
]);

const EVENTS = Object.freeze([
    'PlayerJoinedMatch',
    'PlayerMoved',
    'PlayerDamaged',
    'PlayerDied',
    'OrbDropped',
    'OrbCollected',
    'PlayerEliminated',
    'MatchStarted',
    'MatchEnded',
    'MatchCompleted',
    'ItemPurchased',
    'SkinEquipped'
]);

const RESOURCE_BOUNDARIES = Object.freeze({
    MATCH_ORBS: 'MatchOrbs',
    SCORE: 'Score',
    XP: 'XP',
    PERSISTENT_CURRENCY: 'PersistentCurrency',
    REAL_MONEY: 'RealMoney'
});

module.exports = Object.freeze({
    MATCH_STATUS,
    COMMANDS,
    EVENTS,
    RESOURCE_BOUNDARIES
});
