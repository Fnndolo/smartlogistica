/**
 * Crea la plantilla de la GUIA (UTILITY, encabezado DOCUMENTO = el PDF del
 * rotulo adjunto): asi el envio de la guia por WhatsApp funciona SIEMPRE,
 * sin depender de la ventana de 24h. La muestra para aprobacion va como URL
 * (360dialog la exige asi: "header_handle should be valid url address").
 * NOMBRE por argumento: node --env-file=.env.local scripts/create-d360-template-guia.mjs [nombre]
 * (default: guia_envio_pedido)
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

const NAME = process.argv[2] ?? 'guia_envio_pedido';

// El mensaje EXACTO del negocio + la pregunta de confirmacion al final (la
// plantilla es UN solo mensaje: PDF del rotulo arriba + texto abajo).
const BODY =
  'Le comparto la guía para el seguimiento de su pedido que estará disponible hoy después de las 6 pm⏱️,\n\n' +
  '📡Puedes rastrear tu envío en:➡️ https://coordinadora.com/rastreo/rastreo-de-guia/ ingresando el numero de guía que esta en el archivo adjunto.\n\n' +
  '⚠️Al momento de recibir su pedido es importante revisar que el paquete este SELLADO y nos confirme cuando llegue a la dirección indicada.⚠️\n\n' +
  '✅¡NO OLVIDES REGISTRAR TU EQUIPO EN TU OPERADOR CON LA FACTURA!📲🤗\n\n' +
  '¡Que tenga un excelente día lleno de bendiciones!💙\n\n' +
  'Por favor me confirma si la guía está correcta 🫶🏻';

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
  // Timeout LARGO: 360dialog baja la muestra y la sube a Meta en la misma llamada.
  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 180000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });

  console.log(`Creando plantilla ${NAME} (es, UTILITY, encabezado DOCUMENTO)...`);
  try {
    const res = (await http.post('/v1/configs/templates', {
      name: NAME,
      language: 'es',
      category: 'UTILITY',
      components: [
        {
          type: 'HEADER',
          format: 'DOCUMENT',
          example: { header_handle: ['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'] },
        },
        { type: 'BODY', text: BODY },
      ],
    })).data;
    console.log('OK:', JSON.stringify(res).slice(0, 800));
  } catch (e) {
    console.log('error:', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0, 800));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
