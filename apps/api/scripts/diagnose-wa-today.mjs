/**
 * SOLO LECTURA. Diagnostico de WhatsApp "de hoy": lineas, fallos de envio,
 * medios que no se descargaron, y una prueba REAL (de solo lectura) de cada
 * credencial contra su proveedor.
 *
 * Existe porque el 2026-10-16 aparecieron a la vez: "Authorization Error" al
 * enviar, audios y stickers entrantes sin archivo, y fotos enviadas desde el
 * celular que llegan como "📷 Foto · <texto>" sin la foto.
 *
 * NO modifica nada. NO imprime credenciales.
 *   node --env-file=.env.local scripts/diagnose-wa-today.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
function kekDecrypt(b, k) {
  const iv = b.subarray(1, 13), t = b.subarray(13, 29), c = b.subarray(29);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(t);
  return Buffer.concat([d.update(c), d.final()]);
}
function decField(b, dek) {
  const iv = b.subarray(0, 12), t = b.subarray(12, 28), c = b.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(t);
  return Buffer.concat([d.update(c), d.final()]).toString('utf8');
}
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => ({ rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const iso = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '-');
const col = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
await control.connect();
const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" LIMIT 1`)).rows[0];
const dek = kekDecrypt(
  (await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek,
  Buffer.from(process.env.KEK_V1 ?? '', 'base64'),
);
await control.end();

const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
await db.connect();

// ---------------------------------------------------------------- 1. lineas
console.log('=== 1. LINEAS DE WHATSAPP ===');
const lines = (await db.query(`SELECT * FROM "WaLine" ORDER BY "createdAt"`)).rows;
for (const l of lines) {
  console.log(`\n  [${l.id}] "${l.label}"  provider=${l.provider}  mode=${l.mode}  default=${l.isDefault}`);
  console.log(`    phone=${l.phone ?? '-'}  phoneNumberId=${l.phoneNumberId ?? '-'}  wabaId=${l.wabaId ?? '-'}`);
  console.log(`    status=${l.status}  lastError=${l.lastError ?? '-'}`);
  console.log(`    creada=${iso(l.createdAt)}  actualizada=${iso(l.updatedAt)}`);
}

// ------------------------------------------------- 2. fallos de envio (48h)
console.log('\n\n=== 2. FALLOS DE ENVIO, ULTIMAS 48 H (por error y linea) ===');
const fallos = (await db.query(`
  SELECT COALESCE(error,'(sin texto)') error, "lineId", COUNT(*)::int n,
         MIN("createdAt") primero, MAX("createdAt") ultimo
  FROM "WaMessage"
  WHERE direction='out' AND status='failed' AND "createdAt" > now() - interval '48 hours'
  GROUP BY 1,2 ORDER BY n DESC`)).rows;
for (const f of fallos) {
  console.log(`  ${String(f.n).padStart(4)}  linea=${col(f.lineId, 25)} ${iso(f.primero)} .. ${iso(f.ultimo)}`);
  console.log(`        ${String(f.error).slice(0, 160)}`);
}

// ------------------------------------- 3. salientes por hora y resultado (24h)
console.log('\n\n=== 3. SALIENTES POR HORA (UTC), ULTIMAS 30 H ===');
const porHora = (await db.query(`
  SELECT to_char(date_trunc('hour',"createdAt"),'MM-DD HH24') h,
         COUNT(*) FILTER (WHERE status IN ('sent','delivered','read'))::int ok,
         COUNT(*) FILTER (WHERE status='failed')::int fallo,
         COUNT(*) FILTER (WHERE status='failed' AND error ILIKE '%authoriz%')::int auth
  FROM "WaMessage" WHERE direction='out' AND "createdAt" > now() - interval '30 hours'
  GROUP BY 1 ORDER BY 1`)).rows;
console.log('  hora        ok  fallo  (auth)');
for (const r of porHora) console.log(`  ${r.h}   ${String(r.ok).padStart(4)}  ${String(r.fallo).padStart(5)}  (${r.auth})`);

// ----------------------------- 4. medios entrantes/eco sin archivo, por hora
console.log('\n\n=== 4. MEDIOS (image/audio/video/sticker/file) CON Y SIN ARCHIVO, POR HORA, ULTIMAS 30 H ===');
const medios = (await db.query(`
  SELECT to_char(date_trunc('hour',"createdAt"),'MM-DD HH24') h,
         COUNT(*) FILTER (WHERE "attachmentKey" IS NOT NULL OR "mediaUrl" IS NOT NULL)::int con,
         COUNT(*) FILTER (WHERE "attachmentKey" IS NULL AND "mediaUrl" IS NULL)::int sin
  FROM "WaMessage"
  WHERE kind IN ('image','audio','video','sticker','file') AND "createdAt" > now() - interval '30 hours'
  GROUP BY 1 ORDER BY 1`)).rows;
console.log('  hora        con  sin_archivo');
for (const r of medios) console.log(`  ${r.h}   ${String(r.con).padStart(4)}  ${String(r.sin).padStart(5)}`);

// Mensajes de texto que "son" medios degradados: body tipo "📷 Foto ·", "[audio recibido]"
console.log('\n=== 4b. TEXTOS QUE EN REALIDAD SON MEDIOS SIN ARCHIVO (ultimas 30 h) ===');
const degradados = (await db.query(`
  SELECT to_char(date_trunc('hour',"createdAt"),'MM-DD HH24') h, direction, kind, COUNT(*)::int n
  FROM "WaMessage"
  WHERE "createdAt" > now() - interval '30 hours'
    AND (body LIKE '📷%' OR body LIKE '%[audio recibido]%' OR body LIKE '%Sticker%' OR body LIKE '%no se pudo descargar%')
  GROUP BY 1,2,3 ORDER BY 1`)).rows;
for (const r of degradados) console.log(`  ${r.h}  ${r.direction}  kind=${r.kind}  n=${r.n}`);

// ----------------------------------------- 5. los mensajes de las capturas
console.log('\n\n=== 5. LOS MENSAJES DE LAS CAPTURAS ===');
const buscar = [
  ['Entonces enviamos ambos color silver', 'texto con Authorization Error'],
  ['[audio recibido]', 'audio sin archivo'],
  ['Hola, buenos días! 😊 Sí, es correcto, compraste', 'foto del celular sin foto'],
];
for (const [frag, etiqueta] of buscar) {
  const r = (await db.query(
    `SELECT * FROM "WaMessage" WHERE body LIKE $1 AND "createdAt" > now() - interval '30 hours' ORDER BY "createdAt" DESC LIMIT 2`,
    [`%${frag}%`],
  )).rows;
  console.log(`\n  --- ${etiqueta} (${r.length}) ---`);
  for (const m of r) {
    for (const k of ['createdAt', 'phone', 'direction', 'kind', 'body', 'attachmentKey', 'mediaUrl', 'authorName', 'status', 'error', 'lineId', 'externalId']) {
      let v = m[k]; if (v instanceof Date) v = iso(v);
      console.log(`    ${k.padEnd(14)} ${String(v ?? 'null').slice(0, 130)}`);
    }
  }
}
const stickers = (await db.query(`
  SELECT * FROM "WaMessage" WHERE kind='sticker' AND "createdAt" > now() - interval '30 hours' ORDER BY "createdAt" DESC LIMIT 3`)).rows;
console.log(`\n  --- stickers recientes (${stickers.length}) ---`);
for (const m of stickers) {
  console.log(`    ${iso(m.createdAt)} dir=${m.direction} key=${m.attachmentKey ?? 'NULL'} mediaUrl=${m.mediaUrl ?? 'NULL'} line=${m.lineId} body=${String(m.body ?? '').slice(0, 50)}`);
}
await db.end();

// ------------------------- 6. prueba REAL (solo lectura) de cada credencial
console.log('\n\n=== 6. PRUEBA DE CADA CREDENCIAL (solo lectura) ===');
for (const l of lines) {
  let key;
  try { key = decField(l.encryptedApiKey, dek); } catch (e) { console.log(`  [${l.label}] no se pudo descifrar: ${e.message}`); continue; }
  const http = axios.create({ timeout: 20000, validateStatus: () => true });
  if (l.provider === 'meta') {
    const v = process.env.WHATSAPP_API_VERSION || 'v25.0';
    const r = await http.get(`https://graph.facebook.com/${v}/${l.phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating,platform_type,throughput' },
      headers: { Authorization: `Bearer ${key}` },
    });
    console.log(`\n  [${l.label}] META GET /${l.phoneNumberId} -> HTTP ${r.status}`);
    console.log(`    ${JSON.stringify(r.data).slice(0, 400)}`);
    const dbg = await http.get(`https://graph.facebook.com/${v}/debug_token`, {
      params: { input_token: key, access_token: key },
    });
    console.log(`    debug_token -> HTTP ${dbg.status}: ${JSON.stringify(dbg.data?.data ?? dbg.data).slice(0, 400)}`);
  } else {
    const base = l.mode === 'sandbox' ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
    for (const path of ['/v1/configs/webhook', '/health_status']) {
      const r = await http.get(`${base}${path}`, { headers: { 'D360-API-KEY': key } });
      console.log(`\n  [${l.label}] 360dialog GET ${path} -> HTTP ${r.status}`);
      // La URL del webhook lleva el token secreto en la query: no se imprime.
      const out = JSON.stringify(r.data, null, path === '/health_status' ? 2 : 0).replace(
        /([?&]token=)[^&"]+/g,
        '$1***',
      );
      console.log(path === '/health_status' ? out : `    ${out.slice(0, 400)}`);
    }
    // LO QUE IMPORTA en /health_status: el entity_type "APP" es la aplicacion
    // de 360dialog en Meta. Si dice BLOCKED con error 141011, la app perdio el
    // permiso de mensajeria sobre el numero: falla el envio ("Authorization
    // Error", "(#3) ... granular permission") y la descarga de medios, aunque
    // la API key responda 200. Eso solo lo arregla 360dialog.
  }
}
