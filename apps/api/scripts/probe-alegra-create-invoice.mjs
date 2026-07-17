/**
 * PRUEBA REAL — crea UNA factura de venta de prueba en Alegra para validar todo
 * el flujo (contacto find/create + cuenta MARKETPLACE ADDI + pago -> cerrada).
 * El user autorizo facturas de prueba reales (no son electronicas, se anulan).
 * Usa un item barato real y un contacto de prueba. Imprime el resultado.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-alegra-create-invoice.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const TEST_ITEM_ID = '998'; // RELOJ SMART WATCH (item real barato, visto en facturas reales)
const TEST_CLIENT = { name: 'PRUEBA SMARTLOGISTICA', identification: '1111111111' };

function kekDecrypt(blob, kek) {
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function decryptField(blob, dek) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

function itemSalePrice(raw) {
  const p = raw?.price;
  if (p == null) return null;
  if (Array.isArray(p)) { const c = p.find((x) => String(x.idPriceList) === '1') ?? p[0]; return c?.price != null ? Number(c.price) : null; }
  return Number(p);
}

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const conn = (await tdb.query(`SELECT email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();
  const token = decryptField(conn.encryptedToken, dek);

  const http = axios.create({
    baseURL: 'https://api.alegra.com/api/v1', timeout: 25000,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}` },
  });

  // 1. Item + precio.
  const item = (await http.get(`/items/${TEST_ITEM_ID}`)).data;
  const price = itemSalePrice(item) ?? 50000;
  console.log(`Item: ${item.name} (id=${item.id}) precio=${price}`);

  // 2. Cuenta ADDI.
  const accounts = (await http.get('/bank-accounts')).data ?? [];
  const addi = (Array.isArray(accounts) ? accounts : accounts.data ?? []).find((a) => /marketplace\s*addi|(^|\s)addi(\s|$)/i.test(a.name ?? ''));
  console.log(`Cuenta ADDI: id=${addi?.id} name=${addi?.name}`);
  if (!addi) { console.log('No hay cuenta ADDI'); return; }

  // 3. Contacto (find/create).
  let clientId;
  const found = (await http.get('/contacts', { params: { identification: TEST_CLIENT.identification, limit: 1 } })).data;
  const foundList = Array.isArray(found) ? found : found.data ?? [];
  if (foundList[0]) { clientId = foundList[0].id; console.log(`Contacto existente id=${clientId}`); }
  else {
    const created = (await http.post('/contacts', { ...TEST_CLIENT, type: ['client'] })).data;
    clientId = created.id; console.log(`Contacto creado id=${clientId}`);
  }

  // 4. Factura con pago -> cerrada.
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    date: today, dueDate: today,
    client: { id: clientId },
    items: [{ id: TEST_ITEM_ID, price, quantity: 1, description: 'PRUEBA IMEI 000000000000000' }],
    payments: [{ date: today, account: { id: addi.id }, amount: price, paymentMethod: 'transfer' }],
  };
  console.log('\nPOST /invoices body:', JSON.stringify(body));
  try {
    const inv = (await http.post('/invoices', body)).data;
    console.log(`\n✔ FACTURA CREADA: number=${inv.numberTemplate?.fullNumber ?? inv.id} id=${inv.id} status=${inv.status} total=${inv.total} balance=${inv.balance}`);
    console.log('   (factura de PRUEBA real — anulala en Alegra)');
  } catch (e) {
    console.log('\n✗ ERROR creando factura:', e.response?.status);
    console.log(JSON.stringify(e.response?.data ?? e.message, null, 2));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
