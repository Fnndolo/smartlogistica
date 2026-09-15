/**
 * Order.packedAt / packedById / packedByName: la marca de EMPACADO.
 *
 * Va aparte de `status` a proposito: ese campo lo sobrescribe la sincronizacion
 * de VTEX con lo que diga el marketplace, asi que un estado "empacado" ahi
 * dentro se borraria solo y de forma intermitente — el peor tipo de fallo.
 *
 * ADITIVA: columnas nuevas que admiten null. Se corre ANTES de desplegar; al
 * reves, el codigo nuevo pediria columnas que no existen y tumbaria la lista.
 * No hay nada que rellenar: antes de esto nadie habia marcado nada.
 *
 *   node --env-file=.env.local scripts/migrate-packed.mjs           -> SECO
 *   node --env-file=.env.local scripts/migrate-packed.mjs --apply
 */
import pg from 'pg';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

const COLUMNAS = [
  ['packedAt', 'TIMESTAMP(3)'],
  ['packedById', 'TEXT'],
  ['packedByName', 'TEXT'],
];

async function main() {
  const apply = process.argv.includes('--apply');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const tenants = (await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  )).rows;
  await control.end();

  for (const t of tenants) {
    console.log(`\n=== ${t.slug} ===`);
    const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
    await db.connect();
    for (const [col, tipo] of COLUMNAS) {
      const hay = (await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='Order' AND column_name=$1`, [col],
      )).rowCount > 0;
      if (hay) { console.log(`  ${col}: ya existe`); continue; }
      if (!apply) { console.log(`  ${col}: se crearia (${tipo})`); continue; }
      await db.query(`ALTER TABLE "Order" ADD COLUMN "${col}" ${tipo}`);
      console.log(`  + ${col} creada`);
    }
    if (apply) {
      // CONCURRENTLY: la tabla de pedidos se lee sin parar y un indice normal
      // la bloquearia mientras se construye.
      await db.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_packedAt_idx" ON "Order" ("packedAt")`);
      console.log('  + indice listo');
      const q = (await db.query(`SELECT COUNT(*) FILTER (WHERE "packedAt" IS NOT NULL)::int n FROM "Order"`)).rows[0];
      console.log(`  pedidos marcados como empacados: ${q.n}`);
    } else {
      console.log('  SECO — usa --apply para escribir.');
    }
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
