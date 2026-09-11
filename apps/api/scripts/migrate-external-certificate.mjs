/**
 * Certificado de garantia por sede: modo + emisor EXTERNO.
 *
 * 1. "Warehouse"."certificateMode" — que documento recibe el comprador al
 *    facturar: 'template' (la plantilla de siempre), 'off' (no se adjunta nada)
 *    o 'external' (lo emite un servicio externo por API).
 *    Nace en 'template' para TODAS las sedes: nadie cambia de comportamiento.
 * 2. Tabla "ExternalCertificateConnection" — URL, API key cifrada y medio de
 *    pago fijo del emisor externo. Nace VACIA: sin filas, el modo 'external'
 *    no se puede ni activar de forma util.
 *
 * Idempotente. No borra nada. Se puede correr ANTES de desplegar el codigo:
 * la columna con default y una tabla nueva no molestan a la version actual.
 *
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/migrate-external-certificate.mjs
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
const ssl = () =>
  process.env.TENANT_DB_SSLMODE === 'disable' ? undefined : { rejectUnauthorized: false };
const forDb = (a, n) => {
  const u = new URL(a);
  u.pathname = `/${n}`;
  return u.toString();
};

const DDL = `
-- 1. Modo del certificado. Default 'template' = exactamente lo de hoy.
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS "certificateMode" TEXT NOT NULL DEFAULT 'template';

-- 2. Emisor externo (hoy, la API de Eleven Store). Una fila por sede como
--    maximo, igual que "AlegraConnection".
CREATE TABLE IF NOT EXISTS "ExternalCertificateConnection" (
  "id"              TEXT PRIMARY KEY,
  "warehouseId"     TEXT NOT NULL UNIQUE REFERENCES "Warehouse"("id") ON DELETE CASCADE,
  "baseUrl"         TEXT NOT NULL,
  "encryptedApiKey" BYTEA NOT NULL,
  "paymentMethod"   TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'connected',
  "lastError"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
`;

/**
 * El script corre como ADMIN, asi que la tabla que se CREA aqui queda a nombre
 * de `postgres` y el rol con el que se conecta la aplicacion no puede ni leerla
 * (la app usa `tenant.dbRole`, no el admin). Sin esto, los Ajustes de la sede
 * responderian 500 con un "permission denied" invisible desde fuera.
 */
const GRANTS = (role) => `
ALTER TABLE "ExternalCertificateConnection" OWNER TO "${role}";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${role}";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${role}";
`;

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  if (!controlUrl || !adminUrl) {
    throw new Error('Faltan CONTROL_PLANE_DATABASE_URL o TENANT_DB_ADMIN_URL en el env');
  }

  const control = new Client({ connectionString: strip(controlUrl), ssl: ssl() });
  await control.connect();
  let tenants;
  try {
    const res = await control.query(
      `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC`,
    );
    tenants = res.rows;
  } finally {
    await control.end().catch(() => null);
  }

  console.log(`Certificado por sede (modo + emisor externo) en ${tenants.length} tenant(s)...\n`);
  let bad = 0;
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(forDb(adminUrl, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      await db.query(DDL);
      if (t.dbRole) await db.query(GRANTS(t.dbRole));
      const { rows } = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM "Warehouse" WHERE NOT "archived")                        AS sedes,
          (SELECT COUNT(*) FROM "Warehouse" WHERE "certificateMode" = 'template')        AS con_plantilla,
          (SELECT COUNT(*) FROM "Warehouse" WHERE "certificateMode" = 'off')             AS apagadas,
          (SELECT COUNT(*) FROM "Warehouse" WHERE "certificateMode" = 'external')        AS externas,
          (SELECT COUNT(*) FROM "ExternalCertificateConnection")                         AS emisores
      `);
      const r = rows[0];
      console.log(
        `  ✓ ${t.slug} — ${r.sedes} sede(s) activas · modo: ${r.con_plantilla} plantilla` +
          `, ${r.apagadas} sin certificado, ${r.externas} externo · ${r.emisores} emisor(es) configurado(s)`,
      );
    } catch (err) {
      bad++;
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log(bad === 0 ? '\nListo.' : `\nTerminado con ${bad} fallo(s).`);
  if (bad > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
