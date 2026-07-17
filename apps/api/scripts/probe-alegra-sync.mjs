/**
 * Valida el indice por IMEI con datos reales: corre el sync completo (lista
 * facturas de compra -> extrae IMEIs -> upsert a AlegraImeiIndex) y prueba un
 * lookup. Escribe en la tabla AlegraImeiIndex (aditivo, upsert por imei).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/probe-alegra-sync.mjs
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';

const { Client } = pg;
const PAGE_LIMIT = 30;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 5;

// === cripto (mismo formato que EnvelopeService) ===
function kekDecrypt(blob, kek) {
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function decryptField(blob, dek) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
function luhn15(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let x = s.charCodeAt(i) - 48;
    if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}
function extractValidImeis(text) {
  const found = new Set();
  for (const chunk of text.split(/[\n\r,;]+/)) {
    const d = chunk.replace(/[^0-9]/g, '');
    if (d.length === 15 && luhn15(d)) found.add(d);
    else if (d.length === 16 && luhn15(d.slice(0, 15))) found.add(d.slice(0, 15));
  }
  for (const m of text.match(/(?:\d[ .\-]?){15}\d?/g) ?? []) {
    const d = m.replace(/[^0-9]/g, '');
    if (d.length >= 15 && luhn15(d.slice(0, 15))) found.add(d.slice(0, 15));
  }
  return [...found];
}

const stripSslMode = (url) => { const u = new URL(url); u.searchParams.delete('sslmode'); return u.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminUrlForDb = (adminUrl, dbName) => { const u = new URL(adminUrl); u.pathname = `/${dbName}`; return u.toString(); };

async function mapLimit(items, limit, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, q.length) }, async () => {
    for (let x = q.shift(); x !== undefined; x = q.shift()) await fn(x);
  }));
}

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSslMode(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dekRow = (await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0];
  await control.end();
  const dek = kekDecrypt(dekRow.wrappedDek, kek);

  const tdbUrl = stripSslMode(adminUrlForDb(process.env.TENANT_DB_ADMIN_URL, t.dbName));
  const tdb = new Client({ connectionString: tdbUrl, ssl: pgSsl() });
  await tdb.connect();
  const conn = (await tdb.query(`SELECT "warehouseId", email, "encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];
  if (!conn) { console.log('Sin conexion Alegra.'); await tdb.end(); return; }
  const token = decryptField(conn.encryptedToken, dek);

  const http = axios.create({
    baseURL: 'https://api.alegra.com/api/v1',
    timeout: 20000,
    headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}` },
  });

  // 1. Listar facturas.
  const bills = [];
  let capped = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await http.get('/bills', { params: { start: p * PAGE_LIMIT, limit: PAGE_LIMIT, order_field: 'date', order_direction: 'DESC' } });
    const batch = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    bills.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    if (p === MAX_PAGES - 1) capped = true;
  }
  console.log(`Facturas: ${bills.length}${capped ? ' (tope alcanzado)' : ''}`);

  // 2. Detalle + extraccion.
  const records = new Map();
  await mapLimit(bills, DETAIL_CONCURRENCY, async (bill) => {
    const detail = bill.purchases?.items ? bill : (await http.get(`/bills/${bill.id}`)).data;
    const items = detail.purchases?.items ?? detail.items ?? [];
    const billNumber = detail.numberTemplate?.fullNumber ?? detail.billNumber ?? String(detail.id);
    const billDate = detail.date ? new Date(detail.date) : null;
    const providerName = detail.provider?.name ?? null;
    for (const line of items) {
      const text = line.observations ?? line.description ?? '';
      if (!text) continue;
      const unit = line.price != null ? Number(line.price) : NaN;
      for (const imei of extractValidImeis(text)) {
        records.set(imei, {
          imei, billId: String(detail.id), billNumber, billDate, providerName,
          itemName: line.name ?? null, unitCost: Number.isNaN(unit) ? null : unit,
          observations: text.slice(0, 2000),
        });
      }
    }
  });
  console.log(`IMEIs extraidos (unicos): ${records.size}`);

  // 3. Upsert al indice.
  await mapLimit([...records.values()], 10, async (r) => {
    await tdb.query(
      `INSERT INTO "AlegraImeiIndex" (id, imei, "billId", "billNumber", "billDate", "providerName", "itemName", "unitCost", "sourceWarehouseId", observations, "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (imei) DO UPDATE SET
         "billId"=EXCLUDED."billId", "billNumber"=EXCLUDED."billNumber", "billDate"=EXCLUDED."billDate",
         "providerName"=EXCLUDED."providerName", "itemName"=EXCLUDED."itemName", "unitCost"=EXCLUDED."unitCost",
         "sourceWarehouseId"=EXCLUDED."sourceWarehouseId", observations=EXCLUDED.observations, "syncedAt"=now()`,
      [crypto.randomUUID(), r.imei, r.billId, r.billNumber, r.billDate, r.providerName, r.itemName, r.unitCost, conn.warehouseId, r.observations],
    );
  });

  const total = (await tdb.query(`SELECT count(*)::int AS n FROM "AlegraImeiIndex"`)).rows[0].n;
  console.log(`\nIndice AlegraImeiIndex: ${total} filas.\n`);

  // 4. Lookup de prueba (una fila real).
  const sample = (await tdb.query(`SELECT imei, "billNumber", "providerName", "itemName", "unitCost", "billDate" FROM "AlegraImeiIndex" ORDER BY "syncedAt" DESC LIMIT 3`)).rows;
  console.log('Muestra del indice:');
  for (const s of sample) {
    console.log(`  IMEI ${s.imei} -> ${s.itemName ?? '(sin nombre)'} | costo ${s.unitCost ?? '?'} | ${s.providerName ?? '?'} | factura ${s.billNumber ?? '?'} | ${s.billDate ? new Date(s.billDate).toISOString().slice(0,10) : '?'}`);
  }
  if (sample[0]) {
    const hit = (await tdb.query(`SELECT * FROM "AlegraImeiIndex" WHERE imei=$1`, [sample[0].imei])).rows[0];
    console.log(`\nLookup IMEI ${sample[0].imei}: ${hit ? 'ENCONTRADO ✔' : 'no encontrado ✗'}`);
  }

  await tdb.end();
  console.log('\nListo.');
}

main().catch((e) => { console.error(e); process.exit(1); });
