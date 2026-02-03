/**
 * Almacén de sesiones OAuth por shop (in-memory).
 * Para producción con múltiples instancias usar DATABASE_URL + Prisma u otro store persistente.
 */
export interface ShopifySession {
  shop: string;
  accessToken: string;
  scope: string;
  createdAt: number;
}

const sessions = new Map<string, ShopifySession>();

export function setSession(shop: string, data: Omit<ShopifySession, "shop" | "createdAt">): void {
  sessions.set(shop, {
    shop,
    ...data,
    createdAt: Date.now()
  });
}

export function getSession(shop: string): ShopifySession | null {
  return sessions.get(shop) ?? null;
}

export function hasSession(shop: string): boolean {
  return sessions.has(shop);
}
