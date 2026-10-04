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

function validateWeaponSelection(payload) {
    const weapon = typeof payload === 'number'
        ? payload
        : payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload.weapon
            : undefined;

    if (!Number.isInteger(weapon) || ![1, 2, 3].includes(weapon)) {
        return { ok: false, error: 'INVALID_WEAPON' };
    }

    return { ok: true, weapon };
}

function validateShopItem(payload) {
    if (typeof payload !== 'string') {
        return { ok: false, error: 'INVALID_ITEM' };
    }

    const itemType = payload.trim();
    if (!['medkit', 'shield', 'bomb', 'orbGun'].includes(itemType)) {
        return { ok: false, error: 'INVALID_ITEM' };
    }

    return { ok: true, itemType };
}

function validateRequestId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function validateAdminRoom(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'INVALID_ROOM' };
    }

    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const nombre = typeof payload.nombre === 'string' ? payload.nombre.trim() : '';
    const maxJugadores = Number(payload.maxJugadores);
    const precioEntrada = Number(payload.precioEntrada);

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        return { ok: false, error: 'INVALID_ROOM_ID' };
    }
    if (!nombre || nombre.length > 80) {
        return { ok: false, error: 'INVALID_ROOM_NAME' };
    }
    if (!Number.isInteger(maxJugadores) || maxJugadores < 2 || maxJugadores > 30) {
        return { ok: false, error: 'INVALID_MAX_PLAYERS' };
    }
    if (!Number.isFinite(precioEntrada) || precioEntrada < 0 || precioEntrada > 10000) {
        return { ok: false, error: 'INVALID_ENTRY_FEE' };
    }

    return {
        ok: true,
        room: {
            id,
            nombre,
            maxJugadores,
            precioEntrada,
            esPrivada: payload.esPrivada === true,
            password: typeof payload.password === 'string' ? payload.password.slice(0, 128) : ''
        }
    };
}

module.exports = Object.freeze({
    normalizeCommand,
    validatePlayerInput,
    validateShoot,
    validateWeaponSelection,
    validateShopItem,
    validateAdminRoom,
    validateRequestId
});
