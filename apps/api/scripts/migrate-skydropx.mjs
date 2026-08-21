/**
 * Migracion aditiva: SKYDROPX como segunda transportadora.
 *   - Tabla SkydropxConnection (credenciales OAuth cifradas, una por tenant).
 *   - Order.shippingProvider TEXT ('coordinadora' | 'skydropx'; null = legado
 *     Coordinadora) y Order.skydropxShipmentId TEXT (para el rastreo).
 *   - CoordinadoraConnection.senderPostalCode TEXT (CP del ORIGEN de la sede:
 *     Skydropx cotiza por codigo postal; Coordinadora no lo usa).
 *   - Seed de CP conocidos: Medellin 050015, Pasto 520003 (de la operacion).
 * Idempotente. Correr desde apps/api:
 *   node --env-file=.env.local scripts/migrate-skydropx.mjs
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

const DDL = (dbRole) => `
CREATE TABLE IF NOT EXISTS "SkydropxConnection" (
    "id" TEXT NOT NULL,
    "encryptedApiKey" BYTEA NOT NULL,
    "encryptedApiSecret" BYTEA NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkydropxConnection_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SkydropxConnection" OWNER TO "${dbRole}";

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingProvider" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "skydropxShipmentId" TEXT;
ALTER TABLE "CoordinadoraConnection" ADD COLUMN IF NOT EXISTS "senderPostalCode" TEXT;

UPDATE "CoordinadoraConnection" SET "senderPostalCode" = '050015'
  WHERE "senderPostalCode" IS NULL AND ("senderCityName" ILIKE '%medell%' OR "senderAddress" ILIKE '%medell%');
UPDATE "CoordinadoraConnection" SET "senderPostalCode" = '520003'
  WHERE "senderPostalCode" IS NULL AND ("senderCityName" ILIKE '%pasto%' OR "senderAddress" ILIKE '%pasto%');
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Migrando Skydropx en ${tenants.length} tenant(s)...`);
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      await db.query(DDL(t.dbRole));
      console.log(`  ✓ ${t.slug}`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
