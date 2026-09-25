/**
 * SOLO LECTURA. Dos cosas sobre GET /items de Alegra:
 *
 *  1. Como se comporta de verdad (tope de `limit`, si busca por subcadena, si
 *     pagina con `start`).
 *  2. Ejecuta el MISMO algoritmo que AlegraService.searchItems contra el
 *     catalogo real, para ver que devolveria antes de desplegarlo.
 *
 * Existe porque "15 256" dejo de encontrar nada: se estaba pidiendo limit=100
 * y Alegra responde 400 con code 903.
 *
 * NO modifica nada. No imprime el token.
 *   node --env-file=.env.local scripts/probe-alegra-item-search.mjs
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

// ==== Lo MISMO que hace el servicio (mantener en sintonia) ====
const MAX_LIMIT = 30;
const PAGES = 2;
const RESULTS = 30;
const norm = (s) =>
  (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
await control.connect();
const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
const dek = kekDecrypt(
  (await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek,
  Buffer.from(process.env.KEK_V1 ?? '', 'base64'),
);
await control.end();

const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
await tdb.connect();
const conns = (await tdb.query(`SELECT "warehouseId", email, "encryptedToken" FROM "AlegraConnection"`)).rows;
const sedes = new Map(
  (await tdb.query(`SELECT id, name FROM "Warehouse"`)).rows.map((w) => [w.id, w.name]),
);
await tdb.end();

function clientFor(conn) {
  return axios.create({
    baseURL: 'https://api.alegra.com/api/v1',
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      Authorization: `Basic ${Buffer.from(`${conn.email}:${decField(conn.encryptedToken, dek)}`).toString('base64')}`,
    },
  });
}

async function rawSearch(http, query, limit = MAX_LIMIT, start = 0) {
  const res = await http.get('/items', {
    params: { query, limit: Math.min(limit, MAX_LIMIT), ...(start > 0 ? { start } : {}) },
  });
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);
  }
  const b = res.data;
  return Array.isArray(b) ? b : (b?.data ?? []);
}

async function candidates(http, query, pages) {
  const out = [];
  for (let p = 0; p < pages; p++) {
    const batch = await rawSearch(http, query, MAX_LIMIT, p * MAX_LIMIT);
    out.push(...batch);
    if (batch.length < MAX_LIMIT) break;
  }
  return out;
}

/** Replica exacta de AlegraService.searchItems. */
async function smartSearch(http, query) {
  const frase = norm(query);
  const tokens = frase.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length === 1) return rawSearch(http, tokens[0]);

  const probes = [frase, ...[...tokens].sort((a, b) => b.length - a.length).slice(0, 2)];
  const settled = await Promise.allSettled(
    probes.map((p, i) => candidates(http, p, i === 0 ? 1 : PAGES)),
  );
  const batches = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (batches.length === 0) throw new Error(settled[0]?.reason?.message ?? 'todos los sondeos fallaron');

  const seen = new Set();
  const pool = [];
  for (const raw of batches.flat()) {
    const id = String(raw.id ?? '');
    if (id && !seen.has(id)) { seen.add(id); pool.push(raw); }
  }
  return pool
    .map((item) => ({ item, name: norm(item.name) }))
    .filter(({ name }) => tokens.every((tk) => name.includes(tk)))
    .sort((a, b) => {
      const af = a.name.includes(frase) ? 0 : 1;
      const bf = b.name.includes(frase) ? 0 : 1;
      return af - bf || a.name.length - b.name.length || a.name.localeCompare(b.name);
    })
    .slice(0, RESULTS)
    .map(({ item }) => item);
}

const CONSULTAS = ['15c', '15c 256', '15 256', 'redmi 15c 8ram', 'iphone 15 pro 256', 'xiaomi 128 4ram'];

for (const conn of conns) {
  const nombre = sedes.get(conn.warehouseId) ?? conn.warehouseId;
  console.log(`\n================ SEDE: ${nombre} ================`);
  const http = clientFor(conn);
  for (const q of CONSULTAS) {
    try {
      const antes = await rawSearch(http, q);
      const ahora = await smartSearch(http, q);
      console.log(`\n  "${q}"   Alegra crudo: ${antes.length}   ->   con el arreglo: ${ahora.length}`);
      for (const it of ahora.slice(0, 8)) console.log(`      · ${it.name}`);
      if (ahora.length === 0) console.log('      (nada)');
    } catch (e) {
      console.log(`\n  "${q}"   ERROR: ${e.message}`);
    }
  }
}
