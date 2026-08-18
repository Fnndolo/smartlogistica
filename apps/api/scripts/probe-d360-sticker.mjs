/**
 * VERIFICA el arreglo de stickers: toma el ULTIMO sticker del historial,
 * lo baja del storage, lo SUBE a Meta (POST /media multipart via fetch) y lo
 * envia por media id al numero de prueba. Imprime cada respuesta cruda.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-d360-sticker.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const { Client } = pg;
const TO = '573226104752';

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
  const conn = (await tdb.query(`SELECT "encryptedApiKey", mode FROM "Dialog360Connection" LIMIT 1`)).rows[0];
  const st = (await tdb.query(
    `SELECT id, "attachmentKey" FROM "WaMessage" WHERE kind='sticker' AND "attachmentKey" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`,
  )).rows[0];
  await tdb.end();
  if (!st) { console.log('No hay stickers guardados.'); return; }
  console.log(`Sticker: ${st.attachmentKey}`);

  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: st.attachmentKey }));
  let buffer = Buffer.from(await obj.Body.transformToByteArray());
  console.log(`Descargado: ${buffer.length} bytes, contentType=${obj.ContentType}`);

  // Normalizar como el server: Meta exige <100KB 512x512 (si no, 131053 al entregar).
  if (buffer.length > 95 * 1024) {
    for (const q of [80, 65, 50, 35, 25]) {
      const out = await sharp(buffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: q })
        .toBuffer();
      console.log(`  re-encode q=${q}: ${out.length} bytes`);
      if (out.length <= 95 * 1024) { buffer = out; break; }
    }
  }
  console.log(`A subir: ${buffer.length} bytes`);

  const apiKey = decField(conn.encryptedApiKey, dek);
  const base = 'https://waba-v2.360dialog.io';

  // 1. SUBIR a Meta
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/webp' }), 'sticker.webp');
  const up = await fetch(`${base}/media`, { method: 'POST', headers: { 'D360-API-KEY': apiKey }, body: fd });
  const upBody = await up.json().catch(() => null);
  console.log(`\nUpload HTTP ${up.status}:`, JSON.stringify(upBody).slice(0, 400));
  const mediaId = upBody?.media?.[0]?.id ?? upBody?.id ?? null;
  if (!mediaId) { console.log('Sin media id — el upload fallo.'); return; }

  // 2. ENVIAR por id
  const send = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TO,
      type: 'sticker',
      sticker: { id: mediaId },
    }),
  });
  const sendBody = await send.json().catch(() => null);
  console.log(`\nSend HTTP ${send.status}:`, JSON.stringify(sendBody).slice(0, 400));
}
main().catch((e) => { console.error(e); process.exit(1); });
