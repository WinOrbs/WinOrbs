'use strict';

/**
 * Pure combat resolution. It does not decide who may issue an attack; transport
 * and the match domain enforce that. It only resolves authoritative damage.
 */
function applyDamage(target, amount) {
    if (!target || typeof target !== 'object') {
        return { absorbed: 0, damage: 0, hp: 0, killed: false };
    }

    let remaining = Math.max(0, Number(amount) || 0);
    const beforeShield = Math.max(0, Number(target.shield) || 0);
    const absorbed = Math.min(beforeShield, remaining);
    target.shield = beforeShield - absorbed;
    remaining -= absorbed;

    const beforeHp = Math.max(0, Number(target.hp) || 0);
    const damage = Math.min(beforeHp, remaining);
    target.hp = beforeHp - damage;

    return {
        absorbed,
        damage,
        hp: target.hp,
        killed: target.hp <= 0
    };
}

module.exports = Object.freeze({ applyDamage });
