/**
 * Prueba la API de PRODUCCION de Skydropx con las credenciales GUARDADAS
 * (cifradas) en la conexion actual: token + cotizacion estandar + plantillas
 * de direccion. Para descifrar por que produccion rechaza lo que sandbox
 * acepta. Correr desde apps/api:
 *   node --env-file=.env.local scripts/probe-skydropx-prod.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';

const { Client } = pg;
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
  const conn = (await tdb.query(`SELECT "encryptedApiKey", "encryptedApiSecret", mode FROM "SkydropxConnection" ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  await tdb.end();
  if (!conn) { console.log('SIN conexion'); return; }
  console.log('modo guardado:', conn.mode);
  const key = decField(conn.encryptedApiKey, dek);
  const secret = decField(conn.encryptedApiSecret, dek);
  const HOST = conn.mode === 'production' ? 'https://pro.skydropx.com' : 'https://sb-pro.skydropx.com';

  const tokRes = await fetch(`${HOST}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: key, client_secret: secret, grant_type: 'client_credentials' }),
  });
  const tok = await tokRes.json();
  console.log('token:', tokRes.status, tok.access_token ? 'OK' : JSON.stringify(tok).slice(0, 150));
  if (!tok.access_token) return;
  const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  const q = await fetch(`${HOST}/api/v1/quotations`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      quotation: {
        address_from: { country_code: 'CO', postal_code: '050015', area_level1: 'Antioquia', area_level2: 'Medellín', area_level3: '' },
        address_to: { country_code: 'CO', postal_code: '520003', area_level1: 'Nariño', area_level2: 'Pasto', area_level3: '' },
        parcel: { length: 20, width: 10, height: 10, weight: 1, declared_amount: 500000 },
        declared_amount: 500000,
      },
    }),
  });
  console.log('quotation estandar ->', q.status, (await q.text()).slice(0, 220));

  const at = await fetch(`${HOST}/api/v1/address_templates`, { headers: H });
  const atBody = await at.json().catch(() => null);
  const templates = atBody?.data ?? [];
  console.log('address_templates ->', at.status, `${templates.length} plantillas`);
  for (const tpl of templates) {
    console.log(
      ` - ${tpl.id} | ${tpl.alias_name} | ${tpl.address_type} | ${tpl.address?.area_level2} CP ${tpl.address?.postal_code} | verificadas: ${(tpl.verified_carriers ?? []).map((v) => `${v.carrier_name}:${v.status}`).join(',') || 'ninguna'}`,
    );
  }
  const from = templates.find((x) => x.address_type === 'from');
  if (!from) return;

  // TEORIA: produccion exige el ORIGEN como plantilla verificada.
  for (const [label, body] of [
    ['template_from_id + to crudo', {
      quotation: {
        address_template_from_id: from.id,
        address_to: { country_code: 'CO', postal_code: '050015', area_level1: 'Antioquia', area_level2: 'Medellín', area_level3: '' },
        parcel: { length: 20, width: 10, height: 10, weight: 1, declared_amount: 500000 },
        declared_amount: 500000,
      },
    }],
    ['template + address_from de la plantilla', {
      quotation: {
        address_template_from_id: from.id,
        address_from: from.address,
        address_to: { country_code: 'CO', postal_code: '050015', area_level1: 'Antioquia', area_level2: 'Medellín', area_level3: '' },
        parcel: { length: 20, width: 10, height: 10, weight: 1, declared_amount: 500000 },
        declared_amount: 500000,
      },
    }],
  ]) {
    const r = await fetch(`${HOST}/api/v1/quotations`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    console.log(`${label} ->`, r.status, (await r.text()).slice(0, 300));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
