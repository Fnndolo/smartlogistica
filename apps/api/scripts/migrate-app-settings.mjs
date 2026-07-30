/**
 * Migracion aditiva: tabla AppSetting (ajustes generales del workspace) y
 * SEED de 'packagePresets' con la union de los paquetes que estaban por sede
 * (dedupe por nombre). Idempotente. Tabla NUEVA -> ALTER OWNER al rol tenant.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-app-settings.mjs
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
CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Creando AppSetting en ${tenants.length} tenant(s)...\n`);
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
      await db.query(`ALTER TABLE "AppSetting" OWNER TO "${t.dbRole}"`);

      // Seed: union de los paquetes que estaban por sede (dedupe por nombre).
      const existing = (
        await db.query(`SELECT value FROM "AppSetting" WHERE key='packagePresets'`)
      ).rows[0];
      if (!existing) {
        const rows = (
          await db.query(
            `SELECT "packagePresets" FROM "Warehouse" WHERE "packagePresets" IS NOT NULL`,
          )
        ).rows;
        const byName = new Map();
        for (const r of rows) {
          const list = Array.isArray(r.packagePresets) ? r.packagePresets : [];
          for (const p of list) {
            if (p && typeof p.name === 'string' && !byName.has(p.name)) byName.set(p.name, p);
          }
        }
        const merged = [...byName.values()];
        await db.query(
          `INSERT INTO "AppSetting"(key, value, "updatedAt") VALUES ('packagePresets', $1::jsonb, NOW())`,
          [JSON.stringify(merged)],
        );
        console.log(`  ✓ ${t.slug} — AppSetting lista; ${merged.length} paquete(s) migrados a global`);
      } else {
        console.log(`  ✓ ${t.slug} — AppSetting ya tenia packagePresets`);
      }
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
