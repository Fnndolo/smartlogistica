/**
 * Migracion aditiva: "tomar pedido" (columnas claimedBy* en Order) y
 * reacciones por pedido (tabla OrderReaction). Idempotente.
 * OJO: la tabla NUEVA necesita ALTER OWNER al rol del tenant (si no, 42501).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-claim-reactions.mjs
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

const STMTS = [
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "claimedById" TEXT`,
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "claimedByName" TEXT`,
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3)`,
  `CREATE TABLE IF NOT EXISTS "OrderReaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderReaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderReaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "OrderReaction_orderId_userId_emoji_key" ON "OrderReaction"("orderId","userId","emoji")`,
  `CREATE INDEX IF NOT EXISTS "OrderReaction_orderId_idx" ON "OrderReaction"("orderId")`,
];

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Migrando claim+reacciones en ${tenants.length} tenant(s)...\n`);
  for (const t of tenants) {
    if (!/^[a-z0-9_-]+$/i.test(t.dbRole)) {
      console.error(`  ✗ ${t.slug}: dbRole sospechoso, saltado`);
      continue;
    }
    const db = new Client({
      connectionString: strip(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    try {
      await db.connect();
      for (const s of STMTS) await db.query(s);
      await db.query(`ALTER TABLE "OrderReaction" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug}`);
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
