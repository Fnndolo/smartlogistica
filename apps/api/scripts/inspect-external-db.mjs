/**
 * SOLO LECTURA — inspector de estructura de la DB externa del user (la que ya
 * tiene IMEIs/seriales via webhook). NO lee datos de clientes: solo metadata
 * (information_schema) y conteos ESTIMADOS (pg_stat_user_tables). Ningun SELECT
 * sobre filas reales.
 *
 * La URL se pasa por env para no escribirla en ningun archivo:
 *   EXTERNAL_DB_URL='postgresql://...' node scripts/inspect-external-db.mjs
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
  if (!url) throw new Error('Falta EXTERNAL_DB_URL en el env');

  const db = await connect(url);
  try {
    // Tablas (public).
    const tables = (
      await db.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name);

    // Columnas de todas las tablas.
    const cols = (
      await db.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
      )
    ).rows;
    const colsByTable = new Map();
    for (const c of cols) {
      if (!colsByTable.has(c.table_name)) colsByTable.set(c.table_name, []);
      colsByTable.get(c.table_name).push(`${c.column_name}:${c.data_type}`);
    }

    // Conteos ESTIMADOS (rapido, sin escanear filas).
    const counts = new Map(
      (await db.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables`)).rows.map((r) => [
        r.relname,
        r.n_live_tup,
      ]),
    );

    console.log(`${tables.length} tabla(s) en public:\n`);
    for (const t of tables) {
      console.log(`━━ ${t}  (~${counts.get(t) ?? '?'} filas)`);
      for (const c of colsByTable.get(t) ?? []) console.log(`     ${c}`);
      console.log('');
    }
  } finally {
    await db.end().catch(() => null);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
