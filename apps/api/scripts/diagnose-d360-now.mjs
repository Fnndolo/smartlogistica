/**
 * DIAGNOSTICO URGENTE, SOLO LECTURA. Que dice 360dialog AHORA MISMO:
 *   1. Que webhook tiene registrado (si esta vacio, por eso no entra nada).
 *   2. Que plantillas ve (si estan en 0, la WABA cambio o se vaciaron).
 *   3. Si nuestra API key guardada sigue sirviendo.
 * No escribe NADA, ni en la base ni en 360dialog.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/diagnose-d360-now.mjs
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
  const t = (await control.query(`SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();
  console.log(`Tenant: ${t.slug}\n`);

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const lines = (await tdb.query(`SELECT id, label, provider, mode, status, "webhookUrl", "encryptedApiKey", "createdAt" FROM "WaLine" ORDER BY "createdAt" ASC`)).rows;
  console.log('=== LINEAS EN NUESTRA BASE ===');
  for (const l of lines) console.log(`  ${l.label} [${l.provider}/${l.mode}] estado=${l.status}\n    webhookUrl guardado: ${l.webhookUrl}`);

  console.log('\n=== ULTIMO MENSAJE ENTRANTE Y SALIENTE ===');
  const last = (await tdb.query(`SELECT direction, "createdAt", status, LEFT(COALESCE(body,''),40) AS body FROM "WaMessage" ORDER BY "createdAt" DESC LIMIT 6`)).rows;
  for (const m of last) console.log(`  ${m.createdat?.toISOString?.() ?? m.createdAt} ${m.direction.padEnd(3)} estado=${String(m.status)} ${JSON.stringify(m.body)}`);
  await tdb.end();

  const line = lines.find((l) => l.provider === 'dialog360');
  if (!line) { console.log('No hay linea de 360dialog.'); return; }
  const apiKey = decField(line.encryptedApiKey, dek);
  console.log(`\nAPI key guardada: ...${apiKey.slice(-6)} (${apiKey.length} chars)`);

  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 30000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });

  console.log('\n=== 1) WEBHOOK SEGUN 360DIALOG (lo critico) ===');
  try {
    const w = (await http.get('/v1/configs/webhook')).data;
    console.log('  ', JSON.stringify(w));
    const url = w?.url ?? '';
    if (!url) console.log('   >>> VACIO: por eso no entra ni un mensaje. Hay que volver a registrarlo.');
    else if (url !== line.webhookUrl) console.log(`   >>> DISTINTO del guardado.\n       registrado: ${url}\n       deberia:    ${line.webhookUrl}`);
    else console.log('   >>> Coincide con el guardado.');
  } catch (e) {
    console.log('   ERROR', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0,300));
    if (e.response?.status === 401 || e.response?.status === 403) console.log('   >>> La API key guardada YA NO SIRVE: al reconectar, 360dialog la rota.');
  }

  console.log('\n=== 2) PLANTILLAS ===');
  try {
    const res = (await http.get('/v1/configs/templates', { params: { limit: 200 } })).data;
    const list = res?.waba_templates ?? res?.templates ?? [];
    console.log(`   total=${list.length}`);
    for (const x of list) console.log(`     ${x.name} [${x.language}] ${x.status} ${x.category}`);
    if (list.length === 0) console.log('   >>> CERO plantillas: la WABA es nueva. Hay que volver a crearlas.');
  } catch (e) {
    console.log('   ERROR', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0,300));
  }

  console.log('\n=== 3) NUMERO / CANAL ===');
  for (const path of ['/v1/configs/phone_numbers', '/v1/configs/channel', '/health']) {
    try {
      const r = (await http.get(path)).data;
      console.log(`   ${path} -> ${JSON.stringify(r).slice(0, 400)}`);
    } catch (e) { console.log(`   ${path} -> ${e.response?.status ?? 'ERR'}`); }
  }
  console.log('\nListo (no se escribio nada).');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
