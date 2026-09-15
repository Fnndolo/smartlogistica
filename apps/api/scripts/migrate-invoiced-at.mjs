/**
 * Order.invoicedAt: la fecha de FACTURACION, denormalizada para poder ordenar
 * Facturados por ella (Prisma no sabe ordenar por el maximo de una relacion).
 *
 * Es ADITIVA y por eso se corre ANTES de desplegar: una columna nueva que
 * admite null no le molesta al codigo viejo, que sencillamente la ignora. Al
 * reves — desplegar primero — el codigo nuevo pediria una columna que todavia
 * no existe y tumbaria la lista de pedidos.
 *
 * El relleno toma la fecha del PRIMER evento de cierre que tenga el pedido:
 *   invoiced (Alegra) · vtex_invoiced · vtex_invoiced_external · manual_completed
 * La primera, no la ultima: entre facturar en Alegra y cerrar en VTEX pasa un
 * minuto, y la que el equipo llama "fecha de facturacion" es la primera.
 *
 *   node --env-file=.env.local scripts/migrate-invoiced-at.mjs           -> SECO
 *   node --env-file=.env.local scripts/migrate-invoiced-at.mjs --apply
 */
import pg from 'pg';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

const CIERRES = ['invoiced', 'vtex_invoiced', 'vtex_invoiced_external', 'manual_completed'];

async function main() {
  const apply = process.argv.includes('--apply');

  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const tenants = (await control.query(
    `SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  )).rows;
  await control.end();

  for (const t of tenants) {
    console.log(`\n=== ${t.slug} (${t.dbName}) ===`);
    const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
    await db.connect();

    const tiene = (await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='Order' AND column_name='invoicedAt'`,
    )).rowCount > 0;
    console.log(`  columna invoicedAt: ${tiene ? 'ya existe' : 'NO existe'}`);

    const pendientes = (await db.query(
      `SELECT COUNT(*)::int n FROM "Order" o
       WHERE EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId"=o.id AND e.type = ANY($1))`,
      [CIERRES],
    )).rows[0].n;
    console.log(`  pedidos con evento de cierre: ${pendientes}`);

    if (!apply) {
      console.log('  SECO — usa --apply para escribir.');
      await db.end();
      continue;
    }

    if (!tiene) {
      await db.query(`ALTER TABLE "Order" ADD COLUMN "invoicedAt" TIMESTAMP(3)`);
      console.log('  + columna creada');
    }
    // CONCURRENTLY: la tabla de pedidos se lee constantemente y un indice
    // normal la bloquearia mientras se construye. No puede ir en transaccion.
    await db.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_invoicedAt_idx" ON "Order" ("invoicedAt" DESC)`);
    console.log('  + indice listo');

    const res = await db.query(
      `UPDATE "Order" o SET "invoicedAt" = e.primera
       FROM (
         SELECT "orderId", MIN("createdAt") AS primera
         FROM "OrderEvent" WHERE type = ANY($1) GROUP BY "orderId"
       ) e
       WHERE o.id = e."orderId" AND o."invoicedAt" IS NULL`,
      [CIERRES],
    );
    console.log(`  + rellenados: ${res.rowCount}`);

    const q = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE "invoicedAt" IS NOT NULL)::int con,
              COUNT(*) FILTER (WHERE "invoicedAt" IS NULL)::int sin,
              MIN("invoicedAt") desde, MAX("invoicedAt") hasta
       FROM "Order"`,
    )).rows[0];
    console.log(`  resultado: ${q.con} con fecha · ${q.sin} sin fecha`);
    console.log(`  rango: ${q.desde?.toISOString?.() ?? '-'} .. ${q.hasta?.toISOString?.() ?? '-'}`);
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
