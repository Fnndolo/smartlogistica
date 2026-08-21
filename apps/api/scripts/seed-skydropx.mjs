/**
 * Guarda las credenciales de SKYDROPX cifradas (sobre KEK->DEK, igual que el
 * EnvelopeService del API: campo = iv(12) + tag(16) + cifrado AES-256-GCM).
 * Correr desde apps/api:
 *   node --env-file=.env.local scripts/seed-skydropx.mjs <API_KEY> <API_SECRET> [sandbox|production]
 */
import pg from 'pg';
import crypto from 'node:crypto';

const { Client } = pg;
const KEY = process.argv[2];
const SECRET = process.argv[3];
const MODE = process.argv[4] === 'production' ? 'production' : 'sandbox';
if (!KEY || !SECRET) {
  console.log('uso: node scripts/seed-skydropx.mjs <API_KEY> <API_SECRET> [sandbox|production]');
  process.exit(1);
}

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function encField(plain, dek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

async function main() {
  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();

  const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await db.connect();
  await db.query(`DELETE FROM "SkydropxConnection"`);
  await db.query(
    `INSERT INTO "SkydropxConnection" (id, "encryptedApiKey", "encryptedApiSecret", mode, status)
     VALUES ($1, $2, $3, $4, 'connected')`,
    [crypto.randomUUID().replace(/-/g, '').slice(0, 25), encField(KEY, dek), encField(SECRET, dek), MODE],
  );
  const check = await db.query(`SELECT mode, status, "createdAt" FROM "SkydropxConnection"`);
  console.log('Conexion Skydropx guardada:', check.rows[0]);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
