/**
 * Migracion aditiva: WhatsApp por pedido via Whapify.
 * - WhapifyConnection (token cifrado, singleton)
 * - WaMessage (historial in/out por telefono)
 * - WaContact (cache telefono -> contacto Whapify)
 * TABLAS NUEVAS: necesitan ALTER OWNER al rol del tenant (guiones permitidos).
 * Correr desde apps/api: node --env-file=.env.local scripts/migrate-whatsapp.mjs
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
      await db.query(`
        CREATE TABLE IF NOT EXISTS "WhapifyConnection" (
          "id" TEXT NOT NULL,
          "encryptedToken" BYTEA NOT NULL,
          "accountName" TEXT,
          "totalContacts" INTEGER,
          "status" TEXT NOT NULL DEFAULT 'connected',
          "lastError" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "WhapifyConnection_pkey" PRIMARY KEY ("id")
        )`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS "WaMessage" (
          "id" TEXT NOT NULL,
          "phone" TEXT NOT NULL,
          "direction" TEXT NOT NULL,
          "kind" TEXT NOT NULL DEFAULT 'text',
          "body" TEXT,
          "attachmentKey" TEXT,
          "mediaUrl" TEXT,
          "authorId" TEXT,
          "authorName" TEXT,
          "contactId" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
        )`);
      await db.query(
        `CREATE INDEX IF NOT EXISTS "WaMessage_phone_createdAt_idx" ON "WaMessage"("phone", "createdAt")`,
      );
      await db.query(`
        CREATE TABLE IF NOT EXISTS "WaContact" (
          "phone" TEXT NOT NULL,
          "contactId" TEXT NOT NULL,
          "name" TEXT,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "WaContact_pkey" PRIMARY KEY ("phone")
        )`);
      for (const table of ['WhapifyConnection', 'WaMessage', 'WaContact']) {
        await db.query(`ALTER TABLE "${table}" OWNER TO "${t.dbRole}"`);
      }
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
