"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOAuthRedirectUrl = getOAuthRedirectUrl;
exports.verifyState = verifyState;
exports.exchangeCodeForToken = exchangeCodeForToken;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
const sessionStore_1 = require("./sessionStore");
const logger_1 = require("../shared/logger");
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min
const stateToShop = new Map();
function cleanupState() {
    const now = Date.now();
    for (const [state, data] of stateToShop.entries()) {
        if (now - data.createdAt > STATE_TTL_MS)
            stateToShop.delete(state);
    }
}
/** Genera la URL de autorización OAuth (redirect a Shopify). */
function getOAuthRedirectUrl(shop) {
    const state = (0, node_crypto_1.randomBytes)(16).toString("hex");
    stateToShop.set(state, { shop, createdAt: Date.now() });
    if (stateToShop.size > 1000)
        cleanupState();
    const redirectUri = `${config_1.config.shopifyAppUrl}/auth/callback`;
    const params = new URLSearchParams({
        client_id: config_1.config.shopifyApiKey,
        scope: config_1.config.shopifyScopes,
        redirect_uri: redirectUri,
        state
    });
    const url = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
    (0, logger_1.logInfo)("shopify auth redirect", { shop, redirectUri });
    return url;
}
/** Verifica state y devuelve el shop asociado, o null si inválido. */
function verifyState(state) {
    const data = stateToShop.get(state);
    if (!data)
        return null;
    if (Date.now() - data.createdAt > STATE_TTL_MS) {
        stateToShop.delete(state);
        return null;
    }
    stateToShop.delete(state);
    return data.shop;
}
/** Intercambia code por access_token y guarda sesión. */
async function exchangeCodeForToken(shop, code) {
    const url = `https://${shop}/admin/oauth/access_token`;
    const body = JSON.stringify({
        client_id: config_1.config.shopifyApiKey,
        client_secret: config_1.config.shopifyApiSecret,
        code
    });
    (0, logger_1.logInfo)("shopify exchange token", { shop, url: url.replace(/[?&].*/, "") });
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
    });
    if (!res.ok) {
        const text = await res.text();
        (0, logger_1.logError)("shopify exchange token failed", { shop, status: res.status, body: text });
        throw new Error(`OAuth token exchange failed: ${res.status} ${text}`);
    }
    const data = (await res.json());
    (0, sessionStore_1.setSession)(shop, {
        accessToken: data.access_token,
        scope: data.scope ?? config_1.config.shopifyScopes
    });
    (0, logger_1.logInfo)("shopify session saved", { shop });
}
