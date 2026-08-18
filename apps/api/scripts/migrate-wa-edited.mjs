/**
 * Migracion aditiva: WaMessage.edited (mensajes EDITADOS desde el celular,
 * como el "Editado" de WhatsApp) + limpieza de burbujas fantasma "[edit]".
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-wa-edited.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; }
};
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      await db.query(`ALTER TABLE "WaMessage" ADD COLUMN IF NOT EXISTS "edited" BOOLEAN NOT NULL DEFAULT false`);
      const del = await db.query(`DELETE FROM "WaMessage" WHERE kind='text' AND body='[edit]'`);
      console.log(`  ✓ ${t.slug} (burbujas [edit] borradas: ${del.rowCount})`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log('Listo.');
}
main().catch((e) => { console.error(e); process.exit(1); });
