/**
 * Migracion aditiva: editar mensajes del chat interno, con historial.
 *   - OrderMessage.editedAt TIMESTAMP (null = nunca se edito)
 *   - Tabla OrderMessageEdit: el texto ANTERIOR de cada edicion (FK cascade:
 *     si se borra el mensaje se va su historial)
 * Idempotente. No toca ningun dato existente. Tabla NUEVA -> ALTER OWNER al
 * rol del tenant (sin eso, 42501). Se corre ANTES de desplegar: el codigo viejo
 * ignora la columna y la tabla.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-chat-edits.mjs
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
ALTER TABLE "OrderMessage" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "OrderMessageEdit" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "previousBody" TEXT,
  "editedById" TEXT NOT NULL,
  "editedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderMessageEdit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderMessageEdit_messageId_createdAt_idx"
  ON "OrderMessageEdit"("messageId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "OrderMessageEdit"
    ADD CONSTRAINT "OrderMessageEdit_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "OrderMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Migrando edicion de mensajes en ${tenants.length} tenant(s)...\n`);
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
      await db.query(`ALTER TABLE "OrderMessageEdit" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug} — editedAt + OrderMessageEdit listos (owner ${t.dbRole})`);
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
