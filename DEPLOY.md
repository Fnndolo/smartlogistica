# Despliegue en Railway

Todo va en Railway, en **el mismo proyecto** donde ya tienes Postgres y Redis.
Vas a crear **2 servicios nuevos** desde el mismo repo de GitHub:

- **`api`** — NestJS (HTTP + workers de BullMQ en el mismo proceso).
- **`web`** — Next.js (modo producción, rápido).

El navegador solo habla con el **web**; este reenvía `/v1/*` al **api** por dentro
(proxy configurado en `apps/web/next.config.ts`). Así la sesión funciona sin dominio
propio y sin líos de CORS.

---

## Paso 0 — Subir a GitHub

Ya dejé el repo inicializado y con un commit. Solo falta crear el repo remoto y subirlo:

```bash
# En GitHub: crea un repo VACÍO (sin README), por ejemplo "smartlogistica".
git remote add origin https://github.com/TU_USUARIO/smartlogistica.git
git branch -M main
git push -u origin main
```

> Los secretos (`.env.local`) están en `.gitignore` y **no** se suben. Verifícalo con
> `git status` antes de push: no debe aparecer ningún `.env.local`.

---

## Paso 1 — Servicio `api`

1. En tu proyecto de Railway: **New → GitHub Repo →** elige el repo.
2. En el servicio, **Settings**:
   - **Root Directory**: **déjalo VACÍO** (es la raíz del repo — así funciona el workspace de
     pnpm y se ve `packages/shared`). ⚠️ NO pongas aquí `apps/api` ni `apps/api/railway.json`.
   - **Build → Custom Build Command** (pégalo tal cual):
     ```
     pnpm install --frozen-lockfile && pnpm --filter @smartlogistica/shared build && pnpm --filter @smartlogistica/api db:generate && pnpm --filter @smartlogistica/api build
     ```
   - **Deploy → Custom Start Command** (pégalo tal cual):
     ```
     pnpm --filter @smartlogistica/api db:migrate:deploy && node apps/api/dist/main.js
     ```
3. **Variables** → pega TODO lo que tienes en `apps/api/.env.local`, con estos cambios
   para producción:

   | Variable | Valor en producción |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | **no la pongas** (Railway la asigna sola) |
   | `WEB_ORIGIN` | la URL pública del `web` (la generas en el Paso 2) |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_SAMESITE` | `lax` |
   | `COOKIE_DOMAIN` | **bórrala / déjala vacía** |
   | `PUBLIC_WEBHOOK_BASE_URL` | la URL pública del `api` (Paso 1.4) |

   Las demás se copian igual de tu `.env.local` (ya apuntan a tu Postgres/Redis de Railway):
   `CONTROL_PLANE_DATABASE_URL`, `TENANT_DB_HOST`, `TENANT_DB_ADMIN_URL`,
   `TENANT_DB_MASTER_PASSWORD`, `TENANT_DB_SSLMODE`, `REDIS_URL`, `KEK_V1`,
   `CURRENT_KEK_VERSION`, `SESSION_SECRET`, `CATALOG_DB_URL`, `COORDINADORA_GUIAS_URL`,
   `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
   `STORAGE_SECRET_ACCESS_KEY`, `REALTIME_RECONCILE_MS`, `SHIPPING_REFRESH_MS`, `LOG_LEVEL=info`.

4. **Settings → Networking → Generate Domain**. Copia la URL (ej. `https://api-production-xxxx.up.railway.app`).
   Úsala para `PUBLIC_WEBHOOK_BASE_URL` (en este mismo servicio) y para `API_INTERNAL_URL` (Paso 2).

---

## Paso 2 — Servicio `web`

1. En el mismo proyecto: **New → GitHub Repo →** el **mismo** repo (Railway permite varios servicios del mismo repo).
2. **Settings**:
   - **Root Directory**: **déjalo VACÍO** (igual que el api).
   - **Build → Custom Build Command**:
     ```
     pnpm install --frozen-lockfile && pnpm --filter @smartlogistica/shared build && pnpm --filter @smartlogistica/web build
     ```
   - **Deploy → Custom Start Command**:
     ```
     pnpm --filter @smartlogistica/web exec next start -p $PORT
     ```
3. **Variables**:

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `API_INTERNAL_URL` | la URL pública del `api` (Paso 1.4), ej. `https://api-production-xxxx.up.railway.app` |
   | `SESSION_COOKIE_NAME` | `smartlog_session` (opcional, ya es el default) |

   > **NO pongas `NEXT_PUBLIC_API_URL`** — dejarla vacía es lo que activa el proxy mismo-origen.
   > `API_INTERNAL_URL` se "hornea" en el build, así que si la cambias hay que redeployar.

4. **Generate Domain**. Esa es la URL con la que entras a la app.

---

## Paso 3 — Cerrar el círculo

1. Vuelve al servicio **`api`** → Variables → pon `WEB_ORIGIN` = la URL del `web` (Paso 2.4). Redeploy.
2. Listo. Entra a la URL del `web`, inicia sesión y prueba.
3. **Instalar como app en el celular**: abre la URL en Chrome (Android) → menú → "Instalar app" /
   "Añadir a pantalla de inicio". En iPhone (Safari): Compartir → "Añadir a inicio".

---

## Notas / gotchas

- **Migraciones**: el `api` corre `prisma migrate deploy` del control-plane al arrancar
  (seguro: tu base ya tiene el historial aplicado). Los cambios de schema de los tenants
  se siguen aplicando con los scripts `apps/api/scripts/migrate-*.mjs` (contra la base de Railway).
- **Webhooks de VTEX**: al arrancar, el `api` registra los webhooks usando
  `PUBLIC_WEBHOOK_BASE_URL`. Debe ser la URL pública del `api`, si no VTEX no puede notificar.
- **Tiempo real (SSE)**: pasa por el proxy del web. Si alguna vez se siente con retraso,
  igual hay respaldo por polling; no se pierde nada.
- **Optimización futura (opcional)**: para que el web hable con el api por la red privada de
  Railway (más rápido, sin salir a internet), cambia `API_INTERNAL_URL` a
  `http://${api-service}.railway.internal:${PORT_DEL_API}` y redeploya el web. Con la URL
  pública también funciona; esto es solo velocidad.
- **Dominio propio (cuando quieras)**: agrégalo al servicio `web` en Railway (Settings →
  Domains). No requiere cambios de código gracias al proxy.
