"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_IMAGE_EXTENSIONS = exports.ALLOWED_IMAGE_TYPES = exports.config = void 0;
exports.getMaxFileBytes = getMaxFileBytes;
const env_1 = require("../shared/env");
const DEFAULT_CORS_ORIGINS = "https://js-tryon.myshopify.com,https://juliana-sanchez-ecommerce.myshopify.com";
function parseCorsOrigins(value) {
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
/** Shopify app: obligatorios si usas OAuth / App Proxy. */
const shopifyApiKey = (0, env_1.getEnv)("SHOPIFY_API_KEY_APP", "");
const shopifyApiSecret = (0, env_1.getEnv)("SHOPIFY_API_SECRET_APP", "");
const shopifyAppUrl = (0, env_1.getEnv)("SHOPIFY_APP_URL", "");
exports.config = {
    port: Number((0, env_1.getEnv)("PORT", "8080")),
    maxFileMb: Number((0, env_1.getEnv)("MAX_FILE_MB", "10")),
    bigqueryProject: (0, env_1.getEnv)("BIGQUERY_PROJECT", ""),
    /** Lista de orígenes permitidos (CORS). Env: CORS_ALLOWED_ORIGINS separados por coma. */
    corsAllowedOrigins: parseCorsOrigins((0, env_1.getEnv)("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS)),
    // Shopify app (OAuth + App Proxy)
    shopifyApiKey,
    shopifyApiSecret,
    shopifyScopes: (0, env_1.getEnv)("SCOPES", "read_products"),
    shopifyAppUrl: shopifyAppUrl.replace(/\/$/, ""),
    databaseUrl: (0, env_1.getEnv)("DATABASE_URL", ""),
    /** true si OAuth/Proxy están configurados */
    shopifyEnabled: Boolean(shopifyApiKey && shopifyApiSecret && shopifyAppUrl),
    /** Lógica tryon: "gemini" = Gemini; "fashn" = FASHN Try-On Max */
    tryonLogic: (0, env_1.getEnv)("TRYON_LOGIC", "gemini"),
    /** Modelo Gemini para virtual try-on (ej. gemini-3-pro-image-preview) */
    geminiTryonModel: (0, env_1.getEnv)("GEMINI_TRYON_MODEL", "gemini-3-pro-image-preview"),
    /** API key de Google AI (Gemini). Env: GEMINI_API_KEY */
    geminiApiKey: (0, env_1.getEnv)("GEMINI_API_KEY", ""),
    /** Base URL de FASHN API. Env: FASHN_BASE_URL */
    fashnBaseUrl: (0, env_1.getEnv)("FASHN_BASE_URL", "https://api.fashn.ai").replace(/\/$/, ""),
    /** API key de FASHN. Env: FASHN_API_KEY */
    fashnApiKey: (0, env_1.getEnv)("FASHN_API_KEY", ""),
    /** ID de carpeta de Google Drive donde guardar fotos del usuario. Env: GOOGLE_DRIVE_UPLOAD_FOLDER_ID (o DRIVE_FOLDER_ID). Si está vacío no se sube. */
    driveFolderId: (0, env_1.getEnv)("GOOGLE_DRIVE_UPLOAD_FOLDER_ID", "") || (0, env_1.getEnv)("DRIVE_FOLDER_ID", ""),
};
exports.ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
exports.ALLOWED_IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
};
function getMaxFileBytes() {
    return exports.config.maxFileMb * 1024 * 1024;
}
