/**
 * Migracion aditiva: crea la tabla "AlegraImeiIndex" (indice IMEI -> factura de
 * compra de Alegra) en cada tenant DB. Idempotente + OWNER al role (gotcha 42501).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-alegra-imei-index.mjs
 */
import pg from 'pg';

const { Client } = pg;
const SAFE_IDENT = /^[a-z_][a-z0-9_-]{0,62}$/;

function stripSslMode(url) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return u.toString();
}
const pgSsl = () =>
  (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
function adminUrlForDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const DDL = (dbRole) => `
CREATE TABLE IF NOT EXISTS "AlegraImeiIndex" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "billNumber" TEXT,
    "billDate" TIMESTAMP(3),
    "providerName" TEXT,
    "itemName" TEXT,
    "unitCost" DECIMAL(14,2),
    "sourceWarehouseId" TEXT NOT NULL,
    "observations" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlegraImeiIndex_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AlegraImeiIndex_imei_key" ON "AlegraImeiIndex"("imei");
CREATE INDEX IF NOT EXISTS "AlegraImeiIndex_sourceWarehouseId_idx" ON "AlegraImeiIndex"("sourceWarehouseId");
CREATE INDEX IF NOT EXISTS "AlegraImeiIndex_billId_idx" ON "AlegraImeiIndex"("billId");

ALTER TABLE "AlegraImeiIndex" OWNER TO "${dbRole}";
`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL');

  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  if (tenants.length === 0) {
    console.log('No hay tenants ACTIVE. Nada que migrar.');
    return;
  }
  console.log(`Migrando AlegraImeiIndex en ${tenants.length} tenant(s)...\n`);

  for (const t of tenants) {
    if (!SAFE_IDENT.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole inseguro "${t.dbRole}" — SALTADO`);
      continue;
    }
    const db = new Client({ connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)), ssl: pgSsl() });
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
