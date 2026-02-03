# Size Guide Backend (Try-on + Supabase)

Backend en **Express + TypeScript** para:

- **Try-on virtual** en Shopify: recibe imagen del usuario + variante, obtiene imagen de producto desde BigQuery y genera la imagen resultado con **Gemini** o **FASHN**.
- **Recomendación de talla**: endpoint público que consulta **Supabase** (RPC) para devolver la talla según medidas (pecho, cintura, cadera).
- **Shopify App**: OAuth (instalación), sesión en memoria y App Proxy con validación HMAC.

Pensado para ejecución en **Google Cloud Run** (puerto configurable por env, por defecto 8080).

## Cómo funciona

- **Build**: `npm run build` compila TypeScript (`src/`, `shared/`) a `dist/`.
- **Arranque**: `node dist/src/index.js` (o `npm run start`). El servidor escucha en `0.0.0.0:PORT`.
- **Docker**: el Dockerfile hace `npm ci` → copia código → `npm run build` → `CMD ["npm", "run", "start"]`. No hay multi-stage; la imagen final incluye fuente y `node_modules`.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Healthcheck (200 ok). |
| GET | `/` | Info del servicio y lista de endpoints (JSON). |
| GET | `/api/data` | Consulta Supabase: `?table=nombre` (opcional). Devuelve filas de la tabla. Requiere Supabase configurado. |
| POST | `/api/size` | **Recomendación de talla**. Body JSON: `shop`, `size_guide_id`, `waist`, `hips`, `chest` o `pecho` (opcional). Ejecuta RPC `get_size_recommendation` en Supabase y devuelve `recommended_size`, `based_on`, etc. Público (sin auth). |
| POST | `/tryon` | Try-on virtual: multipart `image` + `variantId` (y `shop` si no hay firma). Requiere firma HMAC de App Proxy cuando Shopify está configurado. Responde con `{ imageBase64 }`. |
| GET | `/auth?shop=...` | Inicia OAuth de la app Shopify (solo si Shopify configurado). |
| GET | `/auth/callback` | Callback OAuth (solo si Shopify configurado). |
| GET/POST | `/proxy` | App Proxy (HMAC); solo si Shopify configurado. |
| GET/POST | `/shopify/proxy` | App Proxy bajo `/shopify/proxy` (incluye POST para tryon con firma). |

## Configuración (variables de entorno)

No se carga `.env` en código; las variables se inyectan por entorno (Docker, Cloud Run, etc.).

### Comunes

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8080` | Puerto del servidor. |
| `MAX_FILE_MB` | `10` | Tamaño máximo de imagen (MB) para tryon. |
| `CORS_ALLOWED_ORIGINS` | Ver abajo | Orígenes permitidos (CORS), separados por coma. Por defecto: `https://js-tryon.myshopify.com,https://juliana-sanchez-ecommerce.myshopify.com`. |

### Try-on (BigQuery + Gemini o FASHN)

| Variable | Descripción |
|----------|-------------|
| `BIGQUERY_PROJECT` | Proyecto de BigQuery para la consulta de imagen de producto. |
| `TRYON_LOGIC` | `gemini` o `fashn`. |
| `GEMINI_API_KEY` | API key de Google AI (Gemini). Necesaria si `TRYON_LOGIC=gemini`. |
| `GEMINI_TRYON_MODEL` | Modelo Gemini (default: `gemini-3-pro-image-preview`). |
| `FASHN_BASE_URL` | Base URL de FASHN API (default: `https://api.fashn.ai`). |
| `FASHN_API_KEY` | API key de FASHN. Necesaria si `TRYON_LOGIC=fashn`. |
| `GOOGLE_DRIVE_UPLOAD_FOLDER_ID` o `DRIVE_FOLDER_ID` | Opcional. Si está definido, se sube la foto del usuario a esa carpeta de Drive. |

### Supabase (para `/api/data` y `/api/size`)

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` | URL del proyecto Supabase (sin barra final). |
| `SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY` | Key de Supabase (anon o service_role). |
| `SUPABASE_DEFAULT_TABLE` | Tabla por defecto para `GET /api/data` (default: `items`). |

Para que **POST /api/size** funcione, en Supabase debe existir la función `public.get_size_recommendation(p_guide_id, p_pecho, p_cintura, p_cadera)`. Crearla ejecutando el script en **Supabase → SQL Editor**: archivo `supabase/get_size_recommendation.sql` de este repo.

### Shopify (OAuth + App Proxy)

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_API_KEY_APP` | API key de la app (Partner Dashboard). |
| `SHOPIFY_API_SECRET_APP` | API secret. |
| `SHOPIFY_APP_URL` | URL pública de la app (ej. URL de Cloud Run), sin barra final. |
| `SCOPES` | Scopes OAuth (default: `read_products`). |
| `DATABASE_URL` | Opcional; sesiones están en memoria. |

Si no se configuran estas variables, no se registran las rutas `/auth`, `/auth/callback`, `/proxy` ni `/shopify/proxy`.

## Estructura del repo

- **`src/index.ts`** — Entrada del servidor Express: middlewares (JSON, CORS, rate limit, multer), rutas y `app.listen(port, "0.0.0.0")`.
- **`src/config.ts`** — Lectura de variables de entorno (`getEnv` desde `shared/env.ts`).
- **`src/bigquery.ts`** — Consulta de imagen de producto por variante (`getProductImageData`).
- **`src/gemini.ts`** — Try-on con Gemini.
- **`src/fashn.ts`** — Try-on con FASHN.
- **`src/drive.ts`** — Subida de fotos a Google Drive (opcional).
- **`src/supabase.ts`** — Cliente Supabase y funciones `queryTable`, `getSizeRecommendation` (RPC).
- **`src/shopifyAuth.ts`** — OAuth: URL de redirección, state, intercambio code → token.
- **`src/shopifyProxy.ts`** — Validación HMAC del App Proxy.
- **`src/sessionStore.ts`** — Sesiones en memoria (shop → accessToken).
- **`shared/`** — Utilidades: `env.ts`, `logger.ts`, `csv.ts`, `httpClient.ts`.
- **`supabase/get_size_recommendation.sql`** — Script para crear la función RPC en Supabase.

## Desarrollo y producción

```bash
npm install
npm run dev    # tsx watch src/index.ts (desarrollo)
npm run build  # tsc → dist/
npm run start  # node dist/src/index.js (producción)
```

En Docker (y Cloud Run) el flujo es: instalar deps → copiar código → `npm run build` → `CMD ["npm", "run", "start"]`. El puerto expuesto es 8080 (configurable con `PORT`).

## CORS

El middleware CORS permite los orígenes definidos en `CORS_ALLOWED_ORIGINS`. Para peticiones desde el storefront de Shopify (p. ej. `https://js-tryon.myshopify.com`) a `/api/size`, ese origen debe estar en la lista (ya viene por defecto). Las peticiones OPTIONS (preflight) responden con las cabeceras necesarias (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers`, etc.).

## Seguridad (Shopify)

- OAuth: `state` aleatorio con TTL; solo se intercambia el code si el state coincide.
- App Proxy: validación HMAC-SHA256 sobre los query params que envía Shopify.
- Tryon: cuando Shopify está configurado, `POST /tryon` exige firma HMAC válida en los query params.
