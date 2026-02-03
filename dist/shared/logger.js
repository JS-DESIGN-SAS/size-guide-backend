"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logInfo = logInfo;
exports.logError = logError;
function logInfo(message, extra = {}) {
    console.log(JSON.stringify({ level: "INFO", message, ...extra }));
}
function logError(message, extra = {}) {
    console.error(JSON.stringify({ level: "ERROR", message, ...extra }));
}
