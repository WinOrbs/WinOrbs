'use strict';

function canEquip(inventory, cosmeticId) {
    if (!inventory || typeof inventory !== 'object' || typeof cosmeticId !== 'string') return false;
    const item = inventory[cosmeticId.trim()];
    return !!item && item.type === 'cosmetic' && Number(item.quantity || 0) > 0;
}

function equip(profile, inventory, cosmeticId) {
    if (!profile || !canEquip(inventory, cosmeticId)) return false;
    profile.equippedCosmeticId = cosmeticId.trim().slice(0, 128);
    return true;
}

module.exports = Object.freeze({ canEquip, equip });
