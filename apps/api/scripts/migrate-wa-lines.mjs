/**
 * Cimientos de MULTI-LINEA de WhatsApp.
 *
 * 1. "Dialog360Connection" pasa a llamarse "WaLine" (rename en sitio, atomico y
 *    barato: no copia datos). Si ya existe WaLine, no hace nada.
 * 2. Columnas nuevas de la linea: nombre visible, proveedor, numero, y lo que
 *    solo usa Meta (phoneNumberId, wabaId, appSecret cifrado, verifyToken).
 * 3. La fila que ya existia queda como linea PREDETERMINADA, con label
 *    "WhatsApp" y proveedor 'dialog360' — o sea, exactamente lo de hoy.
 * 4. "WaMessage"."lineId" + backfill a esa unica linea, para que el historial
 *    no quede huerfano.
 * 5. Tabla "WaFlow" (mensajes automaticos configurables). Nace VACIA a
 *    proposito: sin filas, cada flujo se comporta como siempre.
 *
 * Idempotente. No borra nada.
 *
 * OJO AL ORDEN: esto RENOMBRA una tabla, asi que el codigo desplegado deja de
 * encontrarla en el instante en que se corre. Hay que DESPLEGAR PRIMERO el
 * codigo que usa WaLine y correr la migracion despues — al reves tumba el
 * listado de pedidos, porque orders.service.ts consulta esa tabla dentro de
 * list(). (Pasó. De ahi este comentario.)
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-wa-lines.mjs
 */
import pg from 'pg';

const { Client } = pg;

const strip = (u) => {
  try {
    const x = new URL(u);
    x.searchParams.delete('sslmode');
    return x.toString();
  } catch {
    return u;
  }
};
const ssl = () =>
  process.env.TENANT_DB_SSLMODE === 'disable' ? undefined : { rejectUnauthorized: false };
const forDb = (a, n) => {
  const u = new URL(a);
  u.pathname = `/${n}`;
  return u.toString();
};

const DDL = `
DO $$
BEGIN
  -- 1. Rename en sitio (solo si aun no se hizo).
  -- table_type='BASE TABLE': information_schema.tables tambien lista VISTAS, y
  -- durante el despliegue existio una vista "Dialog360Connection" de
  -- compatibilidad. Sin este filtro, re-correr esto intentaria renombrarla.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'Dialog360Connection' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'WaLine') THEN
    ALTER TABLE "Dialog360Connection" RENAME TO "WaLine";
  END IF;
END $$;

-- Si el tenant nunca tuvo WhatsApp, la tabla no existia: se crea vacia.
CREATE TABLE IF NOT EXISTS "WaLine" (
  "id"              TEXT PRIMARY KEY,
  "encryptedApiKey" BYTEA NOT NULL,
  "mode"            TEXT NOT NULL DEFAULT 'production',
  "webhookUrl"      TEXT,
  "status"          TEXT NOT NULL DEFAULT 'connected',
  "lastError"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- 2. Columnas de la linea.
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "label"              TEXT;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "provider"           TEXT NOT NULL DEFAULT 'dialog360';
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "phone"              TEXT;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "countryCode"        TEXT NOT NULL DEFAULT '57';
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "encryptedAppSecret" BYTEA;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "phoneNumberId"      TEXT;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "wabaId"             TEXT;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "verifyToken"        TEXT;
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "isDefault"          BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "WaLine_status_idx" ON "WaLine"("status");

-- 3. La linea que ya existia: nombre y predeterminada.
UPDATE "WaLine" SET "label" = 'WhatsApp' WHERE "label" IS NULL;
UPDATE "WaLine" SET "isDefault" = true
 WHERE "id" = (SELECT "id" FROM "WaLine" ORDER BY "createdAt" ASC LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM "WaLine" WHERE "isDefault");
ALTER TABLE "WaLine" ALTER COLUMN "label" SET NOT NULL;

-- 4. Por que linea salio cada mensaje.
ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "lineId" TEXT;
CREATE INDEX IF NOT EXISTS "WaMessage_lineId_createdAt_idx" ON "WaMessage"("lineId", "createdAt");
UPDATE "WaMessage"
   SET "lineId" = (SELECT "id" FROM "WaLine" ORDER BY "createdAt" ASC LIMIT 1)
 WHERE "lineId" IS NULL
   AND EXISTS (SELECT 1 FROM "WaLine");

-- 5. Mensajes automaticos configurables. Nace VACIA: sin filas, todo sigue igual.
CREATE TABLE IF NOT EXISTS "WaFlow" (
  "id"        TEXT PRIMARY KEY,
  "kind"      TEXT NOT NULL,
  "lineId"    TEXT NOT NULL REFERENCES "WaLine"("id") ON DELETE CASCADE,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "scope"     JSONB NOT NULL DEFAULT '["*"]',
  "config"    JSONB NOT NULL DEFAULT '{}',
  "priority"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "WaFlow_kind_enabled_idx" ON "WaFlow"("kind", "enabled");
CREATE INDEX IF NOT EXISTS "WaFlow_lineId_idx" ON "WaFlow"("lineId");
`;

/**
 * El script corre como ADMIN, asi que una tabla CREADA aqui queda a nombre de
 * `postgres` y el rol con el que se conecta la aplicacion no puede ni leerla
 * (la app usa `tenant.dbRole`, no el admin — tenant-connection.service.ts:81).
 * Las tablas que solo se ALTERan no tienen el problema: conservan su dueño.
 *
 * Pasó con WaFlow: el endpoint devolvia 500 con un "permission denied" que
 * desde fuera se veia como un escueto "Internal server error". De ahi este paso.
 */
const GRANTS = (role) => `
ALTER TABLE "WaFlow" OWNER TO "${role}";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${role}";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${role}";
`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL en el env');
  }

  const control = new Client({ connectionString: strip(controlUrl), ssl: ssl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Cimientos multi-linea de WhatsApp en ${tenants.length} tenant(s)...\n`);
  let bad = 0;
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(forDb(adminUrl, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      await db.query(DDL);
      // Sin esto la app no puede leer la tabla que acabamos de crear.
      if (t.dbRole) await db.query(GRANTS(t.dbRole));
      const { rows } = await db.query(
        `SELECT (SELECT COUNT(*)::int FROM "WaLine") AS lineas,
                (SELECT COUNT(*)::int FROM "WaMessage" WHERE "lineId" IS NOT NULL) AS con_linea,
                (SELECT COUNT(*)::int FROM "WaMessage" WHERE "lineId" IS NULL) AS sin_linea,
                (SELECT COUNT(*)::int FROM "WaFlow") AS flujos`,
      );
      const r = rows[0];
      console.log(
        `  ✓ ${t.slug} — ${r.lineas} linea(s) · ${r.con_linea} mensaje(s) con linea` +
          (r.sin_linea ? ` · ${r.sin_linea} sin linea (no habia WhatsApp conectado)` : '') +
          ` · ${r.flujos} flujo(s)`,
      );
    } catch (err) {
      bad++;
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log(bad === 0 ? '\nListo.' : `\nTerminado con ${bad} fallo(s).`);
  if (bad > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
