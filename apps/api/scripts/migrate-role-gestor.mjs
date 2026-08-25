/**
 * Migracion aditiva: ROL "GESTOR" en el enum TenantRole del CONTROL PLANE.
 *
 * GESTOR = entra a TODAS las sedes y hace todo el trabajo de pedidos (ver
 * generales, tomar, chatear, subir fotos, facturar en Alegra, generar guias)
 * pero NO gestiona equipo, NI conexiones, NI configuracion, NI transfiere
 * pedidos entre sedes.
 *
 * A diferencia de las otras migraciones, esta NO toca las bases de los tenants:
 * el rol vive en Membership.role del control-plane. Idempotente
 * (ADD VALUE IF NOT EXISTS) y no puede ir dentro de una transaccion, por eso se
 * ejecuta suelto (el cliente pg va en autocommit).
 *
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/migrate-role-gestor.mjs
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

async function main() {
  const url = process.env.CONTROL_PLANE_DATABASE_URL;
  if (!url) {
    console.error('Falta CONTROL_PLANE_DATABASE_URL');
    process.exit(1);
  }

  const control = new Client({ connectionString: strip(url), ssl: ssl() });
  await control.connect();
  try {
    const { rows: existing } = await control.query(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'TenantRole'
        ORDER BY e.enumsortorder`,
    );
    if (existing.length === 0) {
      console.error('✗ No existe el tipo "TenantRole" en el control-plane. ¿URL correcta?');
      process.exit(1);
    }

    if (existing.some((r) => r.enumlabel === 'GESTOR')) {
      console.log('✓ TenantRole ya tenia GESTOR — nada que hacer.');
    } else {
      // BEFORE 'OPERATOR' solo para que el orden del enum siga la jerarquia
      // (OWNER > ADMIN > GESTOR > OPERATOR); no cambia el comportamiento.
      await control.query(`ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'GESTOR' BEFORE 'OPERATOR'`);
      console.log('✓ TenantRole: valor GESTOR agregado.');
    }

    const { rows: after } = await control.query(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'TenantRole'
        ORDER BY e.enumsortorder`,
    );
    console.log(`  TenantRole = ${after.map((r) => r.enumlabel).join(', ')}`);
  } finally {
    await control.end().catch(() => null);
  }
  console.log('\nListo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
