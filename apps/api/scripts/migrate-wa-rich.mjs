/**
 * Migracion aditiva: WaMessage se vuelve "rico" como WhatsApp Web:
 * - replyToId  : id del mensaje CITADO (respuestas con quote)
 * - reactions  : JSONB [{emoji, mine}] (reacciones sobre el mensaje)
 * - status     : sent | delivered | read | failed (chulitos)
 * ADD COLUMN hereda permisos.
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-wa-rich.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; }
};
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      await db.query(`ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT`);
      await db.query(`ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "reactions" JSONB`);
      await db.query(`ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "status" TEXT`);
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
