/**
 * Reproduce el envio del boton "Sin enviar" de MP-0003: plantilla
 * confirmacion_compra_smart al numero de PRUEBA del propietario, imprimiendo
 * el error CRUDO de 360dialog (el toast lo disfrazaba de "Whapify").
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-d360-send.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const TO = '573226104752'; // telefono de MP-0003 (numero de prueba del propietario)

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
  await tdb.end();

  const apiKey = decField(conn.encryptedApiKey, dek);
  const http = axios.create({ baseURL: 'https://waba-v2.360dialog.io', timeout: 30000, headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } });

  console.log(`Enviando plantilla confirmacion_compra_smart -> ${TO} ...`);
  try {
    const res = (await http.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TO,
      type: 'template',
      template: {
        name: 'confirmacion_compra_smart',
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'DAVID CASTRO' },
              { type: 'text', text: '1 IPHONE 17 PRO MAX 256' },
              { type: 'text', text: 'CALLE 16 # 23-71 CENTRO' },
            ],
          },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRMED' }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'MODIFY' }] },
        ],
      },
    })).data;
    console.log('OK:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.log('HTTP', e.response?.status);
    console.log('ERROR CRUDO:', JSON.stringify(e.response?.data ?? e.message, null, 2));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
