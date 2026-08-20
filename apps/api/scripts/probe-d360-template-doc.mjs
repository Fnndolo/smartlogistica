/**
 * INVESTIGA si la WABA acepta una plantilla UTILITY con encabezado DOCUMENTO
 * (PDF adjunto): asi la guia se envia SIEMPRE, sin depender de la ventana de
 * 24h. Meta exige una MUESTRA para encabezados de media — se prueban las
 * variantes de handle contra 360dialog y se imprime cada respuesta cruda.
 * Correr desde apps/api: node --env-file=.env.local scripts/probe-d360-template-doc.mjs
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

// PDF minimo VALIDO (una pagina en blanco) como muestra para la aprobacion.
const SAMPLE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
    '0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n',
  'latin1',
);

// El mensaje EXACTO del negocio + la pregunta de confirmacion al final (la
// plantilla es UN solo mensaje: PDF arriba + texto abajo).
const BODY =
  'Le comparto la guía para el seguimiento de su pedido que estará disponible hoy después de las 6 pm⏱️,\n\n' +
  '📡Puedes rastrear tu envío en:➡️ https://coordinadora.com/rastreo/rastreo-de-guia/ ingresando el numero de guía que esta en el archivo adjunto.\n\n' +
  '⚠️Al momento de recibir su pedido es importante revisar que el paquete este SELLADO y nos confirme cuando llegue a la dirección indicada.⚠️\n\n' +
  '✅¡NO OLVIDES REGISTRAR TU EQUIPO EN TU OPERADOR CON LA FACTURA!📲🤗\n\n' +
  '¡Que tenga un excelente día lleno de bendiciones!💙\n\n' +
  'Por favor me confirma si la guía está correcta 🫶🏻';

const NAME = 'guia_envio_smart';

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
  await tdb.end();
  if (!conn || conn.mode !== 'production') { console.log('No hay conexion de PRODUCCION.'); return; }
  const apiKey = decField(conn.encryptedApiKey, dek);
  const base = 'https://waba-v2.360dialog.io';
  const http = axios.create({ baseURL: base, timeout: 30000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });

  const tryCreate = async (label, template) => {
    console.log(`\n===== ${label} =====`);
    try {
      const res = (await http.post('/v1/configs/templates', template)).data;
      console.log('OK:', JSON.stringify(res).slice(0, 600));
      return true;
    } catch (e) {
      console.log('error:', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0, 700));
      return false;
    }
  };

  const baseTemplate = {
    name: NAME,
    language: 'es',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'DOCUMENT' },
      { type: 'BODY', text: BODY },
    ],
  };

  // Variante 1: SIN muestra (algunos BSP la aceptan y Meta revisa igual).
  if (await tryCreate('V1 sin muestra', baseTemplate)) return;

  // Variante 2: muestra = media id normal (subida clasica POST /media).
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([new Uint8Array(SAMPLE_PDF)], { type: 'application/pdf' }), 'muestra-guia.pdf');
  const up = await fetch(`${base}/media`, { method: 'POST', headers: { 'D360-API-KEY': apiKey }, body: fd });
  const upBody = await up.json().catch(() => null);
  const mediaId = upBody?.media?.[0]?.id ?? upBody?.id ?? null;
  console.log(`\nupload /media HTTP ${up.status}: ${JSON.stringify(upBody).slice(0, 200)}`);
  if (mediaId) {
    const v2 = structuredClone(baseTemplate);
    v2.components[0].example = { header_handle: [String(mediaId)] };
    if (await tryCreate('V2 header_handle = media id', v2)) return;
  }

  // Variante 3: subida RESUMABLE estilo Graph (por si 360dialog la proxya).
  for (const path of ['/v1/uploads', '/uploads', '/whatsapp_business_uploads']) {
    try {
      const start = await fetch(`${base}${path}?file_length=${SAMPLE_PDF.length}&file_type=application/pdf`, {
        method: 'POST',
        headers: { 'D360-API-KEY': apiKey },
      });
      const startBody = await start.json().catch(() => null);
      console.log(`\nresumable start ${path} HTTP ${start.status}: ${JSON.stringify(startBody).slice(0, 300)}`);
      const uploadId = startBody?.id ?? null;
      if (!uploadId) continue;
      const finish = await fetch(`${base}${path.replace(/\/$/, '')}/${encodeURIComponent(uploadId)}`, {
        method: 'POST',
        headers: { 'D360-API-KEY': apiKey, file_offset: '0', 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(SAMPLE_PDF),
      });
      const finishBody = await finish.json().catch(() => null);
      console.log(`resumable data HTTP ${finish.status}: ${JSON.stringify(finishBody).slice(0, 300)}`);
      const handle = finishBody?.h ?? null;
      if (handle) {
        const v3 = structuredClone(baseTemplate);
        v3.components[0].example = { header_handle: [String(handle)] };
        if (await tryCreate(`V3 handle resumable via ${path}`, v3)) return;
      }
    } catch (e) {
      console.log(`resumable ${path} fallo: ${e.message}`);
    }
  }
  console.log('\nNinguna variante paso — revisar las respuestas de arriba.');
}

main().catch((e) => { console.error(e); process.exit(1); });
