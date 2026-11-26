/**
 * Migracion aditiva: GARANTIAS (reemplazan la hoja de calculo "GARANTIAS").
 * Tablas "Warranty", "WarrantyMessage" (conversacion + archivos) y
 * "WarrantyEvent" (linea de tiempo). Idempotente: se puede correr varias veces.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-warranties.mjs
 * En un servicio de Railway (sin .env.local): node scripts/migrate-warranties.mjs
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
/** Igual que el API: por la red privada de Railway no hay TLS que negociar. */
const ssl = (url) => {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* url invalida: se decide por la variable */
  }
  if (/\.railway\.internal$/i.test(host)) return undefined;
  return (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable'
    ? undefined
    : { rejectUnauthorized: false };
};
/**
 * Base admin del tenant. Si el ambiente fija TENANT_DB_HOST (pruebas), la base
 * sale SOLO de ese host: la copia guarda el de produccion y no se debe tocar.
 */
const adminDb = (u, db) => {
  const x = new URL(u);
  x.pathname = `/${db}`;
  if (process.env.TENANT_DB_HOST) x.host = process.env.TENANT_DB_HOST;
  return x.toString();
};

const DDL = `
CREATE TABLE IF NOT EXISTS "Warranty" (
  "id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "resolution" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "store" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerDocument" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "customerEmail" TEXT,
  "city" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "serial" TEXT NOT NULL,
  "purchaseDate" TIMESTAMP(3),
  "invoiceNumber" TEXT,
  "physicalCondition" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "accessories" TEXT[],
  "comments" TEXT,
  "assigneeId" TEXT,
  "assigneeName" TEXT,
  "supplier" TEXT,
  "supplierSentAt" TIMESTAMP(3),
  "closureNote" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Warranty_number_key" ON "Warranty"("number");
CREATE INDEX IF NOT EXISTS "Warranty_status_receivedAt_idx" ON "Warranty"("status", "receivedAt");
CREATE INDEX IF NOT EXISTS "Warranty_serial_idx" ON "Warranty"("serial");
CREATE INDEX IF NOT EXISTS "Warranty_customerDocument_idx" ON "Warranty"("customerDocument");

CREATE TABLE IF NOT EXISTS "WarrantyMessage" (
  "id" TEXT NOT NULL,
  "warrantyId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "body" TEXT,
  "tag" TEXT,
  "attachmentKey" TEXT,
  "attachmentMime" TEXT,
  "attachmentName" TEXT,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarrantyMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WarrantyMessage_warrantyId_createdAt_idx" ON "WarrantyMessage"("warrantyId", "createdAt");

CREATE TABLE IF NOT EXISTS "WarrantyEvent" (
  "id" TEXT NOT NULL,
  "warrantyId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "note" TEXT,
  "data" JSONB,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarrantyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WarrantyEvent_warrantyId_createdAt_idx" ON "WarrantyEvent"("warrantyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarrantyMessage_warrantyId_fkey') THEN
    ALTER TABLE "WarrantyMessage" ADD CONSTRAINT "WarrantyMessage_warrantyId_fkey"
      FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarrantyEvent_warrantyId_fkey') THEN
    ALTER TABLE "WarrantyEvent" ADD CONSTRAINT "WarrantyEvent_warrantyId_fkey"
      FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
`;

const TABLES = ['Warranty', 'WarrantyMessage', 'WarrantyEvent'];

async function main() {
  const controlUrl = strip(process.env.CONTROL_PLANE_DATABASE_URL);
  const control = new Client({ connectionString: controlUrl, ssl: ssl(controlUrl) });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Creando las tablas de garantias en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    if (!/^[a-z0-9_-]+$/i.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole sospechoso, saltado`);
      continue;
    }
    const dbUrl = strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName));
    const db = new Client({ connectionString: dbUrl, ssl: ssl(dbUrl) });
    try {
      await db.connect();
      await db.query(DDL);
      // La app se conecta con el rol del tenant (no el admin): las tablas deben
      // ser suyas, igual que las que crea init.sql en el provisioning.
      for (const table of TABLES) {
        await db.query(`ALTER TABLE "${table}" OWNER TO "${t.dbRole}"`);
      }
      console.log(`  ✓ ${t.slug} — garantias listas (owner ${t.dbRole})`);
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
