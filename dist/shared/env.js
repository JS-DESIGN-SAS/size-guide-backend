"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mustGetEnv = mustGetEnv;
exports.getEnv = getEnv;
function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing required env var: ${name}`);
    return v;
}
function getEnv(name, fallback) {
    return process.env[name] ?? fallback;
}
