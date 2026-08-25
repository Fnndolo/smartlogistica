/**
 * Regenera las RELACIONES DE DESPACHO ya adjuntas, con el generador ACTUAL.
 * Sirve cuando cambia el diseño del documento: reemplaza el PDF en el mismo
 * objeto de storage, asi el mensaje del chat sigue apuntando donde estaba.
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/regen-dispatch-relations.mjs [EXTERNAL_ID]
 */
import pg from 'pg';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { DispatchRelationService } from '../dist/modules/marketplaces/skydropx/dispatch-relation.service.js';

const { Client } = pg;
const kekDec = (b, k) => { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); };
const dec = (b, dek) => { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); };
const strip = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const ssl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adm = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const ONLY = process.argv[2];

/** MISMA cabecera que usa la app (orders.service.ts): 'inline' para que el PDF
 *  se ABRA en el visor del chat. Con 'attachment' el navegador lanza el dialogo
 *  de guardar cada vez que se entra a la conversacion. */
const contentDisposition = (fileName) => {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
const ctl = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
await ctl.connect();
const t = (await ctl.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
const dek = kekDec((await ctl.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
await ctl.end();

const db = new Client({ connectionString: strip(adm(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
await db.connect();
const conn = (await db.query(`SELECT "encryptedApiKey","encryptedApiSecret",mode FROM "SkydropxConnection" ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
const rows = (await db.query(`
  SELECT m.id, m.body, m."attachmentKey", o."externalId", o."skydropxShipmentId"
  FROM "OrderMessage" m JOIN "Order" o ON o.id = m."orderId"
  WHERE m.body LIKE 'RELACION-DESPACHO-%' AND o."skydropxShipmentId" IS NOT NULL
  ${ONLY ? `AND o."externalId" = '${ONLY.replace(/'/g, "''")}'` : ''}`)).rows;
console.log(`relaciones a regenerar: ${rows.length}`);

const HOST = conn.mode === 'production' ? 'https://api-pro.skydropx.com' : 'https://sb-pro.skydropx.com';
const tok = await (await fetch(`${HOST}/api/v1/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: dec(conn.encryptedApiKey, dek), client_secret: dec(conn.encryptedApiSecret, dek), grant_type: 'client_credentials' }),
})).json();

const s3 = new S3Client({
  region: process.env.STORAGE_REGION ?? 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
});
const svc = new DispatchRelationService();

for (const r of rows) {
  const raw = await (await fetch(`${HOST}/api/v1/shipments/${r.skydropxShipmentId}?include=packages`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  const inc = Array.isArray(raw.included) ? raw.included : [];
  const attrs = (raw.data?.attributes ?? raw.data ?? {});
  const addr = (type) => {
    const hit = inc.find((i) => i.type === 'address' && (i.attributes ?? i).address_type === type);
    const a = (hit?.attributes ?? hit) ?? {};
    return { company: str(a.company), name: str(a.name), taxId: str(a.tax_id_number), street: str(a.street1),
      extra: str(a.area_level3) ?? str(a.apartment_number), city: str(a.area_level2), state: str(a.area_level1),
      postalCode: str(a.postal_code), email: str(a.email), phone: str(a.phone) };
  };
  const p = (inc.find((i) => i.type === 'package')?.attributes ?? {});
  const tracking = str(p.tracking_number) ?? str(attrs.master_tracking_number);
  if (!tracking) { console.log(`  ${r.externalId}: sin numero de guia, se salta`); continue; }
  const pdf = await svc.build({
    relationNumber: `SKD-${tracking}`, trackingNumber: tracking,
    from: addr('from'), to: addr('to'), content: str(p.package_content) ?? '',
    weightKg: Number(p.weight) || 0, length: Number(p.length) || 0, width: Number(p.width) || 0,
    height: Number(p.height) || 0, packages: 1,
  });
  await s3.send(new PutObjectCommand({
    Bucket: process.env.STORAGE_BUCKET, Key: r.attachmentKey, Body: pdf,
    ContentType: 'application/pdf', ContentDisposition: contentDisposition(r.body),
  }));
  console.log(`  ${r.externalId}: ${r.body} regenerada (${pdf.length} bytes)`);
  await new Promise((x) => setTimeout(x, 600)); // limite 2 req/s de Skydropx
}
await db.end();
console.log('listo.');
