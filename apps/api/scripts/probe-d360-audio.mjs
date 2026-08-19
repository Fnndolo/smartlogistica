/**
 * CAZA el 131053 de las notas de voz: baja el ORIGINAL (webm) del ultimo
 * audio saliente fallido, lo transcodifica LOCAL con variantes de receta,
 * sube cada una a Meta (POST /media) y la envia por media id al numero de
 * prueba. Cada envio se INSERTA como WaMessage (externalId=wamid) para que
 * el webhook de estados escriba el veredicto real (delivered/failed) y se
 * pueda leer de la DB. Al final borra las filas de prueba.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-d360-audio.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const { Client } = pg;
const TO = '573226104752';
const run = promisify(execFile);

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function transcode(buffer, inExt, args) {
  const ffmpegPath = (await import('ffmpeg-static')).default;
  const inPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${inExt}`);
  const outPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.ogg`);
  await fs.writeFile(inPath, buffer);
  await run(ffmpegPath, ['-y', '-i', inPath, ...args, outPath], { timeout: 30_000 });
  const out = await fs.readFile(outPath);
  await fs.unlink(inPath).catch(() => null);
  await fs.unlink(outPath).catch(() => null);
  return out;
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
  const conn = (await tdb.query(`SELECT "encryptedApiKey" FROM "Dialog360Connection" LIMIT 1`)).rows[0];
  const failed = (await tdb.query(
    `SELECT id, "attachmentKey" FROM "WaMessage"
     WHERE kind='audio' AND direction='out' AND status='failed' AND "attachmentKey" IS NOT NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
  )).rows[0];
  if (!failed) { console.log('No hay audios fallidos con archivo.'); await tdb.end(); return; }
  console.log(`Original del fallo: ${failed.attachmentKey}`);

  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: failed.attachmentKey }));
  const original = Buffer.from(await obj.Body.transformToByteArray());
  console.log(`Original: ${original.length} bytes, contentType=${obj.ContentType}, magic=${original.subarray(0, 4).toString('hex')}`);
  const inExt = (obj.ContentType ?? '').includes('mp4') ? 'm4a' : (obj.ContentType ?? '').includes('ogg') ? 'ogg' : 'webm';

  const apiKey = decField(conn.encryptedApiKey, dek);
  const base = 'https://waba-v2.360dialog.io';

  // Variantes de receta/subida a probar EN ORDEN (para en la primera que entregue).
  const variants = [
    { name: 'A-prod-actual', args: ['-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1'], uploadType: 'audio/ogg' },
    { name: 'B-voip', args: ['-vn', '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-application', 'voip', '-avoid_negative_ts', 'make_zero'], uploadType: 'audio/ogg' },
    { name: 'C-codecs-header', args: ['-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1'], uploadType: 'audio/ogg; codecs=opus' },
    { name: 'D-mp3', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1'], uploadType: 'audio/mpeg', ext: 'mp3' },
  ];

  for (const v of variants) {
    console.log(`\n===== Variante ${v.name} =====`);
    let out;
    try {
      out = await transcode(original, inExt, v.args);
    } catch (e) {
      console.log(`  transcode ERROR: ${e.message}`);
      continue;
    }
    console.log(`  transcodificado: ${out.length} bytes, magic=${out.subarray(0, 4).toString()}`);

    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('file', new Blob([new Uint8Array(out)], { type: v.uploadType }), `nota-de-voz.${v.ext ?? 'ogg'}`);
    const up = await fetch(`${base}/media`, { method: 'POST', headers: { 'D360-API-KEY': apiKey }, body: fd });
    const upBody = await up.json().catch(() => null);
    console.log(`  upload HTTP ${up.status}: ${JSON.stringify(upBody).slice(0, 200)}`);
    const mediaId = upBody?.media?.[0]?.id ?? upBody?.id ?? null;
    if (!mediaId) continue;

    const send = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: TO, type: 'audio', audio: { id: mediaId } }),
    });
    const sendBody = await send.json().catch(() => null);
    const wamid = sendBody?.messages?.[0]?.id ?? null;
    console.log(`  send HTTP ${send.status}: wamid=${wamid ?? JSON.stringify(sendBody).slice(0, 200)}`);
    if (!wamid) continue;

    // Fila trazadora: el webhook de estados escribira aqui el veredicto real.
    const probeId = `probe-${crypto.randomUUID()}`;
    await tdb.query(
      `INSERT INTO "WaMessage" (id, phone, direction, kind, body, "externalId", status, "createdAt")
       VALUES ($1, $2, 'out', 'audio', $3, $4, 'sent', now())`,
      [probeId, TO.slice(2), `[prueba ${v.name}]`, wamid],
    );

    let verdict = 'sin-respuesta';
    for (let i = 0; i < 15; i++) {
      await sleep(4000);
      const r = (await tdb.query(`SELECT status, error FROM "WaMessage" WHERE id=$1`, [probeId])).rows[0];
      if (r.status === 'failed') { verdict = `FALLO: ${r.error}`; break; }
      if (r.status === 'delivered' || r.status === 'read') { verdict = `ENTREGADO (${r.status})`; break; }
    }
    console.log(`  >>> VEREDICTO ${v.name}: ${verdict}`);
    await tdb.query(`DELETE FROM "WaMessage" WHERE id=$1`, [probeId]);
    if (verdict.startsWith('ENTREGADO')) {
      console.log(`\n*** RECETA GANADORA: ${v.name} (args: ${v.args.join(' ')} | upload type: ${v.uploadType}) ***`);
      break;
    }
  }

  await tdb.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
