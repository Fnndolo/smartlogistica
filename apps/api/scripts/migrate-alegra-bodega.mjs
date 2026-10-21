/**
 * Migracion aditiva: "Warehouse"."alegraBodega".
 *
 * La bodega de Alegra desde la que factura cada sede. Sin ella la factura no
 * lleva bodega y Alegra usa la predeterminada de la empresa: un producto que
 * solo existe en otra bodega se rechaza ("No se encontró el ítem ... en la
 * bodega", code 3095) — asi paso con PEDIDOS PEREIRA, que factura en la
 * empresa de Pasto desde "Bodega Pereira" — y uno que existe en las dos se
 * descuenta del inventario de otra sede.
 *
 * Idempotente. No toca ningun dato: la columna nace vacia y con eso el
 * comportamiento es exactamente el de hoy. Se corre ANTES de desplegar: una
 * columna nueva que admite null no le molesta al codigo viejo.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-alegra-bodega.mjs
 */
import pg from 'pg';

const { Client } = pg;

const stripSsl = (url) => {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return u.toString();
};
const pgSsl = () =>
  (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (url, db) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const DDL = `ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "alegraBodega" JSONB;`;

async function main() {
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const tenants = (
    await control.query(`SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`)
  ).rows;
  await control.end();

  for (const t of tenants) {
    const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
    try {
      await db.connect();
      await db.query(DDL);
      const { rows } = await db.query(`SELECT COUNT(*)::int n FROM "Warehouse" WHERE "alegraBodega" IS NOT NULL`);
      console.log(`  ✓ ${t.slug} — columna lista · ${rows[0].n} sede(s) con bodega`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
