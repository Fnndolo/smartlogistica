/**
 * Marca un paquete como PREDETERMINADO (isDefault) en los dos catalogos:
 *   AppSetting 'skydropxPackagePresets'  (Paquetes Skydropx)
 *   AppSetting 'packagePresets'          (Paquetes de guia — Coordinadora)
 *
 * Regla del catalogo: EXACTAMENTE UNO predeterminado. Al marcar el elegido se
 * le quita el flag a todos los demas. Idempotente: si el catalogo ya quedo
 * asi, no escribe nada.
 *
 * Por defecto marca "TECNOLOGIA"; se puede pasar otro nombre por argumento
 * (la comparacion ignora mayusculas, acentos y espacios de sobra). Si un
 * catalogo no tiene ese paquete, se deja INTACTO (no se inventa nada).
 *
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/seed-default-package.mjs
 *   node --env-file=.env.local scripts/seed-default-package.mjs "CAJA GRANDE"
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try {
    const x = new URL(u);
    x.searchParams.delete('sslmode');
    return x.toString();
  } catch {
    return u;
  }
};
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => {
  const x = new URL(u);
  x.pathname = `/${db}`;
  return x.toString();
};

/** Nombre comparable: sin acentos, sin espacios de sobra, en mayusculas. */
const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const TARGET = norm(process.argv[2] ?? 'TECNOLOGIA');
if (!TARGET) {
  console.error('Uso: node scripts/seed-default-package.mjs [nombre del paquete]');
  process.exit(1);
}

const CATALOGS = [
  { key: 'skydropxPackagePresets', label: 'Paquetes Skydropx' },
  { key: 'packagePresets', label: 'Paquetes de guía' },
];

/**
 * Deja isDefault SOLO en el paquete elegido (a los demas se les quita la
 * llave, no se les pone en false: el schema la trae opcional).
 * Devuelve null si el catalogo no sirve o no tiene ese paquete.
 */
function withDefault(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const idx = list.findIndex((p) => p && typeof p === 'object' && norm(p.name) === TARGET);
  if (idx === -1) return null;
  return list.map((p, i) => {
    if (i === idx) return { ...p, isDefault: true };
    if (p && typeof p === 'object' && 'isDefault' in p) {
      const { isDefault: _drop, ...rest } = p;
      return rest;
    }
    return p;
  });
}

async function main() {
  const control = new Client({
    connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL),
    ssl: ssl(),
  });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Paquete predeterminado: "${TARGET}" — ${tenants.length} tenant(s)\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      console.log(`  ${t.slug}`);
      for (const cat of CATALOGS) {
        const { rows } = await db.query(`SELECT value FROM "AppSetting" WHERE key = $1`, [cat.key]);
        if (rows.length === 0) {
          console.log(`    · ${cat.label}: sin catálogo — nada que marcar`);
          continue;
        }
        const list = rows[0].value;
        const next = withDefault(list);
        if (next === null) {
          console.log(`    · ${cat.label}: no hay un paquete "${TARGET}" — intacto`);
          continue;
        }
        if (JSON.stringify(next) === JSON.stringify(list)) {
          console.log(`    ✓ ${cat.label}: ya estaba correcto`);
          continue;
        }
        await db.query(
          `UPDATE "AppSetting" SET value = $1::jsonb, "updatedAt" = NOW() WHERE key = $2`,
          [JSON.stringify(next), cat.key],
        );
        console.log(`    ✓ ${cat.label}: "${TARGET}" marcado como predeterminado`);
      }
    } catch (err) {
      console.error(`    ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log('\nListo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
