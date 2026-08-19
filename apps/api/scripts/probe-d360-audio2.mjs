/**
 * Confirma la hipotesis del AUDIO CORTO: envia un tono de 3s con la MISMA
 * receta de produccion (variante A) y lista el tamaño de TODOS los audios
 * salientes fallidos. Correr desde apps/api:
 * node --env-file=.env.local scripts/probe-d360-audio2.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const { Client } = pg;
const TO = '573226104752';
const run = promisify(execFile);

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();

  // 1. Tamaños de TODOS los audios salientes fallidos (¿todos ultra cortos?)
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  const fails = (await tdb.query(
    `SELECT id, "attachmentKey", "createdAt" FROM "WaMessage"
     WHERE kind='audio' AND direction='out' AND status='failed' AND "attachmentKey" IS NOT NULL
     ORDER BY "createdAt" DESC`,
  )).rows;
  console.log('=== audios fallidos y su tamaño original ===');
  for (const f of fails) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: f.attachmentKey })).catch(() => null);
    console.log(`${f.createdAt.toISOString()}  ${head?.ContentLength ?? '?'} bytes  ${head?.ContentType ?? '?'}`);
  }

  // 2. Tono de 3 segundos con la receta EXACTA de produccion.
  const ffmpegPath = (await import('ffmpeg-static')).default;
  const outPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.ogg`);
  const dur = process.env.DUR ?? '3';
  await run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', outPath], { timeout: 30_000 });
  const out = await fs.readFile(outPath);
  await fs.unlink(outPath).catch(() => null);
  console.log(`\nTono 3s transcodificado: ${out.length} bytes`);

  const conn = (await tdb.query(`SELECT "encryptedApiKey" FROM "Dialog360Connection" LIMIT 1`)).rows[0];
  const apiKey = decField(conn.encryptedApiKey, dek);
  const base = 'https://waba-v2.360dialog.io';

  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([new Uint8Array(out)], { type: 'audio/ogg' }), 'nota-de-voz.ogg');
  const up = await fetch(`${base}/media`, { method: 'POST', headers: { 'D360-API-KEY': apiKey }, body: fd });
  const upBody = await up.json().catch(() => null);
  console.log(`upload HTTP ${up.status}: ${JSON.stringify(upBody).slice(0, 200)}`);
  const mediaId = upBody?.media?.[0]?.id ?? upBody?.id ?? null;
  if (!mediaId) { await tdb.end(); return; }

  const send = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: TO, type: 'audio', audio: { id: mediaId } }),
  });
  const sendBody = await send.json().catch(() => null);
  const wamid = sendBody?.messages?.[0]?.id ?? null;
  console.log(`send HTTP ${send.status}: wamid=${wamid ?? JSON.stringify(sendBody).slice(0, 200)}`);
  if (!wamid) { await tdb.end(); return; }

  const probeId = `probe-${crypto.randomUUID()}`;
  await tdb.query(
    `INSERT INTO "WaMessage" (id, phone, direction, kind, body, "externalId", status, "createdAt")
     VALUES ($1, $2, 'out', 'audio', '[prueba tono 3s]', $3, 'sent', now())`,
    [probeId, TO.slice(2), wamid],
  );
  let verdict = 'sin-respuesta';
  for (let i = 0; i < 15; i++) {
    await sleep(4000);
    const r = (await tdb.query(`SELECT status, error FROM "WaMessage" WHERE id=$1`, [probeId])).rows[0];
    if (r.status === 'failed') { verdict = `FALLO: ${r.error}`; break; }
    if (r.status === 'delivered' || r.status === 'read') { verdict = `ENTREGADO (${r.status})`; break; }
  }
  console.log(`\n>>> VEREDICTO tono 3s receta produccion: ${verdict}`);
  await tdb.query(`DELETE FROM "WaMessage" WHERE id=$1`, [probeId]);
  await tdb.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
