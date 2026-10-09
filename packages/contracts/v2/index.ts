'use strict';

const SCHEMA_VERSION = 1;

const GAME_COMMAND_TYPES = Object.freeze([
    'MovePlayer',
    'Shoot',
    'Dash',
    'ThrowBomb',
    'SwitchWeapon',
    'Reload',
    'PickupLoot',
    'Respawn'
] as const);

const GAME_EVENT_TYPES = Object.freeze([
    'PlayerMoved',
    'ShotFired',
    'DamageApplied',
    'PlayerKilled',
    'PlayerDied',
    'OrbDropped',
    'OrbCollected',
    'LootSpawned',
    'LootCollected',
    'PlayerRespawned',
    'ZoneUpdated',
    'ScoreUpdated',
    'MatchStarted',
    'MatchFinished'
] as const);

const MATCH_LIFECYCLE = Object.freeze([
    'WAITING',
    'READY',
    'COUNTDOWN',
    'RUNNING',
    'FINISHING',
    'RESULT_LOCKED',
    'SETTLING',
    'SETTLED'
] as const);

const MATCH_FINISH_REASONS = Object.freeze([
    'LAST_PLAYER',
    'TIME_LIMIT',
    'ABANDONED',
    'DISCONNECT',
    'DRAW',
    'ADMIN_TERMINATED',
    'SERVER_ABORTED'
] as const);

const CONTRACT_ERRORS = Object.freeze({
    INVALID_COMMAND: 'INVALID_COMMAND',
    INVALID_EVENT: 'INVALID_EVENT',
    INVALID_STATE: 'INVALID_STATE',
    INVALID_RESULT: 'INVALID_RESULT',
    INVALID_PRINCIPAL: 'INVALID_PRINCIPAL',
    UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
    INVALID_PAYLOAD: 'INVALID_PAYLOAD',
    INVALID_SEQUENCE: 'INVALID_SEQUENCE'
});

const contracts = Object.freeze({
    SCHEMA_VERSION,
    GAME_COMMAND_TYPES,
    GAME_EVENT_TYPES,
    MATCH_LIFECYCLE,
    MATCH_FINISH_REASONS,
    CONTRACT_ERRORS
});

export = contracts;