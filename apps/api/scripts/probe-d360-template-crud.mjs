/**
 * SOLO SONDEO — averigua COMO se crean/editan/borran plantillas en 360dialog.
 *
 * No toca ninguna plantilla real: todas las escrituras van contra un nombre que
 * no existe (`zzz_sonda_smartlogistica`). Lo que interesa de cada intento es el
 * CODIGO: 404 "no existe la plantilla" significa que la ruta es la buena; 404 de
 * ruta / 405 significa que la forma es otra.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-d360-template-crud.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const GHOST = 'zzz_sonda_smartlogistica';

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function try_(http, method, url, body) {
  try {
    const res = await http.request({ method, url, data: body });
    return `  ${method.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.data).slice(0, 220)}`;
  } catch (e) {
    return `  ${method.toUpperCase()} ${url} -> ${e.response?.status ?? 'ERR'} ${JSON.stringify(e.response?.data ?? e.message).slice(0, 300)}`;
  }
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
  const line = (await tdb.query(`SELECT label, provider, mode, "encryptedApiKey" FROM "WaLine" WHERE provider='dialog360' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  await tdb.end();
  if (!line) { console.log('No hay linea de 360dialog.'); return; }
  console.log(`Linea: ${line.label} (${line.provider}, ${line.mode})\n`);

  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 30000, validateStatus: () => true, headers: { 'D360-API-KEY': decField(line.encryptedApiKey, dek), 'Content-Type': 'application/json' } });
  http.defaults.validateStatus = (s) => s < 300;

  console.log('=== LISTADO CRUDO (una plantilla entera, para ver que campos trae) ===');
  const list = (await http.get('/v1/configs/templates', { params: { limit: 100 } })).data;
  const arr = list?.waba_templates ?? list?.templates ?? [];
  console.log(`total=${arr.length}  claves de la respuesta=${JSON.stringify(Object.keys(list ?? {}))}`);
  if (arr[0]) console.log(JSON.stringify(arr[0], null, 2).slice(0, 1200));
  console.log(`\nnombres: ${arr.map((x) => `${x.name}[${x.status}]`).join(', ')}`);

  console.log('\n=== BORRAR (nombre inexistente: no toca nada) ===');
  console.log(await try_(http, 'delete', `/v1/configs/templates/${GHOST}`));
  console.log(await try_(http, 'delete', `/v1/configs/templates?name=${GHOST}`));

  console.log('\n=== EDITAR (nombre/id inexistente) ===');
  const body = { components: [{ type: 'BODY', text: 'sonda' }] };
  console.log(await try_(http, 'patch', `/v1/configs/templates/${GHOST}`, body));
  console.log(await try_(http, 'put', `/v1/configs/templates/${GHOST}`, body));
  if (arr[0]?.id) console.log(await try_(http, 'patch', `/v1/configs/templates/${arr[0].id}xx`, body));

  console.log('\nListo. No se creo ni se borro ninguna plantilla real.');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
