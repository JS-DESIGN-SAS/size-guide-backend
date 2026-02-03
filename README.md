# Pipelines

Este repo contiene **integrations (jobs)** para automatizar procesos con **Shopify** y **BigQuery**, y un **backend Try-on** para Shopify (widget virtual try-on). La estructura actual está enfocada en integraciones Shopify y el servicio Try-on en Cloud Run.

La ejecución está pensada para producción en **Google Cloud Run**, disparada por **Cloud Scheduler** con triggers tipo **cron**, y con secretos gestionados en **Secret Manager**.

## Cómo funciona (proceso general)

- **Build/Deploy**: Se construye una imagen Docker que compila TypeScript y arranca un servidor HTTP (Express).
- **Ejecución**: Cloud Scheduler hace un `POST` al servicio de Cloud Run hacia un endpoint específico del job.
- **Extracción**: Cada job llama a su API origen (HTTP/GraphQL) con credenciales desde variables de entorno (inyectadas desde Secret Manager).
- **Transformación**: Se normalizan campos (fechas, ids, montos) y se preparan datos para BigQuery o para acciones directas en Shopify.
- **Carga a BigQuery**: Dependiendo del job, se ejecutan queries o cargas CSV.
- **Observabilidad**: Logs en JSON (`shared/logger.ts`) para trazabilidad (conteos, páginas, jobId de BigQuery).

## Arquitectura (alto nivel)

Componentes:

- **Cloud Scheduler (cron)** → llama por HTTP
- **Cloud Run (contenedor)** → expone API y ejecuta jobs
- **Secret Manager** → credenciales/API keys/tokens
- **BigQuery** → fuente/destino de datos

Flujo:

1) Scheduler dispara `POST /run/<jobName>` (ej. `shopify.inventory_update`).  
2) Cloud Run resuelve `jobName` en el registry (`src/registry.ts`).  
3) Se ejecuta `run()` del job correspondiente (`integrations/**/jobs/**/job.ts`).  
4) El job ejecuta la lógica correspondiente y devuelve un JSON con métricas y `jobId`.

## Endpoints y ejecución

El servidor expone:

- `GET /health`: healthcheck
- `POST /run/:jobName`: ejecuta un job registrado

Nombres de jobs soportados (ver `src/registry.ts`):

- Shopify:
  - `shopify.inventory_update`
  - `shopify.update_status`
  - `shopify.reorder_collections`
  - `shopify.publish_online_store`
  - `shopify.discount_metafield`

Ejemplo (local):

```bash
npm install
npm run dev

# en otra terminal:
curl -X POST "http://localhost:8080/run/shopify.inventory_update"
```

## Secretos y configuración

Los jobs leen configuración desde variables de entorno. En Cloud Run normalmente se inyectan así:

- **Secret Manager → Cloud Run env vars**: credenciales (tokens, API keys).
- **Env vars “no secret”**: dataset/tablas, límites, ventanas de fechas, concurrencia.

En el código se valida presencia de secretos críticos con `mustGetEnv(...)` (falla rápido si falta alguno).

## BigQuery: estrategias de uso

- **Queries**: lectura de datos para decisiones o acciones en Shopify.
- **CSV load**: `loadCsvToBigQuery(...)` hace `table.load()` con schema explícito.

## Operación en GCP (Cloud Scheduler → Cloud Run)

Recomendación típica (conceptual):

- Cloud Scheduler llama al URL de Cloud Run con `POST` al path `/run/<jobName>`.
- Se configura autenticación con **OIDC** usando un service account con `roles/run.invoker`.
- Cada job tiene su cron (frecuencia) y opcionalmente su ventana/parametrización vía env vars.

> Nota: este repo no contiene la IaC de Scheduler/Run; la configuración vive en GCP.

## Estructura del repo

- `src/server.ts`: servidor HTTP (Express) con `/run/:jobName`
- `src/registry.ts`: mapea `jobName` → función `run()` del job
- `integrations/shopify/jobs/<job>/job.ts`: lógica del job de Shopify
- `integrations/shopify/shared/bigquery.ts`: helpers para ejecutar queries y cargas CSV en BigQuery
- `integrations/shopify/shared/shopifyClient.ts`: cliente GraphQL de Shopify
- `shared/*`: utilidades comunes (env, logger, csv)

## Try-on backend (Cloud Run)

Servicio para el widget de virtual try-on en Shopify: recibe imagen del usuario + variante, procesa vía BigQuery + n8n y devuelve una imagen resultado.

### Variables de entorno (obligatorias para tryon)

| Variable | Descripción |
|----------|-------------|
| `GCS_BUCKET` | Bucket de Google Cloud Storage para inputs/outputs |
| `N8N_ENDPOINT_URL` | URL del endpoint n8n (recibe JSON, devuelve `resultBase64`) |
| `INTERNAL_TOKEN` | Token para proteger `POST /internal/process/:jobId` (header `x-internal-token`) |
| `BIGQUERY_PROJECT` o `GCLOUD_PROJECT` | Proyecto de BigQuery para el query de imagen de producto |

