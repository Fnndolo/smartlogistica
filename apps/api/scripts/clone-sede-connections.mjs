/**
 * Clona las CONEXIONES de una sede a su gemela, emparejando por NOMBRE:
 * "ELEVEN <resto>" toma lo de "PEDIDOS <resto>" (solo cambia la primera palabra).
 *
 * Copia tres cosas:
 *   · AlegraConnection      (email + token cifrado)
 *   · CoordinadoraConnection (credenciales + REMITENTE/origen de la sede)
 *   · SkydropxSedeConfig     (direccion de origen fijada en el panel de Skydropx)
 *
 * Los blobs cifrados se copian TAL CUAL: el envelope cifra con la DEK del
 * TENANT (envelope.service.ts:87-98), sin atarse a la sede, asi que el mismo
 * ciphertext descifra igual desde otra sede del mismo tenant.
 *
 * NUNCA pisa lo que ya existe: si la sede destino ya tiene esa conexion, se
 * salta y lo dice. No toca plantillas de certificado ni cliente fijo.
 *
 * Empareja por NOMBRE a proposito: los slugs de este tenant no son de fiar
 * ("PEDIDOS PASTO CUADRAS" tiene slug 'pedidos-pasto-16').
 *
 *   node --env-file=.env.local scripts/clone-sede-connections.mjs           # simula
 *   node --env-file=.env.local scripts/clone-sede-connections.mjs --commit  # escribe
 */
import pg from 'pg';

const { Client } = pg;
const COMMIT = process.argv.includes('--commit');

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

/** "ELEVEN PASTO 16" -> "PASTO 16" (todo menos la primera palabra). */
const restOf = (name) => name.trim().split(/\s+/).slice(1).join(' ');

async function run(db, slug) {
  const { rows: sedes } = await db.query(
    `SELECT id, name FROM "Warehouse" WHERE archived = false ORDER BY name ASC`,
  );

  const targets = sedes.filter((w) => /^ELEVEN\s/i.test(w.name));
  const sources = new Map(
    sedes.filter((w) => /^PEDIDOS\s/i.test(w.name)).map((w) => [restOf(w.name).toUpperCase(), w]),
  );

  console.log(`\n===== ${slug} =====`);
  for (const dst of targets) {
    const src = sources.get(restOf(dst.name).toUpperCase());
    if (!src) {
      console.log(`\n  ${dst.name}\n    ✗ sin gemela "PEDIDOS ${restOf(dst.name)}" — se salta`);
      continue;
    }
    console.log(`\n  ${dst.name}   <=   ${src.name}`);

    // --- Alegra ---
    const { rows: aDst } = await db.query(
      `SELECT id FROM "AlegraConnection" WHERE "warehouseId"=$1`,
      [dst.id],
    );
    const { rows: aSrc } = await db.query(
      `SELECT * FROM "AlegraConnection" WHERE "warehouseId"=$1`,
      [src.id],
    );
    if (aDst.length) console.log('    · Alegra: YA la tiene, no se toca');
    else if (!aSrc.length) console.log('    · Alegra: la gemela no tiene, nada que copiar');
    else {
      const a = aSrc[0];
      if (COMMIT) {
        await db.query(
          `INSERT INTO "AlegraConnection" (id,"warehouseId",email,"encryptedToken","companyName",status,"createdAt","updatedAt")
           VALUES (gen_random_uuid()::text,$1,$2,$3,$4,'connected',NOW(),NOW())`,
          [dst.id, a.email, a.encryptedToken, a.companyName],
        );
      }
      console.log(`    ${COMMIT ? '✓' : '→'} Alegra: ${a.email}`);
    }

    // --- Coordinadora (credenciales + REMITENTE) ---
    const { rows: cDst } = await db.query(
      `SELECT id FROM "CoordinadoraConnection" WHERE "warehouseId"=$1`,
      [dst.id],
    );
    const { rows: cSrc } = await db.query(
      `SELECT * FROM "CoordinadoraConnection" WHERE "warehouseId"=$1`,
      [src.id],
    );
    if (cDst.length) console.log('    · Coordinadora: YA la tiene, no se toca');
    else if (!cSrc.length) console.log('    · Coordinadora: la gemela no tiene, nada que copiar');
    else {
      const c = cSrc[0];
      if (COMMIT) {
        await db.query(
          `INSERT INTO "CoordinadoraConnection"
             (id,"warehouseId","idCliente",usuario,"encryptedPassword",nit,div,"rotuloId",
              "senderName","senderNit","senderPhone","senderAddress","senderCityCode","senderCityName",
              "senderPostalCode",status,"createdAt","updatedAt")
           VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'connected',NOW(),NOW())`,
          [
            dst.id,
            c.idCliente,
            c.usuario,
            c.encryptedPassword,
            c.nit,
            c.div,
            c.rotuloId,
            c.senderName,
            c.senderNit,
            c.senderPhone,
            c.senderAddress,
            c.senderCityCode,
            c.senderCityName,
            c.senderPostalCode,
          ],
        );
      }
      console.log(`    ${COMMIT ? '✓' : '→'} Coordinadora: ${c.usuario}`);
      console.log(
        `        remitente "${c.senderName}" / ${c.senderAddress} / ${c.senderCityName ?? c.senderCityCode} / CP ${c.senderPostalCode ?? '-'} / rotulo ${c.rotuloId}`,
      );
    }

    // --- Skydropx (direccion de origen fijada) ---
    // OJO: SkydropxSedeConfig usa warehouseId como clave primaria, no tiene "id".
    const { rows: sDst } = await db.query(
      `SELECT "warehouseId" FROM "SkydropxSedeConfig" WHERE "warehouseId"=$1`,
      [dst.id],
    );
    const { rows: sSrc } = await db.query(
      `SELECT * FROM "SkydropxSedeConfig" WHERE "warehouseId"=$1`,
      [src.id],
    );
    if (sDst.length) console.log('    · Skydropx: YA lo tiene, no se toca');
    else if (!sSrc.length)
      console.log('    · Skydropx: la gemela no tiene remitente fijado, nada que copiar');
    else {
      const s = sSrc[0];
      if (COMMIT) {
        await db.query(
          `INSERT INTO "SkydropxSedeConfig" ("warehouseId","addressTemplateId",alias,city,"postalCode","updatedAt")
           VALUES ($1,$2,$3,$4,$5,NOW())`,
          [dst.id, s.addressTemplateId, s.alias, s.city, s.postalCode],
        );
      }
      console.log(
        `    ${COMMIT ? '✓' : '→'} Skydropx: ${s.alias ?? s.addressTemplateId}${s.city ? ` · ${s.city}` : ''}${s.postalCode ? ` · CP ${s.postalCode}` : ''}`,
      );
    }
  }
}

async function main() {
  const control = new Client({
    connectionString: strip(process.env.CONTROL_PLANE_DATABASE_URL),
    ssl: ssl(),
  });
  await control.connect();
  const { rows: tenants } = await control.query(
    `SELECT slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC`,
  );
  await control.end();

  console.log(
    COMMIT ? '>>> ESCRIBIENDO <<<' : '>>> SIMULACION (sin --commit no se escribe nada) <<<',
  );
  for (const t of tenants) {
    const db = new Client({
      connectionString: strip(forDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)),
      ssl: ssl(),
    });
    await db.connect();
    try {
      await run(db, t.slug);
    } finally {
      await db.end().catch(() => null);
    }
  }
  console.log('\nListo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
