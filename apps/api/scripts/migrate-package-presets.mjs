/**
 * Migracion aditiva: paquetes predefinidos de guias por sede.
 *   Warehouse.packagePresets JSONB  ([{name, weight, height, width, length}])
 * Idempotente (ADD COLUMN IF NOT EXISTS). Es una columna sobre una tabla
 * existente -> hereda los permisos del rol del tenant (no necesita ALTER OWNER).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-package-presets.mjs
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

const DDL = `ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "packagePresets" JSONB;`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Agregando packagePresets en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      console.log(`  ✓ ${t.slug} — columna packagePresets lista`);
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
