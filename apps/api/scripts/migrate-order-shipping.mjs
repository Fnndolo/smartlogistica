/**
 * Migracion aditiva: campos de ENVIO en "Order" (guideNumber + estado de rastreo)
 * para poder listar/filtrar sin llamar a Coordinadora por fila. Idempotente.
 * Ademas hace BACKFILL de guideNumber desde el evento 'guide_generated'.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-order-shipping.mjs
 */
import pg from 'pg';

const { Client } = pg;

function stripSslMode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}
function pgSsl() {
  const sslmode = process.env.TENANT_DB_SSLMODE ?? 'require';
  return sslmode === 'disable' ? undefined : { rejectUnauthorized: false };
}
function adminUrlForDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const DDL = `
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "guideNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingState" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_warehouseId_shippingState_idx"
    ON "Order"("warehouseId", "shippingState");

-- Backfill: copiar el Nº de guia del evento 'guide_generated' mas reciente.
UPDATE "Order" o
   SET "guideNumber" = sub.num
  FROM (
    SELECT DISTINCT ON (e."orderId") e."orderId", e.data->>'number' AS num
      FROM "OrderEvent" e
     WHERE e.type = 'guide_generated' AND e.data->>'number' IS NOT NULL
     ORDER BY e."orderId", e."createdAt" DESC
  ) sub
 WHERE o.id = sub."orderId" AND o."guideNumber" IS NULL;
`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL en el env');
  }

  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT slug, "dbName" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Migrando campos de envio en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)),
      ssl: pgSsl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "Order" WHERE "guideNumber" IS NOT NULL`);
      console.log(`  ✓ ${t.slug} — columnas listas · ${rows[0].n} pedido(s) con guia (backfill)`);
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
