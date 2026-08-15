/**
 * Crea la plantilla de confirmacion del pedido en la WABA (via 360dialog) como
 * UTILITY (transaccional): asi NO choca con el tope de marketing de Meta
 * (error 131049). Nombre/idioma = los defaults del codigo: order_confirmation / es.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/create-d360-template.mjs
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

// La plantilla ORIGINAL del negocio (emojis) — intento como UTILITY: si Meta
// la reclasifica a MARKETING, se queda la version sobria (confirmacion_datos_pedido).
const BODY =
  '¡Hola {{1}}! 👋 Es un gusto saludarle 😃\n\n' +
  'Le escribimos de Smart Gadgets para confirmar su compra de:\n' +
  '📱 {{2}}\n' +
  'Por nuestra plataforma de ADDI 💙\n\n' +
  '📍 A la dirección:\n' +
  '{{3}}\n\n' +
  'Si desea agregar alguna información adicional o más específica, quedamos atentos ' +
  'para incluirla en la guía 😉\n\n' +
  '🔍 ¿Me confirma si sus datos son correctos? ‼️';

const TEMPLATE = {
  name: 'confirmacion_compra_smart',
  language: 'es',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: BODY,
      example: { body_text: [['DAVID CASTRO', '1 IPHONE 17 PRO MAX 256', 'CALLE 16 # 23-71 CENTRO']] },
    },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Mis datos son correctos.' },
        { type: 'QUICK_REPLY', text: 'Modificar mi dirección.' },
      ],
    },
  ],
};

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
  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 30000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });

  console.log('Creando plantilla order_confirmation (es, UTILITY)...');
  try {
    const res = (await http.post('/v1/configs/templates', TEMPLATE)).data;
    console.log('Respuesta:', JSON.stringify(res, null, 2).slice(0, 1500));
  } catch (e) {
    console.log('error crear:', e.response?.status, JSON.stringify(e.response?.data ?? e.message, null, 2));
    return;
  }

  const list = (await http.get('/v1/configs/templates', { params: { limit: 50 } })).data;
  for (const tpl of list?.waba_templates ?? []) {
    console.log(`-> ${tpl.name} [${tpl.language}] categoria=${tpl.category} estado=${tpl.status}`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
