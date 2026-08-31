/**
 * Migracion aditiva: columna "primaryProduct" en "Order" — el producto CABEZA
 * del pedido (el primero alfabeticamente entre sus items).
 *
 * Existe para poder ORDENAR la tabla de pedidos por producto y ver juntos los
 * del mismo articulo: los items viven en "OrderItem" y Prisma no sabe ordenar
 * el padre por un campo de una relacion 1:N.
 *
 * Idempotente. Ademas hace BACKFILL de todos los pedidos ya existentes.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-primary-product.mjs
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
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "primaryProduct" TEXT;

-- El orden es por esta columna dentro de un scope (sede/estado): indice
-- compuesto para que Postgres no ordene la tabla entera en memoria.
CREATE INDEX IF NOT EXISTS "Order_warehouseId_primaryProduct_idx"
    ON "Order"("warehouseId", "primaryProduct");

-- Backfill: el primer item por nombre. MIN() basta y evita un DISTINCT ON.
UPDATE "Order" o
   SET "primaryProduct" = sub.name
  FROM (
    SELECT i."orderId", MIN(i.name) AS name
      FROM "OrderItem" i
     GROUP BY i."orderId"
  ) sub
 WHERE o.id = sub."orderId" AND o."primaryProduct" IS NULL;
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

  console.log(`Migrando "primaryProduct" en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)),
      ssl: pgSsl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS con, COUNT(*) FILTER (WHERE "primaryProduct" IS NULL)::int AS sin FROM "Order"`,
      );
      console.log(
        `  ✓ ${t.slug} — ${rows[0].con - rows[0].sin} pedido(s) con producto · ${rows[0].sin} sin items`,
      );
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
