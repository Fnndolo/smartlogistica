/**
 * Crea la plantilla del RESPALDO (tercer toque del flujo de venta: cuando
 * Coordinadora reporta ENTREGADO). MARKETING (es venta, sin disfraces) con
 * {{1}} = nombre y UN boton de respuesta rapida.
 * Correr desde apps/api: node --env-file=.env.local scripts/create-d360-template-respaldo.mjs
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

const BODY =
  '🎉 ¡{{1}}, su equipo ya está en sus manos!\n\n' +
  'Disfrútelo al máximo — y ahora que ya lo tiene, no se preocupe por un robo o un accidente: todavía está a tiempo de activar el RESPALDO de Smart Gadgets 🛡️\n\n' +
  'Por solo el 10% del valor de su equipo queda protegido UN AÑO COMPLETO: robo 🚨, caídas y accidentes cubiertos. Y puede pagarlo con las cuotas cómodas de Addi 💙\n\n' +
  'Es el mejor momento — toque el botón y un asesor le cuenta todo, sin compromiso 👇';

const TEMPLATE = {
  name: process.argv[2] ?? 'respaldo_entregado_full',
  language: 'es',
  category: 'MARKETING',
  components: [
    { type: 'BODY', text: BODY, example: { body_text: [['DAVID']] } },
    // OJO: Meta NO permite emojis/saltos en el texto de los botones.
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quiero mi respaldo' }] },
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
  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 180000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });
  console.log(`Creando plantilla ${TEMPLATE.name} (es, MARKETING)...`);
  try {
    const res = (await http.post('/v1/configs/templates', TEMPLATE)).data;
    console.log('OK:', JSON.stringify(res).slice(0, 600));
  } catch (e) {
    console.log('error:', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0, 700));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
