/**
 * SOLO LECTURA — inspecciona el Alegra real del tenant (via la AlegraConnection):
 *   1. Facturas de venta recientes + detalle (client, items, payments, status).
 *   2. Cuentas bancarias (para encontrar "marketplace addi").
 * Con esto se clava el formato exacto para POST /invoices con pago. NO crea nada.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-alegra-invoice.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;

function kekDecrypt(blob, kek) {
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function decryptField(blob, dek) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
const stripSslMode = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminUrlForDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSslMode(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dekRow = (await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0];
  await control.end();
  const dek = kekDecrypt(dekRow.wrappedDek, kek);

  const tdb = new Client({ connectionString: stripSslMode(adminUrlForDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const conn = (await tdb.query(`SELECT "warehouseId", email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();
  if (!conn) { console.log('Sin conexion Alegra.'); return; }
  const token = decryptField(conn.encryptedToken, dek);

  const http = axios.create({
    baseURL: 'https://api.alegra.com/api/v1',
    timeout: 20000,
    headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}` },
  });

  // 1. Cuentas bancarias.
  console.log('=== CUENTAS BANCARIAS (buscando "addi") ===');
  try {
    const accts = (await http.get('/bank-accounts')).data ?? [];
    for (const a of (Array.isArray(accts) ? accts : accts.data ?? [])) {
      console.log(`  id=${a.id}  name=${JSON.stringify(a.name)}  type=${a.type ?? ''}`);
    }
  } catch (e) { console.log('  error bank-accounts:', e.response?.status, e.response?.data ?? e.message); }

  // 2. Facturas de venta recientes.
  console.log('\n=== FACTURAS DE VENTA recientes ===');
  let list = [];
  try {
    const res = await http.get('/invoices', { params: { limit: 8, order_field: 'date', order_direction: 'DESC' } });
    list = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  } catch (e) { console.log('  error /invoices:', e.response?.status, e.response?.data ?? e.message); }
  console.log(`  ${list.length} facturas.`);

  // 3. Detalle de las primeras (estructura + pago).
  for (const inv of list.slice(0, 3)) {
    let d;
    try { d = (await http.get(`/invoices/${inv.id}`)).data; }
    catch (e) { console.log(`  inv ${inv.id}: error ${e.response?.status}`); continue; }
    console.log('\n────────────────────────────────────────');
    console.log(`Factura id=${d.id} number=${d.numberTemplate?.fullNumber ?? '?'} date=${d.date} status=${d.status} total=${d.total} balance=${d.balance}`);
    console.log(`  keys: ${Object.keys(d).join(', ')}`);
    console.log(`  client: ${JSON.stringify({ id: d.client?.id, name: d.client?.name, identification: d.client?.identification })}`);
    if (d.seller) console.log(`  seller: ${JSON.stringify({ id: d.seller?.id, name: d.seller?.name })}`);
    if (d.priceList) console.log(`  priceList: ${JSON.stringify(d.priceList)}`);
    if (d.warehouse) console.log(`  warehouse: ${JSON.stringify(d.warehouse)}`);
    console.log('  items:');
    for (const it of d.items ?? []) {
      console.log(`    id=${it.id} name=${JSON.stringify(it.name)} price=${it.price} quantity=${it.quantity}`);
    }
    console.log('  payments:');
    for (const p of d.payments ?? []) {
      console.log(`    id=${p.id} date=${p.date} amount=${p.amount} paymentMethod=${JSON.stringify(p.paymentMethod)} account=${JSON.stringify(p.account ?? p.bankAccount)}`);
    }
    if (!(d.payments ?? []).length) console.log('    (sin pagos en el detalle)');
  }

  console.log('\nListo (solo lectura).');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
