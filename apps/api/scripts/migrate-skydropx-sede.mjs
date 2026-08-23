/**
 * Migracion aditiva: REMITENTE SKYDROPX POR SEDE (separado de Coordinadora).
 * Cada sede fija UNA de las direcciones de origen guardadas (y verificadas)
 * en el panel de Skydropx; la guia/cotizacion usa address_template_id (las
 * paqueterias como Inter EXIGEN origen verificado).
 * Idempotente. Correr desde apps/api:
 *   node --env-file=.env.local scripts/migrate-skydropx-sede.mjs
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
CREATE TABLE IF NOT EXISTS "SkydropxSedeConfig" (
    "warehouseId" TEXT NOT NULL,
    "addressTemplateId" TEXT NOT NULL,
    "alias" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkydropxSedeConfig_pkey" PRIMARY KEY ("warehouseId")
);
ALTER TABLE "SkydropxSedeConfig" OWNER TO "${dbRole}";
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
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
