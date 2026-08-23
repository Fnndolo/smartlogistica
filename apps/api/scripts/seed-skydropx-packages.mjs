/**
 * Siembra los "Paquetes Skydropx" (AppSetting 'skydropxPackagePresets') con el
 * JSON extraido del panel de Skydropx (Mis paquetes). Acepta el shape
 * normalizado [{name,length,width,height,weight}] o el crudo del panel
 * (alias/largo/ancho/alto/peso — se normaliza aca).
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/seed-skydropx-packages.mjs ruta/paquetes.json
 */
import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/seed-skydropx-packages.mjs paquetes.json'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.data ?? raw.package_templates ?? raw.packages ?? []);

const presets = list
  .map((it) => {
    const a = it.attributes ?? it;
    return {
      name: String(a.name ?? a.alias ?? a.nickname ?? '').trim().slice(0, 60),
      length: num(a.length ?? a.largo ?? a.depth),
      width: num(a.width ?? a.ancho),
      height: num(a.height ?? a.alto),
      // El panel a veces guarda paquetes sin peso: 1 kg de respaldo.
      weight: num(a.weight ?? a.peso) ?? 1,
    };
  })
  .filter((p) => p.name && p.length && p.width && p.height);

if (presets.length === 0) { console.error('El JSON no trajo paquetes reconocibles.'); process.exit(1); }
console.log('A sembrar:', JSON.stringify(presets, null, 2));

const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
await control.connect();
const t = (await control.query(`SELECT id, "dbName", slug FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
await control.end();

const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
await tdb.connect();
await tdb.query(
  `INSERT INTO "AppSetting"(key, value, "updatedAt") VALUES ('skydropxPackagePresets', $1::jsonb, NOW())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
  [JSON.stringify(presets)],
);
await tdb.end();
console.log(`OK: ${presets.length} paquetes Skydropx sembrados en ${t.slug}.`);
