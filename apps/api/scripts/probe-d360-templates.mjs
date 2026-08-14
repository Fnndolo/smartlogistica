/**
 * SOLO LECTURA — verifica la conexion de PRODUCCION de 360dialog:
 *   1. Descifra el API key guardado (envelope KEK->DEK->campo).
 *   2. GET /v1/configs/webhook  -> confirma que el webhook apunta a la plataforma.
 *   3. GET /v1/configs/templates -> lista las plantillas de la WABA (nombre,
 *      idioma, categoria, estado, cuerpo, botones) para reutilizar las de Meta.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-d360-templates.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const conn = (await tdb.query(`SELECT "encryptedApiKey", mode, "webhookUrl", status, "createdAt" FROM "Dialog360Connection" LIMIT 1`)).rows[0];
  await tdb.end();
  if (!conn) { console.log('No hay conexion 360dialog guardada.'); return; }

  console.log(`=== CONEXION === mode=${conn.mode} status=${conn.status} createdAt=${conn.createdAt?.toISOString?.() ?? conn.createdAt}`);
  console.log(`webhookUrl guardado: ${conn.webhookUrl}`);

  const apiKey = decField(conn.encryptedApiKey, dek);
  const base = conn.mode === 'sandbox' ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
  const http = axios.create({ baseURL: base, timeout: 30000, headers: { 'D360-API-KEY': apiKey } });

  console.log('\n=== WEBHOOK (segun 360dialog) ===');
  try {
    const w = (await http.get('/v1/configs/webhook')).data;
    console.log(JSON.stringify(w, null, 2));
  } catch (e) { console.log('error webhook:', e.response?.status, JSON.stringify(e.response?.data ?? e.message)); }

  console.log('\n=== PLANTILLAS DE LA WABA ===');
  try {
    const res = (await http.get('/v1/configs/templates', { params: { limit: 50 } })).data;
    const list = res?.waba_templates ?? res?.templates ?? (Array.isArray(res) ? res : []);
    console.log(`total reportado: ${res?.total ?? res?.count ?? list.length}`);
    for (const tpl of list) {
      console.log(`\n--- ${tpl.name}  [${tpl.language}]  categoria=${tpl.category}  estado=${tpl.status}`);
      if (tpl.rejected_reason && tpl.rejected_reason !== 'NONE') console.log(`  rechazo: ${tpl.rejected_reason}`);
      for (const comp of tpl.components ?? []) {
        if (comp.type === 'BODY') console.log(`  BODY: ${JSON.stringify(comp.text)}`);
        else if (comp.type === 'HEADER') console.log(`  HEADER (${comp.format}): ${JSON.stringify(comp.text ?? '')}`);
        else if (comp.type === 'FOOTER') console.log(`  FOOTER: ${JSON.stringify(comp.text)}`);
        else if (comp.type === 'BUTTONS') console.log(`  BOTONES: ${JSON.stringify((comp.buttons ?? []).map((b) => `${b.type}:${b.text}`))}`);
        else console.log(`  ${comp.type}: ${JSON.stringify(comp).slice(0, 200)}`);
      }
    }
    if (!list.length) console.log('(la respuesta cruda fue:', JSON.stringify(res).slice(0, 800), ')');
  } catch (e) { console.log('error plantillas:', e.response?.status, JSON.stringify(e.response?.data ?? e.message)); }

  console.log('\nListo (solo lectura).');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
