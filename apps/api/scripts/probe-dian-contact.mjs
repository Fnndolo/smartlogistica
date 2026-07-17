/**
 * PRUEBA — valida la transformacion DIAN por IA + que Alegra acepte un contacto
 * con datos completos (email, telefono, direccion DIAN como objeto).
 * Actualiza el contacto de PRUEBA (4868). Solo un contacto de prueba.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-dian-contact.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const TEST_CONTACT_ID = '4868';
const SAMPLES = ['Carrera 7b # 31c - 47, Ana María', 'Cll 45 sur # 12-30 Apto 502 Torre 3', 'Av 68 # 100-25', 'Diagonal 25 A # 4-15 Barrio Centro'];

function kekDec(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decF(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

const dianPrompt = (address) =>
  'Convierte esta direccion colombiana a NOMENCLATURA DIAN reemplazando el tipo de via por su CODIGO: ' +
  'AC=Avenida calle, AK=Avenida carrera, AV=Avenida, CL=Calle, CR=Carrera, DG=Diagonal, TV=Transversal, ' +
  'MZ=Manzana, BL=Bloque, TO=Torre, AP=Apartamento, IN=Interior, BRR=Barrio, ET=Etapa, UR=Unidad residencial. ' +
  'Reconoce variantes (Carrera/Cra/Kra->CR, Calle/Cll->CL, Avenida/Av->AV, Apto->AP). Manten numeros y #. ' +
  'MAYUSCULAS. Responde SOLO la direccion transformada en una linea.\nDireccion: ' + address;

async function aiText(provider, apiKey, model, prompt) {
  if (provider === 'openai') {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', { model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000 });
    return r.data?.choices?.[0]?.message?.content ?? '';
  }
  if (provider === 'gemini') {
    const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { contents: [{ parts: [{ text: prompt }] }] }, { params: { key: apiKey }, timeout: 20000 });
    return (r.data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
  // anthropic
  const r = await axios.post('https://api.anthropic.com/v1/messages', { model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 20000 });
  return (r.data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

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
  const alegra = (await tdb.query(`SELECT email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();

  // 1. DIAN por IA.
  console.log('=== DIAN por IA ===');
  if (!ai) { console.log('No hay conexion IA.'); }
  else {
    const apiKey = decF(ai.encryptedApiKey, dek);
    console.log(`Proveedor: ${ai.provider} modelo: ${ai.model}\n`);
    for (const s of SAMPLES) {
      try {
        const out = (await aiText(ai.provider, apiKey, ai.model, dianPrompt(s))).trim().split(/[\n\r]/)[0].trim();
        console.log(`  "${s}"\n   -> "${out}"`);
      } catch (e) { console.log(`  "${s}" -> ERROR ${e.response?.status ?? e.message}`); }
    }
  }

  // 2. Contacto completo en Alegra.
  console.log('\n=== Contacto completo en Alegra (update 4868) ===');
  const token = decF(alegra.encryptedToken, dek);
  const http = axios.create({ baseURL: 'https://api.alegra.com/api/v1', timeout: 20000, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${alegra.email}:${token}`).toString('base64')}` } });
  // A. Ver la direccion de contactos reales creados por Kupo (formato que SI sirve).
  for (const id of ['24675', '24674', '24673']) {
    try {
      const c = (await http.get(`/contacts/${id}`)).data;
      console.log(`  real ${id}: address=${JSON.stringify(c.address)} email=${JSON.stringify(c.email)} phonePrimary=${JSON.stringify(c.phonePrimary)}`);
    } catch (e) { console.log(`  real ${id}: error ${e.response?.status}`); }
  }

  // B. Contacto real completo (para ver estructura de creacion).
  console.log('\n  Contacto real 24675 completo:');
  const full = (await http.get('/contacts/24675')).data;
  console.log(JSON.stringify({
    type: full.type, kindOfPerson: full.kindOfPerson, regime: full.regime,
    identification: full.identification, identificationObject: full.identificationObject,
    fiscalResponsabilities: full.fiscalResponsabilities, nameObject: full.nameObject,
  }, null, 2));

  // C. CREATE con estructura correcta (nameObject + kindOfPerson + regime + identificationObject).
  console.log('\n  CREATE correcto:');
  const nameObject = { firstName: 'MARIA', secondName: 'DEL MAR', lastName: 'DUQUE', secondLastName: 'SOLARTE' };
  const cases = [
    ['con address city+dept', { name: 'MARIA DEL MAR DUQUE SOLARTE', nameObject, identification: '1000000030', identificationObject: { type: 'CC', number: '1000000030' }, kindOfPerson: 'PERSON_ENTITY', regime: 'SIMPLIFIED_REGIME', type: ['client'], email: 'prueba.sl@gmail.com', phonePrimary: '+573001234567', address: { address: 'CR 7B # 31C - 47 ANA MARIA', city: 'Buga', department: 'Valle del Cauca' } }],
    ['address solo street', { name: 'MARIA DEL MAR DUQUE SOLARTE', nameObject, identification: '1000000031', identificationObject: { type: 'CC', number: '1000000031' }, kindOfPerson: 'PERSON_ENTITY', regime: 'SIMPLIFIED_REGIME', type: ['client'], email: 'prueba.sl@gmail.com', phonePrimary: '+573001234567', address: { address: 'CR 7B # 31C - 47 ANA MARIA' } }],
    ['sin address', { name: 'MARIA DEL MAR DUQUE SOLARTE', nameObject, identification: '1000000032', identificationObject: { type: 'CC', number: '1000000032' }, kindOfPerson: 'PERSON_ENTITY', regime: 'SIMPLIFIED_REGIME', type: ['client'], email: 'prueba.sl@gmail.com', phonePrimary: '+573001234567' }],
  ];
  for (const [label, body] of cases) {
    try {
      const created = (await http.post('/contacts', body)).data;
      const c = (await http.get(`/contacts/${created.id}`)).data;
      console.log(`  ✔ ${label}: id=${created.id} email=${c.email} phone=${c.phonePrimary} address=${JSON.stringify(c.address)}`);
    } catch (e) { console.log(`  ✗ ${label}: ${e.response?.status} ${JSON.stringify(e.response?.data ?? e.message)}`); }
  }

  console.log('\nListo.');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
