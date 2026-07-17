/**
 * PRUEBA end-to-end del flujo corregido: DIAN por IA -> crear contacto con datos
 * completos (nameObject/email/telefono/direccion DIAN) -> factura pagada (ADDI) ->
 * cerrada. Usa datos reales del pedido de muestra + cedula de prueba fresca.
 * Crea contacto + factura de PRUEBA reales (anulables).
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const TEST_ITEM_ID = '998';
const client = {
  name: 'MARIA DEL MAR DUQUE SOLARTE', firstName: 'Maria del mar', lastName: 'Duque solarte',
  identification: '1000000098', email: 'SOLARTESOLARTE002@GMAIL.COM', phone: '+573137097919',
  address: { street: 'Carrera 7b # 31c - 47, Ana María', city: 'Guadalajara De Buga', department: 'VALLE DEL CAUCA', zipCode: '76111' },
};
const stripCo = (p) => (p || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');

function kekDec(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decF(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const titleCase = (v) => !v ? v : v.toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => (i > 0 && ['de','del','la','las','los','y'].includes(w)) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
function nameObj(fn, ln) { const f=(fn||'').toUpperCase().split(/\s+/).filter(Boolean), l=(ln||'').toUpperCase().split(/\s+/).filter(Boolean); return { firstName:f[0]||'.', secondName:f.slice(1).join(' '), lastName:l[0]||'.', secondLastName:l.slice(1).join(' ') }; }
const dianPrompt = (a) => 'Convierte a NOMENCLATURA DIAN reemplazando el tipo de via por su codigo (Carrera/Cra/Kra->CR, Calle/Cll->CL, Avenida/Av->AV, Diagonal->DG, Transversal->TV, Manzana->MZ, Apartamento/Apto->AP, Torre->TO, Bloque->BL, Barrio->BRR). Manten numeros y #. MAYUSCULAS. Responde SOLO la direccion en una linea.\nDireccion: ' + a;

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDec((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();
  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const ai = (await tdb.query(`SELECT provider, model, "encryptedApiKey" FROM "AiConnection" LIMIT 1`)).rows[0];
  const al = (await tdb.query(`SELECT email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();

  const http = axios.create({ baseURL: 'https://api.alegra.com/api/v1', timeout: 25000, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${al.email}:${decF(al.encryptedToken, dek)}`).toString('base64')}` } });

  // 1. DIAN por IA.
  let dianStreet = client.address.street;
  if (ai) {
    const key = decF(ai.encryptedApiKey, dek);
    try {
      const r = await axios.post('https://api.anthropic.com/v1/messages', { model: ai.model, max_tokens: 200, messages: [{ role: 'user', content: dianPrompt(client.address.street) }] }, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 20000 });
      dianStreet = (r.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim().split(/[\n\r]/)[0].trim();
    } catch (e) { console.log('DIAN fallo, uso raw:', e.message); }
  }
  console.log(`Direccion: "${client.address.street}" -> DIAN "${dianStreet}"`);

  // 2. Contacto (find/create).
  let clientId;
  const found = (await http.get('/contacts', { params: { identification: client.identification, limit: 1 } })).data;
  const fl = Array.isArray(found) ? found : found.data ?? [];
  if (fl[0]) { clientId = fl[0].id; console.log(`Contacto existente id=${clientId}`); }
  else {
    const created = (await http.post('/contacts', {
      name: client.name, nameObject: nameObj(client.firstName, client.lastName),
      identification: client.identification, identificationObject: { type: 'CC', number: client.identification },
      kindOfPerson: 'PERSON_ENTITY', regime: 'SIMPLIFIED_REGIME', type: ['client'],
      email: client.email, phonePrimary: stripCo(client.phone),
      address: { address: dianStreet, city: client.address.city, department: titleCase(client.address.department), country: 'Colombia', zipCode: client.address.zipCode },
    })).data;
    clientId = created.id;
    const c = (await http.get(`/contacts/${clientId}`)).data;
    console.log(`Contacto CREADO id=${clientId} email=${c.email} phone=${c.phonePrimary} address=${JSON.stringify(c.address)}`);
  }

  // 3. Item + ADDI + factura.
  const price = (() => { const p = (i => Array.isArray(i) ? (i.find(x => String(x.idPriceList)==='1')??i[0])?.price : i)((async()=>{})()); return 70000; })();
  const item = (await http.get(`/items/${TEST_ITEM_ID}`)).data;
  const salePrice = Array.isArray(item.price) ? Number((item.price.find(x => String(x.idPriceList)==='1')??item.price[0])?.price ?? 70000) : Number(item.price ?? 70000);
  const accounts = (await http.get('/bank-accounts')).data ?? [];
  const addi = (Array.isArray(accounts) ? accounts : accounts.data ?? []).find(a => /marketplace\s*addi|(^|\s)addi(\s|$)/i.test(a.name ?? ''));
  const today = new Date().toISOString().slice(0, 10);
  try {
    const inv = (await http.post('/invoices', {
      date: today, dueDate: today, client: { id: clientId },
      anotation: 'ADDI',
      items: [{ id: TEST_ITEM_ID, price: salePrice, quantity: 1, description: '353912100000000\n356938035643809' }],
      payments: [{ date: today, account: { id: addi.id }, amount: salePrice, paymentMethod: 'transfer' }],
    })).data;
    const full = (await http.get(`/invoices/${inv.id}`)).data;
    console.log(`\n✔ FACTURA: number=${full.numberTemplate?.fullNumber} status=${full.status} balance=${full.balance}`);
    console.log(`   anotation=${JSON.stringify(full.anotation)} annotation=${JSON.stringify(full.annotation)}`);
    console.log(`   item[0].description=${JSON.stringify(full.items?.[0]?.description)}`);
    console.log('  (PRUEBA real — anula la factura y borra el contacto de prueba)');
  } catch (e) { console.log('\n✗ error factura:', e.response?.status, JSON.stringify(e.response?.data ?? e.message)); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
