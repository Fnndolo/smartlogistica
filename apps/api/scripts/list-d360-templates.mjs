/**
 * Lista TODAS las plantillas de la WABA con su estado (via 360dialog).
 * Correr desde apps/api: node --env-file=.env.local scripts/list-d360-templates.mjs
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
  const conn = (await tdb.query(`SELECT "encryptedApiKey" FROM "Dialog360Connection" LIMIT 1`)).rows[0];
  await tdb.end();
  const apiKey = decField(conn.encryptedApiKey, dek);
  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 120000, headers: { 'D360-API-KEY': apiKey } });
  const list = (await http.get('/v1/configs/templates', { params: { limit: 200 } })).data;
  console.log('total:', (list?.waba_templates ?? []).length);
  for (const x of list?.waba_templates ?? []) {
    const doc = x.components?.some((c) => String(c.format ?? '').toUpperCase() === 'DOCUMENT') ? ' HEADER-DOC' : '';
    console.log(`-> ${x.name} [${x.language}] cat=${x.category} estado=${x.status}${doc}`);
  }
}
main().catch((e) => { console.error(e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0, 400)); process.exit(1); });
