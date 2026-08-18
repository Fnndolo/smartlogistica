/**
 * Migracion aditiva: operaciones de chat de la bandeja (menu contextual).
 * - WaContact: archived / muted / pinned (globales del negocio)
 * - WaLabel: registro de etiquetas con COLOR
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-wa-chatops.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; }
};
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const SAFE_ROLE = /^[a-z0-9_-]+$/i;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  for (const t of tenants) {
    if (!SAFE_ROLE.test(t.dbRole)) { console.error(`  ✗ ${t.slug}: rol sospechoso`); continue; }
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      await db.query(`ALTER TABLE "WaContact" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false`);
      await db.query(`ALTER TABLE "WaContact" ADD COLUMN IF NOT EXISTS "muted" BOOLEAN NOT NULL DEFAULT false`);
      await db.query(`ALTER TABLE "WaContact" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS "WaLabel" (
          "name" TEXT NOT NULL,
          "color" TEXT NOT NULL DEFAULT '#00a884',
          CONSTRAINT "WaLabel_pkey" PRIMARY KEY ("name")
        )`);
      await db.query(`ALTER TABLE "WaLabel" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug}`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log('Listo.');
}
main().catch((e) => { console.error(e); process.exit(1); });
