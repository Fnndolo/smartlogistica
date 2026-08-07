/**
 * Migracion aditiva: tabla SuperMentionAlert (alerta @todos, una fila por
 * destinatario). Tabla NUEVA -> ALTER OWNER al rol del tenant.
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-super-mentions.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => { try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; } };
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

const STMTS = [
  `CREATE TABLE IF NOT EXISTS "SuperMentionAlert" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    CONSTRAINT "SuperMentionAlert_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SuperMentionAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "SuperMentionAlert_userId_seenAt_idx" ON "SuperMentionAlert"("userId","seenAt")`,
];

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  for (const t of tenants) {
    if (!/^[a-z0-9_-]+$/i.test(t.dbRole)) { console.error(`  ✗ ${t.slug}: dbRole sospechoso`); continue; }
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      for (const s of STMTS) await db.query(s);
      await db.query(`ALTER TABLE "SuperMentionAlert" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug}`);
    } catch (err) { console.error(`  ✗ ${t.slug}: ${err.message}`); }
    finally { await db.end().catch(() => null); }
  }
  console.log('Listo.');
}
main().catch((e) => { console.error(e); process.exit(1); });
