/**
 * Migracion aditiva: registro de llamadas al webhook de confirmacion (Whapify).
 * Tabla "ConfirmationLog": una fila por llamada recibida (aplicada o no).
 * Idempotente (CREATE TABLE IF NOT EXISTS).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-confirmation-log.mjs
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
CREATE TABLE IF NOT EXISTS "ConfirmationLog" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "address" TEXT,
  "matched" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfirmationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConfirmationLog_createdAt_idx" ON "ConfirmationLog"("createdAt" DESC);
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Creando ConfirmationLog en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      console.log(`  ✓ ${t.slug} — ConfirmationLog lista`);
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
