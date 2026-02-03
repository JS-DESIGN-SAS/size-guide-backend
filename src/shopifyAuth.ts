import { randomBytes } from "node:crypto";
import { createHmac } from "node:crypto";
import { config } from "./config";
import { setSession } from "./sessionStore";
import { logInfo, logError } from "../shared/logger";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min
const stateToShop = new Map<string, { shop: string; createdAt: number }>();

function cleanupState(): void {
  const now = Date.now();
  for (const [state, data] of stateToShop.entries()) {
    if (now - data.createdAt > STATE_TTL_MS) stateToShop.delete(state);
  }
}

/** Genera la URL de autorización OAuth (redirect a Shopify). */
export function getOAuthRedirectUrl(shop: string): string {
  const state = randomBytes(16).toString("hex");
  stateToShop.set(state, { shop, createdAt: Date.now() });
  if (stateToShop.size > 1000) cleanupState();
  const redirectUri = `${config.shopifyAppUrl}/auth/callback`;
  const params = new URLSearchParams({
    client_id: config.shopifyApiKey,
    scope: config.shopifyScopes,
    redirect_uri: redirectUri,
    state
  });
  const url = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  logInfo("shopify auth redirect", { shop, redirectUri });
  return url;
}

/** Verifica state y devuelve el shop asociado, o null si inválido. */
export function verifyState(state: string): string | null {
  const data = stateToShop.get(state);
  if (!data) return null;
  if (Date.now() - data.createdAt > STATE_TTL_MS) {
    stateToShop.delete(state);
    return null;
  }
  stateToShop.delete(state);
  return data.shop;
}

/** Intercambia code por access_token y guarda sesión. */
export async function exchangeCodeForToken(shop: string, code: string): Promise<void> {
  const url = `https://${shop}/admin/oauth/access_token`;
  const body = JSON.stringify({
    client_id: config.shopifyApiKey,
    client_secret: config.shopifyApiSecret,
    code
  });
  logInfo("shopify exchange token", { shop, url: url.replace(/[?&].*/, "") });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    logError("shopify exchange token failed", { shop, status: res.status, body: text });
    throw new Error(`OAuth token exchange failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string; scope: string };
  setSession(shop, {
    accessToken: data.access_token,
    scope: data.scope ?? config.shopifyScopes
  });
  logInfo("shopify session saved", { shop });
}
