/**
 * Variantes de LIMPIEZA sobre la grabacion real mas reciente: la receta base
 * entrega tonos sinteticos pero falla con audio grabado -> algo del archivo
 * fuente sobrevive y Meta lo rechaza. Se prueba: sin metadata, reconstruido
 * via WAV intermedio, mp3 y AAC. Ademas imprime los detalles (ffmpeg -i) del
 * OGG fallido para COMPARAR con uno bueno.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-d360-audio3.mjs
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

let ffmpegPath;

async function ff(args) {
  return run(ffmpegPath, args, { timeout: 30_000 });
}

/** Detalles de streams/metadata de un archivo (stderr de ffmpeg -i). */
async function info(p) {
  try { await run(ffmpegPath, ['-hide_banner', '-i', p], { timeout: 15_000 }); } catch (e) {
    return String(e.stderr ?? '').split('\n').filter((l) => /Input|Duration|Stream|Metadata|^\s{4,}/.test(l)).slice(0, 14).join('\n');
  }
  return '(sin info)';
}

async function main() {
  ffmpegPath = (await import('ffmpeg-static')).default;
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
    `SELECT "attachmentKey" FROM "WaMessage"
     WHERE kind='audio' AND direction='out' AND status='failed' AND "attachmentKey" IS NOT NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
  )).rows[0];
  const apiKey = decField(conn.encryptedApiKey, dek);

  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'auto',
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: failed.attachmentKey }));
  const original = Buffer.from(await obj.Body.transformToByteArray());
  const inPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.m4a`);
  await fs.writeFile(inPath, original);
  console.log(`Original ${original.length} bytes`);
  console.log('--- INFO original ---\n' + (await info(inPath)));

  // OGG "receta actual" solo para IMPRIMIR su info (ya sabemos que falla).
  const aPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.ogg`);
  await ff(['-y', '-i', inPath, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', aPath]);
  console.log('--- INFO ogg receta actual (falla) ---\n' + (await info(aPath)));
  await fs.unlink(aPath).catch(() => null);

  const base = 'https://waba-v2.360dialog.io';
  const variants = [
    {
      name: 'E-sin-metadata',
      make: async (out) => ff(['-y', '-i', inPath, '-vn', '-map_metadata', '-1', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-fflags', '+bitexact', '-flags:a', '+bitexact', out]),
      ext: 'ogg', type: 'audio/ogg',
    },
    {
      name: 'F-via-wav',
      make: async (out) => {
        const wav = out.replace(/\.ogg$/, '.wav');
        await ff(['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '48000', wav]);
        await ff(['-y', '-i', wav, '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '32k', out]);
        await fs.unlink(wav).catch(() => null);
      },
      ext: 'ogg', type: 'audio/ogg',
    },
    {
      name: 'G-mp3',
      make: async (out) => ff(['-y', '-i', inPath, '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', out]),
      ext: 'mp3', type: 'audio/mpeg',
    },
    {
      name: 'H-aac-m4a',
      make: async (out) => ff(['-y', '-i', inPath, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', out]),
      ext: 'm4a', type: 'audio/mp4',
    },
  ];

  for (const v of variants) {
    console.log(`\n===== ${v.name} =====`);
    const outPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${v.ext}`);
    try { await v.make(outPath); } catch (e) { console.log(`  transcode ERROR: ${String(e.message).slice(0, 300)}`); continue; }
    const out = await fs.readFile(outPath);
    await fs.unlink(outPath).catch(() => null);
    console.log(`  ${out.length} bytes`);

    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('file', new Blob([new Uint8Array(out)], { type: v.type }), `nota-de-voz.${v.ext}`);
    const up = await fetch(`${base}/media`, { method: 'POST', headers: { 'D360-API-KEY': apiKey }, body: fd });
    const upBody = await up.json().catch(() => null);
    const mediaId = upBody?.media?.[0]?.id ?? upBody?.id ?? null;
    console.log(`  upload HTTP ${up.status}: ${JSON.stringify(upBody).slice(0, 150)}`);
    if (!mediaId) continue;
    const send = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: TO, type: 'audio', audio: { id: mediaId } }),
    });
    const sendBody = await send.json().catch(() => null);
    const wamid = sendBody?.messages?.[0]?.id ?? null;
    console.log(`  send HTTP ${send.status}: ${wamid ? 'wamid ok' : JSON.stringify(sendBody).slice(0, 150)}`);
    if (!wamid) continue;

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
      console.log(`\n*** GANADORA: ${v.name} ***`);
      break;
    }
  }

  await fs.unlink(inPath).catch(() => null);
  await tdb.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
