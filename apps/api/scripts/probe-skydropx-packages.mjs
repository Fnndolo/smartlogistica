/**
 * Busca "Mis paquetes" (presets guardados en el panel) en endpoints NO
 * documentados de la API Pro de Skydropx, con las credenciales guardadas.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-skydropx-packages.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';

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
  const conn = (await tdb.query(`SELECT "encryptedApiKey", "encryptedApiSecret", mode FROM "SkydropxConnection" ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  await tdb.end();
  if (!conn) { console.log('SIN conexion'); return; }
  const key = decField(conn.encryptedApiKey, dek);
  const secret = decField(conn.encryptedApiSecret, dek);
  const HOST = conn.mode === 'production' ? 'https://api-pro.skydropx.com' : 'https://sb-pro.skydropx.com';
  console.log('modo:', conn.mode, '| host:', HOST);

  const tokRes = await fetch(`${HOST}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: key, client_secret: secret, grant_type: 'client_credentials' }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) { console.log('token FAIL:', tokRes.status, JSON.stringify(tok).slice(0, 200)); return; }
  const H = { Authorization: `Bearer ${tok.access_token}` };

  const paths = [
    '/api/v1/package_templates',
    '/api/v1/packages',
    '/api/v1/parcels',
    '/api/v1/parcel_templates',
    '/api/v1/package_presets',
    '/api/v1/saved_packages',
    '/api/v1/shipments/package_templates',
    '/api/v1/shipments/packages',
    '/api/v1/settings/package_templates',
    '/api/v1/users/package_templates',
    '/api/v1/account/package_templates',
    '/api/v2/package_templates',
  ];
  for (const p of paths) {
    try {
      const r = await fetch(`${HOST}${p}`, { headers: H });
      const body = (await r.text()).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`${r.status} ${p} -> ${body}`);
    } catch (e) {
      console.log(`ERR ${p} -> ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 600)); // limite 2 req/s
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
