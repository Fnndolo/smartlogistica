/**
 * Migracion aditiva: agrega "certificateTemplate" (JSONB) a "Warehouse" en cada
 * tenant DB. Idempotente (ADD COLUMN IF NOT EXISTS).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-warehouse-certificate.mjs
 */
import pg from 'pg';
const { Client } = pg;

const stripSslMode = (url) => {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
};
const pgSsl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminUrlForDb = (adminUrl, dbName) => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const DDL = `ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "certificateTemplate" JSONB;`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL');

  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenants;
  try {
    tenants = (
      await control.query(`SELECT slug, "dbName" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`)
    ).rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Agregando Warehouse.certificateTemplate en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({ connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)), ssl: pgSsl() });
    try {
      await db.connect();
      await db.query(DDL);
      console.log(`  ✓ ${t.slug} (${t.dbName})`);
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
