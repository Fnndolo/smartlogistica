/**
 * Migracion aditiva: agrega la columna "invoicePrefix" a "Warehouse" en cada
 * tenant DB. Idempotente (ADD COLUMN IF NOT EXISTS). La tabla ya es del tenant
 * role, asi que no hace falta cambiar OWNER.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-warehouse-prefix.mjs
 */
import pg from 'pg';

const { Client } = pg;

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

const DDL = `ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "invoicePrefix" TEXT;`;

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
      `SELECT slug, "dbName" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Agregando Warehouse.invoicePrefix en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const url = stripSslMode(adminUrlForDb(adminUrl, t.dbName));
    const db = new Client({ connectionString: url, ssl: pgSsl() });
    try {
      await db.connect();
      await db.query(DDL);
      console.log(`  ✓ ${t.slug} (${t.dbName})`);
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
