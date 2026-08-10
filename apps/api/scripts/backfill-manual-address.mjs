/**
 * Backfill: los pedidos MONTADOS a mano creados ANTES de que la direccion
 * naciera confirmada quedaron con addressStatus NULL, y el webhook de WhatsApp
 * ya no los toca (excluye provider 'manual') -> quedarian "Sin responder" para
 * siempre. Su direccion la dicto el cliente al montarlos: se confirman aqui.
 * Correr desde apps/api: node --env-file=.env.local scripts/backfill-manual-address.mjs
 */
import pg from 'pg';

const { Client } = pg;
const strip = (u) => {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); } catch { return u; }
};
const ssl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();
  for (const t of tenants) {
    const db = new Client({ connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: ssl() });
    try {
      await db.connect();
      const res = await db.query(
        `UPDATE "Order"
            SET "addressStatus" = 'confirmed', "addressConfirmedAt" = now()
          WHERE provider = 'manual' AND "addressStatus" IS NULL`,
      );
      console.log(`  ✓ ${t.slug}: ${res.rowCount} pedido(s) confirmados`);
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log('Listo.');
}
main().catch((e) => { console.error(e); process.exit(1); });
