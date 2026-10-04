'use strict';

function normalizeItemId(value) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : null;
}

function hasItem(inventory, itemId) {
    const id = normalizeItemId(itemId);
    if (!id || !inventory || typeof inventory !== 'object') return false;
    const item = inventory[id];
    return !!item && Number(item.quantity || 0) > 0;
}

function grantItem(inventory, itemId, quantity = 1) {
    const id = normalizeItemId(itemId);
    const amount = Number(quantity);
    if (!id || !Number.isInteger(amount) || amount <= 0 || amount > 1000) return false;
    inventory[id] = Object.assign({}, inventory[id], {
        quantity: Number(inventory[id]?.quantity || 0) + amount
    });
    return true;
}

function consumeItem(inventory, itemId, quantity = 1) {
    const id = normalizeItemId(itemId);
    const amount = Number(quantity);
    if (!id || !Number.isInteger(amount) || amount <= 0 || !hasItem(inventory, id)) return false;
    const next = Number(inventory[id].quantity) - amount;
    if (next < 0) return false;
    inventory[id] = Object.assign({}, inventory[id], { quantity: next });
    return true;
}

module.exports = Object.freeze({ normalizeItemId, hasItem, grantItem, consumeItem });
