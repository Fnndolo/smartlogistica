# Ambiente de pruebas (staging)

Copia de producción para probar cambios **antes** de subirlos a `main`.
Vive en el mismo proyecto de Railway que producción, en el entorno **`pruebas`**
(producción es el entorno `production`).

> **Ojo con los nombres:** el proyecto de Railway se llama **"Staging SmartLogistica"**,
> pero su entorno `production` **es producción real**. Las pruebas van en el entorno
> `pruebas`. Antes de cualquier comando de Railway, confirmar el entorno con `railway status`.

| Servicio (entorno `pruebas`) | Qué es |
|---|---|
| `web-pruebas` | Next.js desde la rama **`staging`**. Es la URL para entrar. |
| `api-pruebas` | NestJS desde la rama **`staging`**, con `SANDBOX_MODE=true`. |
| `Postgres-i9t0` | Copia de **todas** las bases de producción (control plane + tenants). |
| `Redis-LCT0` | Propio y vacío (colas y tiempo real de pruebas). |

La página muestra arriba la pastilla **"Ambiente de pruebas · copia de producción"**.

## Qué protege el modo pruebas

La copia trae las credenciales **reales** de VTEX, Alegra, WhatsApp y
transportadoras (viven cifradas en la base). Con `SANDBOX_MODE=true` el API:

- **Deja pasar** todas las lecturas, los inicios de sesión, cotizar, rastrear,
  imprimir rótulos de guías que ya existen y la IA.
- **Bloquea** con un error claro las escrituras hacia afuera, por ejemplo:
  facturar en Alegra, crear guías, cambiar estados o facturas en VTEX y
  configurar webhooks. Lo desconocido también se bloquea.
- **WhatsApp** solo sale a los números de `SANDBOX_WA_ALLOWED_PHONES`
  (separados por coma). A cualquier otro número, el envío falla con el motivo.
- **No** re-registra el webhook de VTEX al arrancar (VTEX guarda uno por cuenta:
  producción dejaría de recibir pedidos).
- **No** manda notificaciones push y **no** borra archivos (el almacenamiento es
  el mismo de producción).
- La base del tenant sale **solo** de `TENANT_DB_HOST` (nunca del host guardado
  en la copia, que es el de producción).

El código está en `apps/api/src/infrastructure/sandbox/` con sus pruebas
(`pnpm --filter @smartlogistica/api test`).

**Qué NO hacer en pruebas:** reconectar WhatsApp, VTEX u otras integraciones
desde Conexiones. Ya está bloqueado, pero es la forma más fácil de afectar
producción si alguna vez se desactiva el modo pruebas.

## Probar una rama

1. Une la rama a `staging` (`git switch staging && git merge mi-rama && git push`).
2. Railway despliega `api-pruebas` y `web-pruebas` solos.
3. Cuando esté bien, se une la rama a `main` como siempre (producción).

`staging` lleva el modo pruebas; las ramas de trabajo salen de `main`.

## Refrescar los datos

La copia es una foto del momento en que se hizo; producción sigue recibiendo
pedidos. Para traer datos frescos:

1. Abrir acceso temporal a la base de pruebas:
   `railway tcp-proxy create --port 5432 --service Postgres-i9t0 --environment pruebas`
2. Borrar las bases de pruebas (`control_plane` y `tenant_*`) y volver a copiar con
   `pg_dumpall` desde producción (cliente **Postgres 18**), omitiendo
   `CREATE/ALTER ROLE postgres` para no cambiar la contraseña del superusuario de pruebas.
3. En la copia, apuntar el tenant a la base de pruebas:
   `update "Tenant" set "dbHost" = 'postgres-i9t0.railway.internal:5432';`
4. Cerrar el acceso: `railway tcp-proxy delete <id> --yes`.

Así quedan las mismas credenciales cifradas (la KEK de pruebas es la de producción).

## Variables

El API de pruebas usa las variables de producción, con estas diferencias:

- `SANDBOX_MODE=true`.
- `SANDBOX_WA_ALLOWED_PHONES` con los números autorizados.
- Base y Redis por referencia a `Postgres-i9t0` y `Redis-LCT0`.
- `SESSION_SECRET` y `CONFIRMATION_WEBHOOK_SECRET` propios.
- Sin `PUBLIC_WEBHOOK_BASE_URL` y sin `VAPID_*`.
- `REALTIME_RECONCILE_MS=0` y `SHIPPING_REFRESH_MS=0` (datos quietos).

La web usa `NEXT_PUBLIC_SANDBOX_MODE=true`.

Los comandos de build y arranque van en `RAILPACK_BUILD_CMD` y
`RAILPACK_START_CMD`, iguales a los de producción.
