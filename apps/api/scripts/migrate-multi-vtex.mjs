/**
 * Migracion para soportar VARIAS cuentas de VTEX conectadas a la vez.
 *
 * Tres cosas, todas idempotentes:
 *
 * 1. "MarketplaceConnection"."label" — nombre visible de la tienda. Sin el, dos
 *    VTEX se ven identicos en la UI y en las pestañas de pedidos.
 *
 * 2. La clave unica de "Order" pasa de (provider, externalId) a
 *    (provider, accountName, externalId). El orderId de VTEX solo es unico
 *    DENTRO de una tienda: con dos cuentas, el upsert del pedido de la segunda
 *    pisaba al de la primera. Antes de crear el indice se comprueba que no haya
 *    duplicados (no puede haberlos: el unique viejo lo impedia).
 *
 * 3. Se limpian los WebhookEvent de VTEX cuyo eventId no lleva la cuenta.
 *    El id paso a ser "<cuenta>__<OrderId>__<State>__<LastChange>"; los viejos
 *    ya estan procesados y solo servirian para deduplicar contra si mismos.
 *    NO se borran: se dejan tal cual (son historial). Aqui solo se informa.
 *
 * OJO: correr con la ingesta PAUSADA (o fuera de hora). El indice se crea
 * CONCURRENTLY, que no puede ir dentro de una transaccion.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-multi-vtex.mjs
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

const OLD_INDEX = 'Order_provider_externalId_key';
const NEW_INDEX = 'Order_provider_accountName_externalId_key';

async function migrateTenant(db, slug) {
  // 1. Nombre visible de la conexion.
  await db.query(`ALTER TABLE "MarketplaceConnection" ADD COLUMN IF NOT EXISTS "label" TEXT;`);

  // 2. Clave del pedido con la cuenta.
  const dup = await db.query(`
    SELECT provider, "externalId", COUNT(*)::int AS n
      FROM "Order"
     GROUP BY provider, "externalId"
    HAVING COUNT(*) > 1
     LIMIT 5;
  `);
  if (dup.rows.length > 0) {
    throw new Error(
      `hay ${dup.rows.length}+ (provider, externalId) duplicados; revisar a mano antes de migrar`,
    );
  }

  // CONCURRENTLY: no bloquea escrituras. No puede ir en transaccion.
  await db.query(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${NEW_INDEX}"
        ON "Order"("provider", "accountName", "externalId");
  `);
  await db.query(`DROP INDEX IF EXISTS "${OLD_INDEX}";`);

  // 3. Informe de eventos con el id viejo (sin cuenta). Solo lectura.
  const olds = await db.query(
    `SELECT COUNT(*)::int AS n FROM "WebhookEvent" WHERE provider = 'vtex' AND "eventId" NOT LIKE '%\_\_%\_\_%\_\_%'`,
  );
  const conns = await db.query(
    `SELECT COUNT(*)::int AS n FROM "MarketplaceConnection" WHERE provider = 'vtex'`,
  );
  return { oldEvents: olds.rows[0].n, vtexConns: conns.rows[0].n };
}

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

  console.log(`Preparando multi-VTEX en ${tenants.length} tenant(s)...\n`);
  let bad = 0;
  for (const t of tenants) {
    const db = new Client({
      connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)),
      ssl: pgSsl(),
    });
    try {
      await db.connect();
      const r = await migrateTenant(db, t.slug);
      console.log(
        `  ✓ ${t.slug} — clave de pedido por cuenta · ${r.vtexConns} conexion(es) VTEX · ${r.oldEvents} evento(s) con id viejo (historial, se dejan)`,
      );
    } catch (err) {
      bad++;
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log(bad === 0 ? '\nListo.' : `\nTerminado con ${bad} fallo(s).`);
  if (bad > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
