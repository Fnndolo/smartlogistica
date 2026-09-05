/**
 * Siembra la ULTIMA LISTA BUENA de plantillas (AppSetting `wa:templates:<linea>`).
 *
 * Sirve para el caso en que el proveedor deja de devolver el listado — pierde
 * el permiso de gestion sobre la WABA — conservando el de enviar. Entonces el
 * selector de "/" se queda vacio y no se puede mandar una plantilla a mano,
 * aunque todas funcionen. Con la lista sembrada, vuelven a verse.
 *
 * Las definiciones salen de recreate-d360-templates.mjs: un solo sitio donde
 * viven los textos, para que no se separen.
 *
 *   node --env-file=.env.local scripts/seed-template-cache.mjs          -> seco
 *   node --env-file=.env.local scripts/seed-template-cache.mjs --apply
 */
import pg from 'pg';
import { TEMPLATES } from './recreate-d360-templates.mjs';

const { Client } = pg;
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

/** Mismo mapeo que wa-template-mapper.ts, en lo que necesita el cache. */
function toRaw(t) {
  const comps = t.components ?? [];
  const head = comps.find((c) => c.type === 'HEADER');
  const body = comps.find((c) => c.type === 'BODY');
  const foot = comps.find((c) => c.type === 'FOOTER');
  const btns = comps.find((c) => c.type === 'BUTTONS');
  const text = body?.text ?? '';
  return {
    id: t.name,
    name: t.name,
    language: t.language,
    category: t.category,
    status: 'approved',
    rejectedReason: null,
    header: head ? { format: head.format ?? 'TEXT', text: head.text ?? '' } : null,
    body: text,
    footer: foot ? foot.text : null,
    buttons: (btns?.buttons ?? []).map((b) => ({
      type: b.type === 'URL' ? 'URL' : 'QUICK_REPLY',
      text: b.text,
      ...(b.url ? { url: b.url } : {}),
    })),
    variables: new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size,
    examples: body?.example?.body_text?.[0] ?? [],
    createdAt: null,
    templateId: null,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  await control.end();

  const db = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await db.connect();
  const lines = (await db.query(`SELECT id, label, provider FROM "WaLine" ORDER BY "createdAt" ASC`)).rows;
  const line = lines.find((l) => l.provider === 'dialog360') ?? lines[0];
  if (!line) { console.log('No hay lineas.'); await db.end(); return; }

  const list = TEMPLATES.map(toRaw);
  console.log(`Tenant ${t.slug} · linea "${line.label}" (${line.id})`);
  console.log(`${list.length} plantillas a sembrar:`);
  for (const x of list) console.log(`  ${x.name} [${x.language}] ${x.category} · ${x.variables} var · ${x.buttons.length} boton(es)`);

  const key = `wa:templates:${line.id}`;
  const prev = (await db.query(`SELECT value FROM "AppSetting" WHERE key=$1`, [key])).rows[0];
  console.log(`\nYa habia guardado: ${prev ? `${prev.value?.list?.length ?? 0} plantilla(s)` : 'nada'}`);

  if (!apply) { console.log('\nSECO. Usa --apply para escribirlo.'); await db.end(); return; }
  const value = JSON.stringify({ at: new Date().toISOString(), list });
  await db.query(
    `INSERT INTO "AppSetting" (key, value, "updatedAt") VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, "updatedAt" = now()`,
    [key, value],
  );
  console.log('\nSembrado. El selector de "/" ya deberia mostrarlas (avisando de que son las ultimas conocidas).');
  await db.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
