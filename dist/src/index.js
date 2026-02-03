"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const config_1 = require("./config");
const bigquery_1 = require("./bigquery");
const gemini_1 = require("./gemini");
const fashn_1 = require("./fashn");
const drive_1 = require("./drive");
const shopifyAuth_1 = require("./shopifyAuth");
const shopifyProxy_1 = require("./shopifyProxy");
const supabase_1 = require("./supabase");
const logger_1 = require("../shared/logger");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "2mb" }));
// --- CORS: permitir storefronts de Shopify (múltiples orígenes) ---
app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    const allowed = config_1.config.corsAllowedOrigins;
    const isAllowed = typeof requestOrigin === "string" &&
        (allowed.includes("*") || allowed.includes(requestOrigin));
    if (isAllowed && requestOrigin) {
        res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    next();
});
// --- Rate limit in-memory por shop (MVP) ---
const rateLimitByShop = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
function checkRateLimit(shop) {
    const now = Date.now();
    let entry = rateLimitByShop.get(shop);
    if (!entry) {
        rateLimitByShop.set(shop, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    if (now >= entry.resetAt) {
        entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
        rateLimitByShop.set(shop, entry);
        return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT_MAX;
}
// --- Rate limit por IP: 6 por minuto ---
const rateLimitByIp = new Map();
const RATE_LIMIT_IP_MAX = 6;
function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
        const first = forwarded.split(",")[0]?.trim();
        if (first)
            return first;
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
}
function checkRateLimitByIp(req) {
    const ip = getClientIp(req);
    const now = Date.now();
    let entry = rateLimitByIp.get(ip);
    if (!entry) {
        rateLimitByIp.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    if (now >= entry.resetAt) {
        entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
        rateLimitByIp.set(ip, entry);
        return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT_IP_MAX;
}
// --- Multer: solo campo "image", validar tipo y tamaño ---
const maxBytes = (0, config_1.getMaxFileBytes)();
const multerUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
        if (!config_1.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            cb(new Error("INVALID_IMAGE_TYPE"));
            return;
        }
        cb(null, true);
    }
});
// --- Logging ---
app.use((req, res, next) => {
    (0, logger_1.logInfo)("Request", { method: req.method, path: req.path, url: req.url });
    next();
});
app.get("/health", (_req, res) => {
    res.status(200).send("ok");
});
// Raíz (application_url): responde 200 para que al abrir el link no se vea NOT_FOUND
app.get("/", (_req, res) => {
    res.status(200).json({
        ok: true,
        message: "Tryon backend",
        endpoints: ["/health", "/api/data", "/api/size", "/tryon", "/auth", "/auth/callback", "/proxy", "/shopify/proxy"]
    });
});
// --- Endpoint público: GET /api/data (consultas Supabase, sin auth) ---
app.get("/api/data", async (req, res) => {
    const table = typeof req.query.table === "string" ? req.query.table.trim() : undefined;
    try {
        const result = await (0, supabase_1.queryTable)(table);
        if (result.error) {
            if (result.error.message.includes("not configured")) {
                return res.status(503).json({ error: "SERVICE_UNAVAILABLE", message: result.error.message });
            }
            return res.status(400).json({ error: "QUERY_ERROR", message: result.error.message, code: result.error.code });
        }
        res.status(200).json({ data: result.data });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (0, logger_1.logError)("api/data failed", { error: message });
        res.status(500).json({ error: "INTERNAL_ERROR", message });
    }
});
// --- Endpoint público: POST /api/size (recomendación de talla vía Supabase RPC, sin auth) ---
// Body: { shop, size_guide_id, measurement_type?, waist, hips, chest? | pecho? }
app.post("/api/size", async (req, res) => {
    try {
        const body = req.body;
        const shop = typeof body?.shop === "string" ? body.shop.trim() : "";
        const sizeGuideIdRaw = body?.size_guide_id != null ? String(body.size_guide_id) : "";
        const waist = typeof body?.waist === "number" ? body.waist : Number(body?.waist);
        const hips = typeof body?.hips === "number" ? body.hips : Number(body?.hips);
        const chestRaw = body?.chest ?? body?.pecho;
        const chest = typeof chestRaw === "number" ? chestRaw : Number(chestRaw);
        // pecho opcional: para measurement_type 'inferior' puede no enviarse (se usa 0)
        const pecho = Number.isFinite(chest) ? chest : 0;
        const guideId = sizeGuideIdRaw ? parseInt(sizeGuideIdRaw, 10) : NaN;
        if (!Number.isFinite(guideId) || guideId < 1) {
            return res.status(400).json({ error: "INVALID_INPUT", message: "size_guide_id is required and must be a positive integer" });
        }
        if (!Number.isFinite(waist) || !Number.isFinite(hips)) {
            return res.status(400).json({ error: "INVALID_INPUT", message: "waist and hips must be numbers" });
        }
        const result = await (0, supabase_1.getSizeRecommendation)({
            guideId,
            pecho,
            cintura: waist,
            cadera: hips,
        });
        if (result.error) {
            if (result.error.message.includes("not configured")) {
                return res.status(503).json({ error: "SERVICE_UNAVAILABLE", message: result.error.message });
            }
            return res.status(400).json({ error: "SIZE_QUERY_ERROR", message: result.error.message, code: result.error.code });
        }
        if (!result.data) {
            return res.status(404).json({
                error: "NO_SIZE_MATCH",
                message: "No size found for the given measurements in this guide",
            });
        }
        res.status(200).json({
            shop: shop || undefined,
            size_guide_id: guideId,
            recommended_size: result.data.talla,
            based_on: result.data.basado_en,
            value_used: result.data.valor_usado,
            min_value: result.data.min_value,
            max_value: result.data.max_value,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (0, logger_1.logError)("api/size failed", { error: message });
        res.status(500).json({ error: "INTERNAL_ERROR", message });
    }
});
// --- Shopify OAuth (instalación) y App Proxy ---
if (config_1.config.shopifyEnabled) {
    // GET /auth?shop=xxx.myshopify.com → redirect a Shopify OAuth
    app.get("/auth", (req, res) => {
        const shop = typeof req.query.shop === "string" ? req.query.shop.trim() : "";
        if (!shop) {
            (0, logger_1.logError)("shopify auth missing shop", {});
            return res.status(400).send("Missing query parameter: shop");
        }
        const url = (0, shopifyAuth_1.getOAuthRedirectUrl)(shop);
        return res.redirect(302, url);
    });
    // GET /auth/callback?code=...&shop=...&state=... → intercambiar code por token, guardar sesión, redirect
    app.get("/auth/callback", async (req, res) => {
        const code = typeof req.query.code === "string" ? req.query.code : "";
        const shop = typeof req.query.shop === "string" ? req.query.shop.trim() : "";
        const state = typeof req.query.state === "string" ? req.query.state : "";
        if (!code || !shop || !state) {
            (0, logger_1.logError)("shopify auth callback missing params", { hasCode: !!code, hasShop: !!shop, hasState: !!state });
            return res.status(400).send("Missing code, shop or state");
        }
        const verifiedShop = (0, shopifyAuth_1.verifyState)(state);
        if (verifiedShop !== shop) {
            (0, logger_1.logError)("shopify auth callback invalid state", { shop });
            return res.status(400).send("Invalid state");
        }
        try {
            await (0, shopifyAuth_1.exchangeCodeForToken)(shop, code);
            const redirectUrl = config_1.config.shopifyAppUrl || `https://${shop}/admin`;
            return res.redirect(302, redirectUrl);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            (0, logger_1.logError)("shopify auth callback failed", { shop, error: message });
            return res.status(500).send(`OAuth failed: ${message}`);
        }
    });
    // App Proxy: GET y POST (validación HMAC). /proxy y /shopify/proxy (y subrutas)
    const handleProxy = (req, res) => {
        const query = req.query;
        const hasSignature = typeof query.signature === "string" && query.signature.length > 0;
        if (hasSignature) {
            if (!(0, shopifyProxy_1.validateProxySignature)(query)) {
                (0, logger_1.logError)("shopify proxy invalid signature", { shop: (0, shopifyProxy_1.getProxyShop)(query) });
                res.status(401).send("Invalid signature");
                return;
            }
            const shop = (0, shopifyProxy_1.getProxyShop)(query);
            const pathPrefix = query.path_prefix;
            const path = query.path;
            (0, logger_1.logInfo)("shopify proxy", { shop, path_prefix: pathPrefix, path });
            res.setHeader("Content-Type", "application/json");
            res.status(200).json({
                ok: true,
                shop,
                path_prefix: pathPrefix,
                path,
                message: "App Proxy OK (sin UI)"
            });
            return;
        }
        // Sin firma: petición directa (ej. /shopify/proxy/ping) — responde 200 para health-check
        const subpath = (req.path || "").replace(/^\/shopify\/proxy\/?/, "") || "";
        (0, logger_1.logInfo)("shopify proxy direct", { path: req.path, url: req.url, subpath });
        res.setHeader("Content-Type", "application/json");
        res.status(200).json({ ok: true, ping: true, subpath: subpath || undefined });
    };
    app.get("/proxy", (req, res) => handleProxy(req, res));
    app.post("/proxy", (req, res) => handleProxy(req, res));
    // Multer para cualquier POST bajo /shopify/proxy (incluye /shopify/proxy/tryon)
    app.use("/shopify/proxy", (req, res, next) => {
        if (req.method !== "POST")
            return next();
        multerUpload.single("image")(req, res, (err) => {
            if (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg === "INVALID_IMAGE_TYPE") {
                    res.status(400).json({ error: msg });
                    return;
                }
                if (msg.includes("File too large") || msg.includes("LIMIT_FILE_SIZE")) {
                    res.status(400).json({ error: "FILE_TOO_LARGE" });
                    return;
                }
                next();
                return;
            }
            next();
        });
    });
    // Handler: POST exige firma válida (401 si falta o inválida). GET sin firma = ping (200).
    app.use("/shopify/proxy", async (req, res) => {
        const query = req.query;
        const hasSignature = typeof query.signature === "string" && query.signature.length > 0;
        if (req.method === "POST") {
            if (!hasSignature) {
                (0, logger_1.logError)("shopify proxy POST without signature", { path: req.path });
                res.status(401).json({ error: "UNAUTHORIZED", message: "Valid proxy signature required" });
                return;
            }
            if (!(0, shopifyProxy_1.validateProxySignature)(query)) {
                (0, logger_1.logError)("shopify proxy invalid signature", { shop: (0, shopifyProxy_1.getProxyShop)(query), path: req.path });
                res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid signature" });
                return;
            }
            const pathFromUrl = (req.path || "").replace(/^\/shopify\/proxy\/?/, "");
            const pathFromQuery = typeof query.path === "string" ? query.path : "";
            const pathPrefix = typeof query.path_prefix === "string" ? query.path_prefix : "";
            const isTryon = pathFromUrl.includes("tryon") || pathFromQuery.includes("tryon") || pathPrefix.includes("tryon");
            if (isTryon) {
                const shop = (0, shopifyProxy_1.getProxyShop)(query);
                if (!shop) {
                    res.status(400).json({ error: "MISSING_SHOP" });
                    return;
                }
                (0, logger_1.logInfo)("shopify proxy tryon", { shop, path: req.path, pathFromUrl, hasFile: Boolean(req.file) });
                await runTryonHandler(req, res, shop);
                return;
            }
            const shop = (0, shopifyProxy_1.getProxyShop)(query);
            const pathPrefixVal = query.path_prefix;
            const pathVal = query.path;
            res.setHeader("Content-Type", "application/json");
            res.status(200).json({
                ok: true,
                shop,
                path_prefix: pathPrefixVal,
                path: pathVal,
                message: "App Proxy OK"
            });
            return;
        }
        handleProxy(req, res);
    });
}
// --- Validación HMAC para endpoints reales (obligatorio cuando Shopify está configurado) ---
function requireValidProxyHmac(req, res, next) {
    if (!config_1.config.shopifyEnabled) {
        next();
        return;
    }
    const query = req.query;
    const hasSignature = typeof query.signature === "string" && query.signature.length > 0;
    if (!hasSignature) {
        (0, logger_1.logError)("tryon missing proxy signature", { path: req.path });
        res.status(401).json({ error: "UNAUTHORIZED", message: "Valid proxy signature required" });
        return;
    }
    if (!(0, shopifyProxy_1.validateProxySignature)(query)) {
        (0, logger_1.logError)("tryon invalid proxy signature", { path: req.path, shop: (0, shopifyProxy_1.getProxyShop)(query) });
        res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid signature" });
        return;
    }
    const trustedShop = (0, shopifyProxy_1.getProxyShop)(query);
    res.locals.trustedShop = trustedShop ?? null;
    next();
}
/** Lógica tryon compartida (shop debe venir de firma válida). */
async function runTryonHandler(req, res, shop) {
    const variantId = typeof req.body?.variantId === "string" ? req.body.variantId.trim() : "";
    if (!shop || !variantId) {
        (0, logger_1.logError)("tryon missing fields", { shop: !!shop, variantId: !!variantId });
        res.status(400).json({ error: "MISSING_FIELDS", message: "shop and variantId are required" });
        return;
    }
    if (!checkRateLimitByIp(req)) {
        (0, logger_1.logError)("tryon rate limit by IP", { ip: getClientIp(req), shop });
        res.status(429).json({ error: "RATE_LIMIT_EXCEEDED", message: "Max 6 requests per minute per IP" });
        return;
    }
    if (!checkRateLimit(shop)) {
        (0, logger_1.logError)("tryon rate limit by shop", { shop });
        res.status(429).json({ error: "RATE_LIMIT_EXCEEDED", message: "Max 30 requests per minute per shop" });
        return;
    }
    const file = req.file;
    if (!file || !file.buffer) {
        (0, logger_1.logError)("tryon missing image", {});
        res.status(400).json({ error: "MISSING_IMAGE", message: "image file is required" });
        return;
    }
    if (file.size > maxBytes) {
        res.status(400).json({ error: "FILE_TOO_LARGE", message: `Max ${config_1.config.maxFileMb}MB` });
        return;
    }
    (0, logger_1.logInfo)("tryon start", { shop, variantId, tryonLogic: config_1.config.tryonLogic });
    try {
        let productImageUrl;
        let referencia;
        let sku3;
        try {
            const data = await (0, bigquery_1.getProductImageData)(variantId);
            productImageUrl = data.productImageUrl;
            referencia = data.referencia;
            sku3 = data.sku3;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === bigquery_1.PRODUCT_IMAGE_NOT_FOUND) {
                res.status(404).json({ error: bigquery_1.PRODUCT_IMAGE_NOT_FOUND });
                return;
            }
            throw err;
        }
        if (config_1.config.driveFolderId) {
            try {
                const ext = config_1.ALLOWED_IMAGE_EXTENSIONS[file.mimetype] ?? ".jpg";
                const driveFilename = `${sku3 || variantId}&${Date.now()}${ext}`;
                await (0, drive_1.uploadUserPhotoToDrive)(file.buffer, file.mimetype || "image/jpeg", driveFilename);
            }
            catch (driveErr) {
                const msg = driveErr instanceof Error ? driveErr.message : String(driveErr);
                (0, logger_1.logError)("drive upload failed, continuing tryon", { shop, variantId, error: msg });
            }
        }
        const userImageBase64 = file.buffer.toString("base64");
        const userImageMimeType = file.mimetype || "image/jpeg";
        let imageBase64;
        if (config_1.config.tryonLogic === "fashn") {
            imageBase64 = await (0, fashn_1.runFashnTryon)({
                productImageUrl,
                modelImageBase64: userImageBase64,
                modelImageMimeType: userImageMimeType,
                prompt: referencia ? referencia.trim() : undefined
            });
        }
        else {
            imageBase64 = await (0, gemini_1.runGeminiTryon)({
                userImageBase64,
                userImageMimeType,
                productImageUrl,
                referencia
            });
        }
        (0, logger_1.logInfo)("tryon response", {
            shop,
            variantId,
            imageBase64Length: imageBase64.length,
            imageBase64Preview: imageBase64.substring(0, 100)
        });
        res.status(200).json({ imageBase64 });
        return;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (0, logger_1.logError)("tryon failed", { shop, variantId, error: message });
        res.status(500).json({ error: "TRYON_FAILED", message });
        return;
    }
}
// --- POST /tryon (síncrono: BigQuery + Gemini/FASHN). Requiere firma HMAC válida cuando Shopify está configurado. ---
app.post("/tryon", (req, res, next) => {
    multerUpload.single("image")(req, res, (err) => {
        if (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "INVALID_IMAGE_TYPE")
                return res.status(400).json({ error: msg, message: "Only image/jpeg, image/png, image/webp allowed" });
            if (msg.includes("File too large") || msg.includes("LIMIT_FILE_SIZE"))
                return res.status(400).json({ error: "FILE_TOO_LARGE", message: `Max ${config_1.config.maxFileMb}MB` });
            (0, logger_1.logError)("tryon multer error", { error: msg });
            return res.status(400).json({ error: "UPLOAD_ERROR", message: msg });
        }
        next();
    });
}, requireValidProxyHmac, async (req, res) => {
    const shop = res.locals?.trustedShop ??
        (typeof req.body?.shop === "string" ? req.body.shop.trim() : "");
    await runTryonHandler(req, res, shop);
});
// 404
app.use((req, res) => {
    (0, logger_1.logError)("Route not found", { method: req.method, path: req.path });
    res.status(404).json({ error: "NOT_FOUND", path: req.path });
});
const port = config_1.config.port;
app.listen(port, "0.0.0.0", () => {
    console.log(`Tryon server listening on http://0.0.0.0:${port}`);
});
