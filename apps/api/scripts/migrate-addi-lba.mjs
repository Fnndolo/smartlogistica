/**
 * Migracion aditiva: GUIAS DE ADDI (Addi Logistics).
 *   - Tabla AddiLbaConnection (portal de aliados de Addi + suite de
 *     Coordinadora de la cuenta de Addi, contraseñas cifradas; una por tenant).
 *   - Order.addiGuide / addiShipment: la guia que Addi genero para el pedido.
 *   - Order.addiSender*: estado del cambio de remitente al pasar a una sede.
 *
 * Idempotente. No toca ningun dato: todo nace vacio y sin conexion configurada
 * no pasa nada. Se corre ANTES de desplegar (columnas que admiten null no le
 * molestan al codigo viejo). Sin indices: un CREATE INDEX sobre "Order" se
 * pide aparte (ver incidente de carga).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-addi-lba.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  const x = new URL(u);
  x.searchParams.delete('sslmode');
  return x.toString();
};
const ssl = () =>
  (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable'
    ? undefined
    : { rejectUnauthorized: false };
const adminDb = (u, db) => {
  const x = new URL(u);
  x.pathname = `/${db}`;
  return x.toString();
};

const DDL = (dbRole) => `
CREATE TABLE IF NOT EXISTS "AddiLbaConnection" (
    "id" TEXT NOT NULL,
    "portalEmail" TEXT NOT NULL,
    "encryptedPortalPassword" BYTEA NOT NULL,
    "suiteEmail" TEXT NOT NULL,
    "encryptedSuitePassword" BYTEA NOT NULL,
    "autoSender" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AddiLbaConnection_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AddiLbaConnection" OWNER TO "${dbRole}";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiGuide" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiShipment" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiSenderPendingAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiSenderWarehouseId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiSenderAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addiSenderError" TEXT;
`;

async function main() {
  const control = new Client({
    connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL),
    ssl: ssl(),
  });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  console.log(`Migrando guias de Addi en ${tenants.length} tenant(s)...`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      await db.query(DDL(t.dbRole));
      const { rows } = await db.query(
        `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name='Order' AND column_name LIKE 'addi%'`,
      );
      console.log(
        `  ✓ ${t.slug} — ${rows[0].n}/6 columnas addi* en Order, tabla AddiLbaConnection lista`,
      );
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
