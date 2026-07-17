/**
 * Siembra la plantilla del Certificado de Garantia para la sede PASTO con las
 * coordenadas "clasicas" de la extension (popup.js -> drawClasicaLayout).
 * Punto de partida; luego se refina en el editor visual.
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/seed-pasto-certificate.mjs
 */
import pg from 'pg';
const { Client } = pg;

const TEMPLATE = {
  page: 0,
  elements: [
    // Encabezado: tapar "Factura de venta" -> "Certificado de Garantía"
    { type: 'cover', x: 442, y: 771, width: 105, height: 12, color: '#ffffff' },
    { type: 'text', x: 444, y: 772.5, text: 'Certificado de Garantía', size: 8.5, bold: true, color: '#000000' },
    // Tapar "responsable de IVA" + "Factura de venta original"
    { type: 'cover', x: 442, y: 740, width: 105, height: 18, color: '#ffffff' },
    // Tapar el QR + bloque lateral, y reescribir la info de pago (sin QR)
    { type: 'cover', x: 30, y: 158, width: 265, height: 80, color: '#ffffff' },
    { type: 'text', x: 34, y: 225, text: 'Moneda: {moneda}', size: 8, color: '#000000' },
    { type: 'text', x: 34, y: 216.2, text: 'Generado: {fecha}', size: 8, color: '#000000' },
    { type: 'text', x: 34, y: 207.4, text: 'Forma de pago: {formaPago}', size: 8, color: '#000000' },
    { type: 'text', x: 34, y: 198.6, text: 'Medio de pago: {medioPago}', size: 8, color: '#000000' },
    // Tapar el texto legal (letra de cambio)
    { type: 'cover', x: 32, y: 109, width: 330, height: 25, color: '#ffffff' },
  ],
};

const stripSslMode = (url) => {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
};
const pgSsl = () => ((process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false });
const adminUrlForDb = (adminUrl, dbName) => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
};

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL;
  const control = new Client({ connectionString: stripSslMode(controlUrl), ssl: pgSsl() });
  await control.connect();
  const tenants = (
    await control.query(`SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`)
  ).rows;
  await control.end();

  for (const t of tenants) {
    const db = new Client({ connectionString: stripSslMode(adminUrlForDb(adminUrl, t.dbName)), ssl: pgSsl() });
    await db.connect();
    try {
      const res = await db.query(
        `UPDATE "Warehouse" SET "certificateTemplate"=$1::jsonb
         WHERE (LOWER(name) LIKE '%pasto%' OR slug LIKE '%pasto%') AND archived=false
         RETURNING id, name`,
        [JSON.stringify(TEMPLATE)],
      );
      if (res.rowCount > 0) {
        res.rows.forEach((r) => console.log(`  ✓ ${t.slug}: plantilla sembrada en "${r.name}" (${r.id})`));
      } else {
        console.log(`  – ${t.slug}: sin sede "Pasto"`);
      }
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
