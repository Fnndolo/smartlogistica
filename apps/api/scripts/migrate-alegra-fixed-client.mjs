/**
 * Migracion aditiva: "Warehouse"."alegraFixedClient".
 *
 * Cliente FIJO de Alegra por sede. Si esta puesto, TODAS las facturas de esa
 * sede se emiten en Alegra a ese contacto en vez de al comprador. El documento
 * que se le manda al comprador por el chat sigue llevando SU nombre — de eso se
 * encarga la plantilla del certificado.
 *
 * Idempotente. No toca ningun dato existente: la columna nace vacia y con eso
 * el comportamiento es exactamente el de hoy.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-alegra-fixed-client.mjs
 */
import pg from 'pg';

const { Client } = pg;

function stripSslMode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}
function pgSsl() {
  const sslmode = process.env.TENANT_DB_SSLMODE ?? 'require';
  return sslmode === 'disable' ? undefined : { rejectUnauthorized: false };
}
function adminUrlForDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const DDL = `ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "alegraFixedClient" JSONB;`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL en el env');
  }

  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT slug, "dbName" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Agregando "alegraFixedClient" en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    const db = new Client({
      connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)),
      ssl: pgSsl(),
    });
    try {
      await db.connect();
      await db.query(DDL);
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM "Warehouse" WHERE "alegraFixedClient" IS NOT NULL`,
      );
      console.log(`  ✓ ${t.slug} — columna lista · ${rows[0].n} sede(s) con cliente fijo`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
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
