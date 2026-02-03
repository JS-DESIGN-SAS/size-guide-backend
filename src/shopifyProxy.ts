import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { logInfo, logError } from "../shared/logger";

/**
 * Valida la firma HMAC de una petición App Proxy de Shopify.
 * Parámetros (excepto signature) ordenados por clave, concatenados como key=value sin separador.
 * HMAC-SHA256 con API secret, comparación hexadecimal (timing-safe).
 */
export function validateProxySignature(query: Record<string, string | string[] | undefined>): boolean {
  const signature = query.signature;
  if (typeof signature !== "string" || !signature) return false;
  const secret = config.shopifyApiSecret;
  if (!secret) return false;

  const rest: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === "signature") continue;
    const val = Array.isArray(v) ? v.join(",") : (v ?? "");
    rest[k] = String(val);
  }
  const sortedKeys = Object.keys(rest).sort();
  const message = sortedKeys.map((k) => `${k}=${rest[k]}`).join("");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Parámetros típicos que Shopify añade al proxy (shop, path_prefix, timestamp, signature, logged_in_customer_id). */
export function getProxyShop(query: Record<string, string | string[] | undefined>): string | null {
  const shop = query.shop;
  if (typeof shop !== "string" || !shop) return null;
  return shop;
}
