/**
 * Migracion aditiva: extras del chat de WhatsApp.
 * - WaMessage.starred (Destacar mensajes)
 * - WaStickerFav (stickers FAVORITOS del negocio, apuntan al storage)
 * TABLA NUEVA: necesita ALTER OWNER al rol del tenant.
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-wa-extras.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; }
};
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const SAFE_ROLE = /^[a-z0-9_-]+$/i;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  for (const t of tenants) {
    if (!SAFE_ROLE.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole sospechoso (${t.dbRole}), lo salto`);
      continue;
    }
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      await db.query(`ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "starred" BOOLEAN NOT NULL DEFAULT false`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS "WaStickerFav" (
          "id" TEXT NOT NULL,
          "attachmentKey" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "WaStickerFav_pkey" PRIMARY KEY ("id")
        )`);
      await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "WaStickerFav_attachmentKey_key" ON "WaStickerFav"("attachmentKey")`,
      );
      await db.query(`ALTER TABLE "WaStickerFav" OWNER TO "${t.dbRole}"`);
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
