/**
 * SOLO LECTURA — diagnostico del "peso perdido": trae las ultimas facturas y
 * muestra como Alegra partio precio/base/IVA/total por item.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-alegra-peso.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
function kekDec(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decF(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDec((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();
  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const al = (await tdb.query(`SELECT email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  await tdb.end();

  const http = axios.create({ baseURL: 'https://api.alegra.com/api/v1', timeout: 25000, headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${al.email}:${decF(al.encryptedToken, dek)}`).toString('base64')}` } });

  const invoices = (await http.get('/invoices', { params: { limit: 4, order_direction: 'DESC', order_field: 'id' } })).data;
  for (const inv of invoices) {
    console.log(`\n=== Factura ${inv.numberTemplate?.fullNumber ?? inv.id}  total=${inv.total} subtotal=${inv.subtotal ?? '?'} ===`);
    for (const it of inv.items ?? []) {
      console.log(`  item="${(it.name ?? '').slice(0, 40)}" price=${it.price} qty=${it.quantity} discount=${it.discount ?? 0}`);
      console.log(`    tax=${JSON.stringify(it.tax ?? [])}`);
      console.log(`    subtotal(item)=${it.subtotal ?? '?'} total(item)=${it.total ?? '?'}`);
    }
  }
}
main().catch((e) => { console.error(e.response?.data ?? e.message); process.exit(1); });
