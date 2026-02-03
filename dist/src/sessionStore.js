"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSession = setSession;
exports.getSession = getSession;
exports.hasSession = hasSession;
const sessions = new Map();
function setSession(shop, data) {
    sessions.set(shop, {
        shop,
        ...data,
        createdAt: Date.now()
    });
}
function getSession(shop) {
    return sessions.get(shop) ?? null;
}
function hasSession(shop) {
    return sessions.has(shop);
}
