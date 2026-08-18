/**
 * SOLO LECTURA — patron del peso perdido: ultimos eventos 'invoiced' vs
 * totalValue e items (con decimales) del pedido.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-alegra-peso3.mjs
 */
import pg from 'pg';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await control.connect();
  const t = (await control.query(`SELECT "dbName" FROM "Tenant" WHERE status='ACTIVE' LIMIT 1`)).rows[0];
  await control.end();
  const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const evs = (await db.query(
    `SELECT e."orderId", e.data, e."createdAt" FROM "OrderEvent" e WHERE e.type='invoiced' ORDER BY e."createdAt" DESC LIMIT 15`,
  )).rows;
  for (const e of evs) {
    const o = (await db.query(`SELECT "externalId", provider, "totalValue" FROM "Order" WHERE id=$1`, [e.orderId])).rows[0];
    const items = (await db.query(`SELECT name, quantity, "unitPrice" FROM "OrderItem" WHERE "orderId"=$1`, [e.orderId])).rows;
    const factTotal = Number(e.data?.total ?? NaN);
    const orderTotal = Number(o?.totalValue ?? NaN);
    const flag = Number.isFinite(factTotal) && Number.isFinite(orderTotal) && factTotal !== orderTotal ? '  <-- DIFERENCIA' : '';
    console.log(`${o?.externalId} (${o?.provider}) factura#${e.data?.number} facturado=${factTotal} pedido=${orderTotal}${flag}`);
    for (const i of items) console.log(`    "${i.name.slice(0, 50)}" qty=${i.quantity} unitPrice=${i.unitPrice}`);
  }
  await db.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
