import { getEnv } from "../shared/env";

const DEFAULT_CORS_ORIGINS = "https://js-tryon.myshopify.com,https://juliana-sanchez-ecommerce.myshopify.com";

function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Shopify app: obligatorios si usas OAuth / App Proxy. */
const shopifyApiKey = getEnv("SHOPIFY_API_KEY_APP", "");
const shopifyApiSecret = getEnv("SHOPIFY_API_SECRET_APP", "");
const shopifyAppUrl = getEnv("SHOPIFY_APP_URL", "");

export const config = {
  port: Number(getEnv("PORT", "8080")),
  maxFileMb: Number(getEnv("MAX_FILE_MB", "10")),
  bigqueryProject: getEnv("BIGQUERY_PROJECT", ""),
  /** Lista de orígenes permitidos (CORS). Env: CORS_ALLOWED_ORIGINS separados por coma. */
  corsAllowedOrigins: parseCorsOrigins(getEnv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS)),
  // Shopify app (OAuth + App Proxy)
  shopifyApiKey,
  shopifyApiSecret,
  shopifyScopes: getEnv("SCOPES", "read_products"),
  shopifyAppUrl: shopifyAppUrl.replace(/\/$/, ""),
  databaseUrl: getEnv("DATABASE_URL", ""),
  /** true si OAuth/Proxy están configurados */
  shopifyEnabled: Boolean(shopifyApiKey && shopifyApiSecret && shopifyAppUrl),
  /** Lógica tryon: "gemini" = Gemini; "fashn" = FASHN Try-On Max */
  tryonLogic: getEnv("TRYON_LOGIC", "gemini") as "gemini" | "fashn",
  /** Modelo Gemini para virtual try-on (ej. gemini-3-pro-image-preview) */
  geminiTryonModel: getEnv("GEMINI_TRYON_MODEL", "gemini-3-pro-image-preview"),
  /** API key de Google AI (Gemini). Env: GEMINI_API_KEY */
  geminiApiKey: getEnv("GEMINI_API_KEY", ""),
  /** Base URL de FASHN API. Env: FASHN_BASE_URL */
  fashnBaseUrl: getEnv("FASHN_BASE_URL", "https://api.fashn.ai").replace(/\/$/, ""),
  /** API key de FASHN. Env: FASHN_API_KEY */
  fashnApiKey: getEnv("FASHN_API_KEY", ""),
  /** ID de carpeta de Google Drive donde guardar fotos del usuario. Env: GOOGLE_DRIVE_UPLOAD_FOLDER_ID (o DRIVE_FOLDER_ID). Si está vacío no se sube. */
  driveFolderId: getEnv("GOOGLE_DRIVE_UPLOAD_FOLDER_ID", "") || getEnv("DRIVE_FOLDER_ID", ""),
};

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function getMaxFileBytes(): number {
  return config.maxFileMb * 1024 * 1024;
}
