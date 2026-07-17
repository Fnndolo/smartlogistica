/**
 * Migracion aditiva: crea las tablas "OrderMessage" y "OrderEvent" (drawer/chat
 * por pedido) en cada tenant DB ya provisionada. Idempotente.
 *
 * CRITICO: las tablas se crean como admin (postgres) -> ALTER ... OWNER TO el
 * role del tenant, sino el role no puede accederlas (error 42501). Gotcha ya
 * pisado con Warehouse/AlegraConnection.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-order-thread.mjs
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
CREATE TABLE IF NOT EXISTS "OrderMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "attachmentKey" TEXT,
    "attachmentUrl" TEXT,
    "attachmentMime" TEXT,
    "imeis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderMessage_orderId_createdAt_idx" ON "OrderMessage"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderMessage_orderId_fkey') THEN
    ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderEvent_orderId_fkey') THEN
    ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "OrderMessage" OWNER TO "${dbRole}";
ALTER TABLE "OrderEvent" OWNER TO "${dbRole}";
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
      `SELECT id, slug, "dbName", "dbRole" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  if (tenants.length === 0) {
    console.log('No hay tenants ACTIVE. Nada que migrar.');
    return;
  }

  console.log(`Migrando OrderMessage/OrderEvent en ${tenants.length} tenant(s)...\n`);

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
      console.log(`  ✓ ${t.slug} (${t.dbName}) — tablas listas, OWNER=${t.dbRole}`);
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
