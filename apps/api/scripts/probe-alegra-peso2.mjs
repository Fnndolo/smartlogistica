/**
 * SOLO LECTURA — sigue el rastro del peso perdido en la factura 1727:
 * pedido (precio VTEX) -> factura de Alegra (price/tax/total por item).
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-alegra-peso2.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const INVOICE_NUMBER = '1727';

function kekDec(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decF(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => ({ rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDec((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();
  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();

  const ev = (await tdb.query(
    `SELECT "orderId", data FROM "OrderEvent" WHERE type='invoiced' AND data->>'number' = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [INVOICE_NUMBER],
  )).rows[0];
  if (!ev) { console.log('No hay evento invoiced con ese numero'); await tdb.end(); return; }

  const order = (await tdb.query(
    `SELECT "externalId", provider, "warehouseId", "totalValue" FROM "Order" WHERE id=$1`,
    [ev.orderId],
  )).rows[0];
  const items = (await tdb.query(
    `SELECT name, quantity, "unitPrice" FROM "OrderItem" WHERE "orderId"=$1`,
    [ev.orderId],
  )).rows;
  console.log(`Pedido ${order.externalId} (${order.provider}) totalValue=${order.totalValue}`);
  for (const i of items) console.log(`  item "${i.name}" qty=${i.quantity} unitPrice=${i.unitPrice}`);

  const conn = (await tdb.query(
    `SELECT email, "encryptedToken" FROM "AlegraConnection" WHERE "warehouseId"=$1 LIMIT 1`,
    [order.warehouseId],
  )).rows[0];
  await tdb.end();

  const http = axios.create({ baseURL: 'https://api.alegra.com/api/v1', timeout: 25000, headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${conn.email}:${decF(conn.encryptedToken, dek)}`).toString('base64')}` } });
  const inv = (await http.get(`/invoices/${ev.data.id}`)).data;
  console.log(`\nFactura ${inv.numberTemplate?.fullNumber ?? inv.id}: total=${inv.total} subtotal=${inv.subtotal ?? '?'} tax=${JSON.stringify(inv.tax ?? null)}`);
  for (const it of inv.items ?? []) {
    console.log(`  item="${(it.name ?? '').slice(0, 45)}" price=${it.price} qty=${it.quantity}`);
    console.log(`    tax=${JSON.stringify(it.tax ?? [])} total(item)=${it.total ?? '?'}`);
  }
}
main().catch((e) => { console.error(e.response?.data ?? e.message); process.exit(1); });
