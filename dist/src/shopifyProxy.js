"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProxySignature = validateProxySignature;
exports.getProxyShop = getProxyShop;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
/**
 * Valida la firma HMAC de una petición App Proxy de Shopify.
 * Parámetros (excepto signature) ordenados por clave, concatenados como key=value sin separador.
 * HMAC-SHA256 con API secret, comparación hexadecimal (timing-safe).
 */
function validateProxySignature(query) {
    const signature = query.signature;
    if (typeof signature !== "string" || !signature)
        return false;
    const secret = config_1.config.shopifyApiSecret;
    if (!secret)
        return false;
    const rest = {};
    for (const [k, v] of Object.entries(query)) {
        if (k === "signature")
            continue;
        const val = Array.isArray(v) ? v.join(",") : (v ?? "");
        rest[k] = String(val);
    }
    const sortedKeys = Object.keys(rest).sort();
    const message = sortedKeys.map((k) => `${k}=${rest[k]}`).join("");
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(message).digest("hex");
    if (expected.length !== signature.length)
        return false;
    try {
        return (0, node_crypto_1.timingSafeEqual)(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    }
    catch {
        return false;
    }
}
/** Parámetros típicos que Shopify añade al proxy (shop, path_prefix, timestamp, signature, logged_in_customer_id). */
function getProxyShop(query) {
    const shop = query.shop;
    if (typeof shop !== "string" || !shop)
        return null;
    return shop;
}
