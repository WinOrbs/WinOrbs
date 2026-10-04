'use strict';

/**
 * WinOrbs 2.0 — command normalization helpers.
 *
 * Transport owns shape/type checks only. Game rules remain in domain modules.
 */

function normalizeCommand(command, type, payload) {
    const value = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};

    return Object.freeze({
        commandId: typeof command === 'string' && command.trim()
            ? command.trim().slice(0, 128)
            : null,
        type,
        timestamp: Date.now(),
        payload: value
    });
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function validatePlayerInput(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'INVALID_PAYLOAD' };
    }

    const keys = ['w', 'a', 's', 'd', 'angle'];
    for (const key of keys) {
        if (!(key in payload)) continue;
        if (key === 'angle') {
            if (!isFiniteNumber(payload[key])) return { ok: false, error: 'INVALID_PAYLOAD' };
        } else if (typeof payload[key] !== 'boolean') {
            return { ok: false, error: 'INVALID_PAYLOAD' };
        }
    }

    if ('angle' in payload && Math.abs(payload.angle) > Math.PI * 2) {
        return { ok: false, error: 'INVALID_PAYLOAD' };
    }

    return { ok: true };
}

function validateShoot(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    if (!isFiniteNumber(payload.angle) || Math.abs(payload.angle) > Math.PI * 2) {
        return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    return { ok: true };
}

module.exports = Object.freeze({
    normalizeCommand,
    validatePlayerInput,
    validateShoot
});
