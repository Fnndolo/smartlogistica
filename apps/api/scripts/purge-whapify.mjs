/**
 * PURGA de Whapify: imprime el createdAt de la conexion (pasa a ser la
 * constante WA_CONFIRMATION_SINCE en orders.service — desde esa fecha los
 * pedidos sin confirmacion muestran "Sin enviar") y borra la fila.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/purge-whapify.mjs
 */
import pg from 'pg';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  await control.end();

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const rows = (await tdb.query(`SELECT "createdAt" FROM "WhapifyConnection"`)).rows;
  for (const r of rows) console.log(`WhapifyConnection.createdAt = ${r.createdAt.toISOString()}`);
  const del = await tdb.query(`DELETE FROM "WhapifyConnection"`);
  console.log(`Filas borradas: ${del.rowCount}. Whapify fuera.`);
  await tdb.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
