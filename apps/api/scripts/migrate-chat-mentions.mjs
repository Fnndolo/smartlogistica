/**
 * Migracion aditiva para el chat: menciones + estado de lectura (no leidos).
 *   - "OrderMessage"."mentions" TEXT[]  (userIds mencionados con @)
 *   - Tabla "OrderRead" (hasta cuando cada usuario leyo el hilo de un pedido)
 * Idempotente (ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS). La tabla
 * nueva se crea como admin -> ALTER TABLE ... OWNER TO "<dbRole>" (gotcha 42501).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-chat-mentions.mjs
 */
import pg from 'pg';

const { Client } = pg;
// El dbRole va como identificador ENTRE COMILLAS ("..."), donde Postgres admite
// guiones (los roles son p.ej. role_smart-gadgets_<hash>). Solo hay que impedir
// comillas/backslash que romperian el quoting.
const SAFE_IDENT = /^[A-Za-z0-9_-]+$/;

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
ALTER TABLE "OrderMessage" ADD COLUMN IF NOT EXISTS "mentions" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "OrderRead" (
  "id"         TEXT NOT NULL,
  "orderId"    TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderRead_orderId_userId_key" ON "OrderRead"("orderId", "userId");
CREATE INDEX IF NOT EXISTS "OrderRead_userId_idx" ON "OrderRead"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'OrderRead_orderId_fkey' AND table_name = 'OrderRead'
  ) THEN
    ALTER TABLE "OrderRead"
      ADD CONSTRAINT "OrderRead_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "OrderRead" OWNER TO "${dbRole}";
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
      `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Migrando chat (menciones + no leidos) en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    if (!SAFE_IDENT.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole inseguro "${t.dbRole}" — SALTADO`);
      continue;
    }
    const db = new Client({
      connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)),
      ssl: pgSsl(),
    });
    try {
      await db.connect();
      await db.query(DDL(t.dbRole));
      console.log(`  ✓ ${t.slug} (${t.dbName}) — mentions + OrderRead listos, OWNER=${t.dbRole}`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
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
