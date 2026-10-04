'use strict';

/**
 * WinOrbs 2.0 — transport validation primitives.
 *
 * These validators are deliberately dependency-free and side-effect-free.
 * They reject malformed client input before it reaches game/business logic.
 */

const MAX_NICK_LENGTH = 16;
const MAX_INPUT_ANGLE = Math.PI * 2;
const ALLOWED_WEAPONS = new Set([1, 2, 3]);
const ALLOWED_INPUT_KEYS = new Set(['w', 'a', 's', 'd', 'angle']);

function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function validAngle(value) {
    return finiteNumber(value) && Math.abs(value) <= MAX_INPUT_ANGLE;
}

function sanitizeBoolean(value) {
    return value === true;
}

function validatePlayerInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (keys.some((key) => !ALLOWED_INPUT_KEYS.has(key))) return null;

    for (const key of ['w', 'a', 's', 'd']) {
        if (input[key] !== undefined && typeof input[key] !== 'boolean') return null;
    }

    const result = {
        w: sanitizeBoolean(input.w),
        a: sanitizeBoolean(input.a),
        s: sanitizeBoolean(input.s),
        d: sanitizeBoolean(input.d),
        angle: 0
    };

    if (input.angle !== undefined) {
        if (!validAngle(input.angle)) return null;
        result.angle = input.angle;
    }

    return result;
}

function validateShootData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (!validAngle(data.angle)) return null;
    return { angle: data.angle };
}

function validateWeapon(value) {
    return Number.isInteger(value) && ALLOWED_WEAPONS.has(value) ? value : null;
}

function validateNick(value) {
    if (typeof value !== 'string') return null;
    const nick = value.trim();
    if (nick.length < 1 || nick.length > MAX_NICK_LENGTH) return null;
    if (/[<>&"]/u.test(nick)) return null;
    return nick;
}

module.exports = Object.freeze({
    finiteNumber,
    validAngle,
    validatePlayerInput,
    validateShootData,
    validateWeapon,
    validateNick
});
