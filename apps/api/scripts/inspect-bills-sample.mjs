/**
 * SOLO LECTURA — corre las 2 consultas aprobadas por el user:
 *   1. jsonb_pretty(data) de UNA factura de compra (ver estructura).
 *   2. lookup de un IMEI conocido (confirmar que se puede buscar).
 * URL por env:  EXTERNAL_DB_URL='postgresql://...' node scripts/inspect-bills-sample.mjs
 */
import pg from 'pg';
const { Client } = pg;

async function connect(url) {
  try {
    const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  } catch (e) {
    if (/does not support SSL/i.test(e.message)) {
      const c = new Client({ connectionString: url, ssl: false });
      await c.connect();
      return c;
    }
    throw e;
  }
}

async function main() {
  const url = process.env.EXTERNAL_DB_URL;
  if (!url) throw new Error('Falta EXTERNAL_DB_URL');
  const db = await connect(url);
  try {
    console.log('=== 1. Estructura de bills.data (una factura de compra reciente) ===\n');
    const s = await db.query(`SELECT jsonb_pretty(data) AS d FROM bills ORDER BY id DESC LIMIT 1`);
    console.log(s.rows[0]?.d ?? '(sin filas)');

    console.log('\n=== 2. Lookup IMEI 862996080146992 ===\n');
    const l = await db.query(
      `SELECT id, store, date FROM bills WHERE data::text ILIKE '%862996080146992%' LIMIT 3`,
    );
    console.log(l.rows.length ? JSON.stringify(l.rows, null, 2) : '(no encontrado)');
  } finally {
    await db.end().catch(() => null);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
