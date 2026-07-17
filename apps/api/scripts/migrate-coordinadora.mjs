/**
 * Migracion aditiva: crea la tabla "CoordinadoraConnection" en cada tenant DB ya
 * provisionada. Idempotente (CREATE TABLE IF NOT EXISTS + FK guard).
 *
 * CRITICO: la tabla se crea conectados como admin (postgres), por lo que NO
 * seria accesible por el role del tenant (error 42501). Por eso al final
 * ALTER TABLE ... OWNER TO "<dbRole>". (Mismo gotcha que Warehouse/Alegra.)
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-coordinadora.mjs
 */
import pg from 'pg';

const { Client } = pg;

const SAFE_IDENT = /^[a-z_][a-z0-9_-]{0,62}$/;

function stripSslMode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

function pgSsl() {
  const sslmode = process.env.TENANT_DB_SSLMODE ?? 'require';
  return sslmode === 'disable' ? undefined : { rejectUnauthorized: false };
}

function adminUrlForDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const DDL = (dbRole) => `
CREATE TABLE IF NOT EXISTS "CoordinadoraConnection" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "idCliente" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "encryptedPassword" BYTEA NOT NULL,
    "nit" TEXT NOT NULL,
    "div" TEXT NOT NULL DEFAULT '01',
    "senderName" TEXT NOT NULL,
    "senderNit" TEXT,
    "senderPhone" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "senderCityCode" TEXT NOT NULL,
    "senderCityName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoordinadoraConnection_pkey" PRIMARY KEY ("id")
);

-- Aditivo: formato de rotulo (id_rotulo). 55 = 10x10 cm.
ALTER TABLE "CoordinadoraConnection"
    ADD COLUMN IF NOT EXISTS "rotuloId" INTEGER NOT NULL DEFAULT 55;

CREATE UNIQUE INDEX IF NOT EXISTS "CoordinadoraConnection_warehouseId_key"
    ON "CoordinadoraConnection"("warehouseId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CoordinadoraConnection_warehouseId_fkey'
  ) THEN
    ALTER TABLE "CoordinadoraConnection"
      ADD CONSTRAINT "CoordinadoraConnection_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "CoordinadoraConnection" OWNER TO "${dbRole}";
`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL en el env');
  }

  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT id, slug, "dbName", "dbRole", status FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  if (tenants.length === 0) {
    console.log('No hay tenants ACTIVE. Nada que migrar.');
    return;
  }

  console.log(`Migrando CoordinadoraConnection en ${tenants.length} tenant(s)...\n`);

  for (const t of tenants) {
    if (!SAFE_IDENT.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole inseguro "${t.dbRole}" — SALTADO`);
      continue;
    }
    const url = stripSslMode(adminUrlForDb(adminUrl, t.dbName));
    const db = new Client({ connectionString: url, ssl: pgSsl() });
    try {
      await db.connect();
      await db.query(DDL(t.dbRole));
      console.log(`  ✓ ${t.slug} (${t.dbName}) — tabla lista, OWNER=${t.dbRole}`);
    } catch (err) {
      console.error(`  ✗ ${t.slug} (${t.dbName}): ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }

  console.log('\nListo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