### Variables opcionales

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8080` | Puerto del servidor |
| `SIGNED_URL_TTL_HOURS` | `24` | TTL de las signed URLs de GCS (horas) |
| `MAX_FILE_MB` | `10` | Tamaño máximo de la imagen del usuario (MB) |
| `PROCESS_MODE` | `inline` | `inline` = procesar con setImmediate; `cloud-tasks` = encolar Cloud Tasks (TODO) |

### Endpoints

- `GET /health` — healthcheck
- `POST /tryon` — multipart: `image`, `variantId`, `shop` → responde `{ "jobId": "..." }`
- `GET /tryon/:jobId` — estado: `{ status }` o `{ status, resultUrl }` o `{ status, error }`
- `POST /internal/process/:jobId` — procesa el job (header `x-internal-token: <INTERNAL_TOKEN>`)

### Cómo correr local

1. Crear un `.env` o exportar las variables (incluyendo credenciales GCP si corres fuera de GCP):

```bash
export GCS_BUCKET=tu-bucket
export N8N_ENDPOINT_URL=https://tu-n8n.com/webhook/...
export INTERNAL_TOKEN=un-secreto-fuerte
export BIGQUERY_PROJECT=tu-proyecto-gcp
# Opcional: GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
```

2. Arrancar el servidor:

```bash
npm install
npm run build
npm run start
# o en desarrollo: npm run dev
```

3. Pruebas manuales:

```bash
# Crear job (devuelve jobId)
curl -F "image=@user.jpg" -F "variantId=42839123456789" -F "shop=js-tryon.myshopify.com" http://localhost:8080/tryon

# Polling del estado (hasta done con resultUrl o error)
curl http://localhost:8080/tryon/{jobId}
```

El flujo pasa por `queued` → `running` y termina en `done` (con `resultUrl` firmada) o `error` (con `error`).

### Estructura tryon

- `src/index.ts` — Express: `/tryon`, `/tryon/:jobId`, `/internal/process/:jobId`
- `src/config.ts` — env vars y validación
- `src/bigquery.ts` — `getProductImageUrl(variationId)` (query parametrizada)
- `src/storage.ts` — subida a GCS y signed URLs
- `src/jobs.ts` — Firestore CRUD (colección `tryon_jobs`)
- `src/n8n.ts` — llamada a n8n y parse de base64
- `src/processTryonJob.ts` — orquestación del procesamiento

---

## Shopify App (OAuth + App Proxy)

Flujo básico como app proxy: OAuth (instalación), sesión en memoria y endpoint proxy con validación HMAC. Sin UI; solo lo necesario para que la app funcione como proxy.

### Variables de entorno (para OAuth y App Proxy)

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_API_KEY_APP` | API key de la app (Partner Dashboard) |
| `SHOPIFY_API_SECRET_APP` | API secret de la app |
| `SCOPES` | Scopes OAuth (ej. `read_products,write_products`). Default: `read_products` |
| `SHOPIFY_APP_URL` | URL pública estable de la app (tu Cloud Run), sin barra final (ej. `https://tryon-backend-xxx.run.app`) |
| `DATABASE_URL` | Opcional; por ahora las sesiones se guardan en memoria. Para producción con varias instancias usar Prisma u otro store persistente. |

Si **no** configuras estas variables, las rutas `/auth`, `/auth/callback` y `/proxy` no se registran (el resto del servidor sigue funcionando).

### Endpoints (públicos pero protegidos)

- **GET /auth?shop=xxx.myshopify.com** — Inicia OAuth: redirige a Shopify para autorización. El merchant instala la app.
- **GET /auth/callback** — Callback OAuth: recibe `code`, `shop`, `state`; intercambia code por access token, guarda sesión en memoria y redirige a `SHOPIFY_APP_URL` (o admin de la tienda).
- **GET /proxy** y **POST /proxy** — App Proxy: validan firma HMAC (query params que envía Shopify). Si la firma es válida, responden con un JSON mínimo (`ok`, `shop`, `path_prefix`, `path`). Puedes sustituir esta respuesta por tu lógica (HTML, JSON, etc.).

### Seguridad

- OAuth: `state` aleatorio con TTL 10 min; solo se intercambia el code si el state coincide.
- App Proxy: HMAC-SHA256 sobre los query params (excepto `signature`), ordenados y concatenados; comparación timing-safe con el `signature` que envía Shopify.
- CORS: si solo usas App Proxy desde el storefront, las peticiones van por el dominio de la tienda; CORS no aplica. Para `/tryon` desde otro dominio (widget) se usan `CORS_ALLOWED_ORIGINS`.

### Configuración en Shopify Partner

1. **App URL**: `SHOPIFY_APP_URL` (ej. `https://tryon-backend-xxx.run.app`).
2. **Allowed redirection URL(s)**: `{SHOPIFY_APP_URL}/auth/callback`.
3. **App Proxy**: subpath y prefix que quieras (ej. `/apps/tryon`); URL del proxy: `{SHOPIFY_APP_URL}/proxy`.

### Estructura

- `src/shopifyAuth.ts` — URL OAuth, verificación de state, intercambio code → token.
- `src/shopifyProxy.ts` — Validación HMAC del proxy.
- `src/sessionStore.ts` — Sesiones en memoria (shop → accessToken, scope). Sustituible por Prisma/DATABASE_URL.

---

## Desarrollo

```bash
npm run dev        # tryon en modo watch (TypeScript)
npm run dev:server # pipelines (server.ts) en modo watch
npm run build      # compila a dist/
npm run start      # ejecuta tryon (dist/src/index.js)
npm run start:server # ejecuta pipelines (dist/src/server.js)
```