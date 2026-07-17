/**
 * SOLO LECTURA. Diagnostico para diseñar el indice por IMEI:
 *  1. Lee la conexion Alegra del tenant (token cifrado) y lo descifra (KEK->DEK->campo).
 *  2. Trae las ultimas facturas de compra (GET /bills + detalle).
 *  3. Localiza donde aparece el IMEI: escanea cada campo string y marca los que
 *     contienen una secuencia de 15 digitos que pasa Luhn (= IMEI casi seguro).
 *
 * NO modifica ni crea nada en Alegra ni en la DB. No imprime el token.
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-alegra-bills.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;

// === helpers cripto (mismo formato que EnvelopeService) ===
function kekDecrypt(blob, kek) {
  const version = blob[0];
  if (version !== 1) throw new Error(`Version de KEK inesperada: ${version}`);
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const ct = blob.subarray(29);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function decryptField(blob, dek) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function luhn15(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let x = s.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

// Camina el objeto y devuelve {path, value} de cada string que contenga 14+ digitos seguidos.
function findDigitStrings(obj, path = '', out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (/\d{14,}/.test(obj.replace(/[ .\-]/g, ''))) out.push({ path, value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findDigitStrings(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      findDigitStrings(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

function likelyImeis(str) {
  const found = new Set();
  const norm = str.replace(/[ .\-]/g, '');
  for (const m of norm.match(/\d{15,}/g) ?? []) {
    for (let i = 0; i + 15 <= m.length; i++) {
      const c = m.slice(i, i + 15);
      if (luhn15(c)) found.add(c);
    }
  }
  return [...found];
}

function stripSslMode(url) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return u.toString();
}
const pgSsl = () =>
  (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
function adminUrlForDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  if (!controlUrl || !adminUrl || kek.length !== 32) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL / TENANT_DB_ADMIN_URL / KEK_V1');
  }

  // 1. Tenant + DEK desde control plane.
  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenant, dek;
  try {
    const t = await control.query(
      `SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`,
    );
    tenant = t.rows[0];
    if (!tenant) throw new Error('No hay tenant ACTIVE');
    const d = await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [tenant.id]);
    if (!d.rows[0]) throw new Error('Tenant sin DEK');
    dek = kekDecrypt(d.rows[0].wrappedDek, kek);
  } finally {
    await control.end().catch(() => null);
  }
  console.log(`Tenant: ${tenant.slug}\n`);

  // 2. Conexion Alegra desde el tenant DB.
  const tdb = new Client({ connectionString: stripSslMode(adminUrlForDb(adminUrl, tenant.dbName)), ssl: pgSsl() });
  await tdb.connect();
  let conn;
  try {
    const r = await tdb.query(`SELECT "warehouseId", email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`);
    conn = r.rows[0];
  } finally {
    await tdb.end().catch(() => null);
  }
  if (!conn) {
    console.log('No hay conexion Alegra en el tenant. Conectala en una sede primero.');
    return;
  }
  const token = decryptField(conn.encryptedToken, dek);
  const emailMasked = conn.email.replace(/(.{2}).*(@.*)/, '$1***$2');
  console.log(`Alegra conectado (warehouse ${conn.warehouseId}) email=${emailMasked}\n`);

  // 3. Alegra API: listar bills.
  const http = axios.create({
    baseURL: 'https://api.alegra.com/api/v1',
    timeout: 20000,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}`,
    },
  });

  let list;
  try {
    const res = await http.get('/bills', {
      params: { limit: 10, order_field: 'date', order_direction: 'DESC' },
    });
    list = Array.isArray(res.data) ? res.data : (res.data?.data ?? res.data?.bills ?? []);
  } catch (err) {
    console.error('Error listando /bills:', err.response?.status, err.response?.data ?? err.message);
    return;
  }
  console.log(`/bills devolvio ${list.length} facturas de compra.\n`);

  // 4. Detalle de las primeras y localizacion del IMEI.
  const sample = list.slice(0, 5);
  for (const b of sample) {
    let bill;
    try {
      const res = await http.get(`/bills/${b.id}`);
      bill = res.data;
    } catch (err) {
      console.error(`  bill ${b.id}: error ${err.response?.status}`);
      continue;
    }

    console.log('────────────────────────────────────────────────────────');
    console.log(`Bill id=${bill.id} number=${bill.numberTemplate?.fullNumber ?? bill.billNumber ?? '?'} date=${bill.date}`);
    console.log(`  provider: ${bill.provider?.name ?? '—'}`);
    console.log(`  top-level keys: ${Object.keys(bill).join(', ')}`);

    // Estructura de la primera linea (para el sync).
    const items = bill.items ?? bill.purchases?.items ?? [];
    if (items.length) {
      console.log(`  items: ${items.length}. keys de item[0]: ${Object.keys(items[0]).join(', ')}`);
    } else {
      console.log('  items: (vacio o no en el detalle)');
    }

    // Localizar IMEIs: campos con 14+ digitos, marcando los que pasan Luhn.
    const hits = findDigitStrings(bill);
    if (!hits.length) {
      console.log('  ⚠ sin campos con secuencias de 14+ digitos');
    }
    for (const h of hits) {
      const imeis = likelyImeis(h.value);
      const tag = imeis.length ? `  ✔ IMEI(s): ${imeis.join(', ')}` : '  (no pasa Luhn)';
      const val = h.value.length > 120 ? h.value.slice(0, 120) + '…' : h.value;
      console.log(`  · ${h.path} = ${JSON.stringify(val)}${tag}`);
    }
    console.log('');
  }

  console.log('Listo. (solo lectura, no se modifico nada)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
