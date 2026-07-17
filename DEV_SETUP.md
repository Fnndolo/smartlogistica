# Setup de desarrollo

Guia para levantar SmartLogistica en local. Usamos **Railway** como hosting de Postgres y Redis (no Docker local).

## 1. Requisitos

| Herramienta | Version minima | Como verificar |
|---|---|---|
| Node.js | 20.18+ (probado en 24.x) | `node --version` |
| pnpm | 9.x | `pnpm --version` |
| Git | cualquiera reciente | `git --version` |
| Cuenta Railway | gratis | https://railway.app |

## 2. Crear el proyecto Railway

1. Entra a [railway.app](https://railway.app) y crea un proyecto nuevo: **SmartLogistica-staging**.
2. Dentro del proyecto, anade dos servicios:
   - **PostgreSQL** (`+ New > Database > PostgreSQL`)
   - **Redis** (`+ New > Database > Redis`)
3. Espera 30s a que aprovisionen.
4. En cada servicio, abre la pestana **Connect** y copia:
   - Postgres: `DATABASE_PUBLIC_URL` (formato `postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/railway`)
   - Redis: `REDIS_PUBLIC_URL` (formato `redis://default:xxx@xxx.proxy.rlwy.net:PORT`)

> **Por que `PUBLIC_URL` y no la interna:** las URLs internas (`*.railway.internal`) solo funcionan desde servicios desplegados dentro del mismo proyecto Railway. En tu maquina local necesitas la URL publica con TLS.

## 3. Variables de entorno

### `apps/api/.env.local`

```bash
NODE_ENV=development
PORT=3001
WEB_ORIGIN=http://localhost:3000

# Control plane DB (existe desde el dia 0 — el "postgres" db por defecto en Railway sirve)
CONTROL_PLANE_DATABASE_URL=postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/control_plane?sslmode=require

# Datos para crear DBs tenant (mismo cluster, diferente DB por tenant)
TENANT_DB_HOST=xxx.proxy.rlwy.net:PORT
TENANT_DB_ADMIN_URL=postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/postgres?sslmode=require
TENANT_DB_MASTER_PASSWORD=xxx   # password de role admin (postgres por defecto)
TENANT_DB_SSLMODE=require

REDIS_URL=redis://default:xxx@xxx.proxy.rlwy.net:PORT

# Crypto — generar con: openssl rand -base64 32
KEK_V1=<32 bytes base64>
CURRENT_KEK_VERSION=1

# Sesion — generar con: openssl rand -base64 32
SESSION_SECRET=<32 bytes base64>
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
```

### `apps/web/.env.local`

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
SESSION_COOKIE_NAME=smartlog_session
```

## 4. Crear la DB de control plane

La DB por defecto en Railway se llama `railway`. Para mantener el patron del plan, crea una DB dedicada para el control plane:

```bash
# Reemplaza con tu DATABASE_PUBLIC_URL
psql "postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/railway" -c "CREATE DATABASE control_plane;"
```

> Si no tienes `psql` instalado, puedes hacerlo desde la UI de Railway con su Query Editor, o instalar [psql portable](https://www.postgresql.org/download/).

## 5. Generar secretos

En PowerShell (Windows):

```powershell
# KEK_V1
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# SESSION_SECRET
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

O via Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 6. Instalar dependencias y levantar

```bash
pnpm install
pnpm db:migrate     # corre prisma migrate deploy del control plane
pnpm dev            # arranca web (3000) + api (3001) en paralelo via turbo
```

## 7. Probar el flujo end-to-end

1. Browser -> `http://localhost:3000/signup` -> registrar usuario y workspace `acme`.
2. La API crea automaticamente la DB `tenant_acme_xxx` en el mismo cluster Railway.
3. Navega a `/connections/vtex/new` y conecta una cuenta VTEX real.
4. Backfill arranca en background; los pedidos aparecen en `/orders`.

## 8. Tiempo real (SSE) + Reconciliacion + Webhooks VTEX

La DB es un **mirror de VTEX**: solo contiene pedidos en `ready-for-handling`.
Hay TRES mecanismos que la mantienen sincronizada, sin que nadie tenga que estar
en la pagina ni pulsar nada:

1. **Reconciliacion periodica (automatica, sin tunel)** — cada ~90s, mientras el
   back corre, un job recorre cada conexion VTEX, trae la lista actual de
   `ready-for-handling` y BORRA de la DB lo que VTEX ya no lista (cambios de
   estado). Esto es lo que llena/limpia la DB sola. Configurable con
   `REALTIME_RECONCILE_MS` (0 = desactivar).
2. **Webhooks VTEX (instantaneo, requiere tunel)** — cuando un pedido cambia de
   estado, VTEX nos avisa en el momento y el pedido aparece/desaparece en <1s.
3. **SSE (push al navegador)** — los cambios anteriores se empujan a las pestanas
   abiertas en vivo (sin recargar). Funciona sin tunel.

El **tunel solo acelera** (de ~90s a <1s). Sin tunel, la reconciliacion ya
mantiene todo correcto en menos de minuto y medio.

### Flujo recomendado (3 terminales)

```bash
# Terminal 1 — tunel publico (cloudflared, sin cuenta). Escribe la URL en
# apps/api/.env.local (PUBLIC_WEBHOOK_BASE_URL) automaticamente.
pnpm tunnel

# Terminal 2 — app (arranca con la URL del tunel ya seteada)
pnpm dev

# Luego en la app: Conexiones -> "Sincronizar"  (re-registra el webhook con la
# URL del tunel y corre el backfill)
```

> cloudflared se instalo con `winget install Cloudflare.cloudflared`. La URL
> `*.trycloudflare.com` cambia en cada `pnpm tunnel`; por eso "Sincronizar"
> re-registra el webhook solo. No hay nada que copiar/pegar a mano.

### Probar la baja en vivo
1. Abre `/orders` en dos pestanas (o dos usuarios del mismo workspace).
2. En VTEX, avanza un pedido fuera de "ready-for-handling" (Iniciar preparacion).
3. El pedido desaparece de ambas pestanas en < 1s (via webhook -> Redis -> SSE).

Si el tunel no esta corriendo, la baja igual ocurre al pulsar "Sincronizar"
(el backfill hace prune de los pedidos que ya no estan en ready-for-handling).

## 9. Problemas comunes

| Sintoma | Causa probable | Fix |
|---|---|---|
| `prisma migrate` falla con `permission denied to create database` | El user que usaste no tiene `CREATEDB` | Usa el user `postgres` (default Railway lo tiene) |
| `error: self signed certificate` al conectar | Railway exige TLS; tu URL no tiene `?sslmode=require` | Anade `?sslmode=require` al final |
| Webhook no llega | El tunel cerro | Re-arranca ngrok/cloudflared y actualiza la URL en VTEX |
| Workers no procesan jobs | Redis no esta accesible | Verifica `REDIS_URL` con `redis-cli ping` |
