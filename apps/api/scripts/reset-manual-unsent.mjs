/**
 * Deja el ULTIMO pedido MONTADO A MANO en estado "Sin enviar" para probar la
 * confirmacion de WhatsApp: borra addressStatus (nace 'confirmed' por diseño)
 * y cualquier evento wa_confirmation previo.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/reset-manual-unsent.mjs
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

  const ord = (await tdb.query(
    `SELECT id, "externalId", "customerName", "customerPhone", status, "addressStatus"
       FROM "Order" WHERE provider='manual' ORDER BY "receivedAt" DESC LIMIT 1`,
  )).rows[0];
  if (!ord) { console.log('No hay pedidos manuales.'); await tdb.end(); return; }
  console.log(`Pedido: ${ord.externalId} ${ord.customerName} tel=${ord.customerPhone} status=${ord.status} addressStatus=${ord.addressStatus}`);

  const ev = await tdb.query(`DELETE FROM "OrderEvent" WHERE "orderId"=$1 AND type='wa_confirmation'`, [ord.id]);
  await tdb.query(`UPDATE "Order" SET "addressStatus"=NULL, "addressConfirmedAt"=NULL, "confirmedAddress"=NULL WHERE id=$1`, [ord.id]);
  console.log(`Listo: addressStatus limpiado, ${ev.rowCount} evento(s) wa_confirmation borrados -> badge "Sin enviar".`);
  await tdb.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
