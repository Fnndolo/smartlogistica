/**
 * Migracion aditiva: responder/citar + reacciones con emoji en el chat.
 *   - OrderMessage.replyToId TEXT
 *   - Tabla MessageReaction (unique message+user+emoji, FK cascade)
 * Idempotente. Tabla NUEVA -> ALTER OWNER al rol del tenant (sin eso, 42501).
 *
 * Correr desde apps/api:  node --env-file=.env.local scripts/migrate-chat-replies-reactions.mjs
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

const DDL = `
ALTER TABLE "OrderMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
CREATE TABLE IF NOT EXISTS "MessageReaction" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_userId_emoji_key"
  ON "MessageReaction"("messageId", "userId", "emoji");
CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");
DO $$ BEGIN
  ALTER TABLE "MessageReaction"
    ADD CONSTRAINT "MessageReaction_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "OrderMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function main() {
  const control = new Client({ connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL), ssl: ssl() });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName", "dbRole" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(`Migrando chat (respuestas+reacciones) en ${tenants.length} tenant(s)...\n`);
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
      await db.query(DDL);
      await db.query(`ALTER TABLE "MessageReaction" OWNER TO "${t.dbRole}"`);
      console.log(`  ✓ ${t.slug} — replyToId + MessageReaction listos (owner ${t.dbRole})`);
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
