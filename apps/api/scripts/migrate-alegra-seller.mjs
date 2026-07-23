/**
 * Migracion aditiva: vendedor de Alegra por usuario+sede.
 * Tabla "AlegraSellerPref" (unique warehouseId+userId, FK a Warehouse).
 * Idempotente. OJO: tabla NUEVA -> ALTER OWNER al rol del tenant (la app se
 * conecta con ese rol; si queda del admin da 42501 "permission denied").
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-alegra-seller.mjs
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
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => {
  const x = new URL(u);
  x.pathname = `/${db}`;
  return x.toString();
};

const DDL = `
CREATE TABLE IF NOT EXISTS "AlegraSellerPref" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerName" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlegraSellerPref_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AlegraSellerPref_warehouseId_userId_key"
  ON "AlegraSellerPref"("warehouseId", "userId");
DO $$ BEGIN
  ALTER TABLE "AlegraSellerPref"
    ADD CONSTRAINT "AlegraSellerPref_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Creando AlegraSellerPref en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    if (!/^[a-z0-9_-]+$/i.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole sospechoso, saltado`);
      continue;
    }
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      await db.query(`ALTER TABLE "AlegraSellerPref" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug} — AlegraSellerPref lista (owner ${t.dbRole})`);
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
