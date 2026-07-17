/**
 * SOLO LECTURA — para corregir los datos del cliente en la factura:
 *   1. rawPayload de un pedido VTEX: encuentra dónde estan el email/telefono/
 *      direccion correctos (clientProfileData, shippingData, openTextField, notas).
 *   2. Un contacto real de Alegra (GET /contacts/{id}): estructura de address/email/phone.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-order-contact.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const SAMPLE_CONTACT_ID = '4868';

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

// Camina el objeto buscando strings con '@' (emails) y anota su path.
function findEmails(obj, path = '', out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') { if (/@/.test(obj) && obj.length < 120) out.push({ path, value: obj }); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => findEmails(v, `${path}[${i}]`, out)); return out; }
  if (typeof obj === 'object') for (const [k, v] of Object.entries(obj)) findEmails(v, path ? `${path}.${k}` : k, out);
  return out;
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

  // 1. rawPayload de un pedido (preferir uno asignado a sede).
  const ord = (await tdb.query(
    `SELECT "externalId", "customerName", "customerEmail", "customerPhone", "rawPayload"
       FROM "Order" ORDER BY ("warehouseId" IS NULL) ASC, "receivedAt" DESC LIMIT 1`,
  )).rows[0];
  const conn = (await tdb.query(`SELECT email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();

  console.log('=== PEDIDO ===');
  console.log(`externalId=${ord.externalId} customerName=${ord.customerName}`);
  console.log(`customerEmail (guardado)=${ord.customerEmail}  customerPhone=${ord.customerPhone}\n`);

  const raw = ord.rawPayload ?? {};
  console.log('clientProfileData:', JSON.stringify(raw.clientProfileData ?? null, null, 2));
  console.log('\nshippingData.address:', JSON.stringify(raw.shippingData?.address ?? null, null, 2));
  console.log('\nopenTextField:', JSON.stringify(raw.openTextField ?? null));
  console.log('marketplace:', JSON.stringify(raw.marketplace ?? null));
  const emails = findEmails(raw);
  console.log('\nTodos los strings con "@" (candidatos a email real):');
  for (const e of emails) console.log(`  ${e.path} = ${e.value}`);
  console.log('\ntop-level keys del rawPayload:', Object.keys(raw).join(', '));

  // 2. Contacto real de Alegra.
  console.log('\n\n=== CONTACTO ALEGRA (estructura) ===');
  const token = decField(conn.encryptedToken, dek);
  const http = axios.create({ baseURL: 'https://api.alegra.com/api/v1', timeout: 20000, headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}` } });
  try {
    const c = (await http.get(`/contacts/${SAMPLE_CONTACT_ID}`)).data;
    console.log('keys:', Object.keys(c).join(', '));
    console.log('address:', JSON.stringify(c.address, null, 2));
    console.log('email:', JSON.stringify(c.email));
    console.log('phonePrimary:', JSON.stringify(c.phonePrimary), 'mobile:', JSON.stringify(c.mobile));
    console.log('identification:', JSON.stringify(c.identification), 'identificationObject:', JSON.stringify(c.identificationObject));
  } catch (e) { console.log('error contacto:', e.response?.status, e.response?.data ?? e.message); }

  console.log('\nListo (solo lectura).');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
