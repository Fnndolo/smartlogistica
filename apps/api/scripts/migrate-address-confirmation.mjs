/**
 * Migracion aditiva: confirmacion de direccion por WhatsApp en "Order".
 *   - addressStatus     TEXT  (null | 'confirmed' | 'modified')
 *   - confirmedAddress  TEXT
 *   - addressConfirmedAt TIMESTAMP
 * Idempotente (ADD COLUMN IF NOT EXISTS).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-address-confirmation.mjs
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
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addressStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "confirmedAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addressConfirmedAt" TIMESTAMP(3);
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Migrando confirmacion de direccion en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      console.log(`  ✓ ${t.slug} — columnas de confirmacion listas`);
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
