'use strict';

function createNotification(type, message, data = {}) {
    return Object.freeze({
        type: String(type || 'INFO').slice(0, 64),
        message: String(message || '').slice(0, 500),
        data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
        createdAt: Date.now()
    });
}

function queueNotification(queue, userId, notification) {
    if (!queue || typeof queue !== 'object' || !userId || !notification) return false;
    const id = String(userId).slice(0, 128);
    if (!Array.isArray(queue[id])) queue[id] = [];
    queue[id].push(notification);
    if (queue[id].length > 50) queue[id].splice(0, queue[id].length - 50);
    return true;
}

module.exports = Object.freeze({ createNotification, queueNotification });
