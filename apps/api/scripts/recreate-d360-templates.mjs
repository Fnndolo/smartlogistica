/**
 * RECREA todas las plantillas del negocio en la WABA.
 *
 * Cuando 360dialog "repara" un canal puede re-registrar el numero en una WABA
 * NUEVA, y las plantillas NO viajan: la cuenta queda en cero y con ella dejan
 * de salir la confirmacion, la guia y el respaldo. Esto las vuelve a crear con
 * los textos EXACTOS que ya estaban aprobados, sacados de los scripts que las
 * crearon en su dia (create-d360-template*.mjs).
 *
 * Lee la credencial de `WaLine` (la tabla actual; los scripts viejos leen
 * `Dialog360Connection`, que ya no existe).
 *
 * Es IDEMPOTENTE: primero lista lo que ya hay y se salta las que existan, asi
 * que se puede correr varias veces sin duplicar ni pisar nada.
 *
 *   node --env-file=.env.local scripts/recreate-d360-templates.mjs           -> que haria (SECO)
 *   node --env-file=.env.local scripts/recreate-d360-templates.mjs --apply   -> crearlas de verdad
 *   node --env-file=.env.local scripts/recreate-d360-templates.mjs --apply confirmacion_compra_smart
 */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';
import { pathToFileURL } from 'node:url';

const { Client } = pg;

function kekDecrypt(b, k) { const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]); }
function decField(b, dek) { const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8'); }
const stripSsl = (u) => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const pgSsl = () => (process.env.TENANT_DB_SSLMODE ?? 'require') === 'disable' ? undefined : { rejectUnauthorized: false };
const adminDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

// ===================== LOS TEXTOS, TAL CUAL ESTABAN =====================

const CONFIRMACION_BODY =
  '¡Hola {{1}}! 👋 Es un gusto saludarle 😃\n\n' +
  'Le escribimos de Smart Gadgets para confirmar su compra de:\n' +
  '📱 {{2}}\n' +
  'Por nuestra plataforma de ADDI 💙\n\n' +
  '📍 A la dirección:\n' +
  '{{3}}\n\n' +
  'Si desea agregar alguna información adicional o más específica, quedamos atentos ' +
  'para incluirla en la guía 😉\n\n' +
  '🔍 ¿Me confirma si sus datos son correctos? ‼️';

const guiaBody = (link) =>
  'Le comparto la guía para el seguimiento de su pedido que estará disponible hoy después de las 6 pm⏱️,\n\n' +
  `📡Puedes rastrear tu envío en:➡️ ${link} ingresando el numero de guía que esta en el archivo adjunto.\n\n` +
  '⚠️Al momento de recibir su pedido es importante revisar que el paquete este SELLADO y nos confirme cuando llegue a la dirección indicada.⚠️\n\n' +
  '✅¡NO OLVIDES REGISTRAR TU EQUIPO EN TU OPERADOR CON LA FACTURA!📲🤗\n\n' +
  '¡Que tenga un excelente día lleno de bendiciones!💙\n\n' +
  'Por favor me confirma si la guía está correcta 🫶🏻';

const RESPALDO_BODY =
  'Hola {{1}} 👋, su pedido ya fue ENTREGADO 📦✅\n\n' +
  'Ahora que ya tiene su equipo en la mano, piense un segundo: ¿qué pasa si se lo roban 🚨 o se ' +
  'le cae al piso la próxima semana? 📱💥 Reponerlo cuesta lo mismo que acaba de pagar.\n\n' +
  'Con el RESPALDO de Smart Gadgets eso deja de ser un riesgo:\n\n' +
  '✅ Cubre ROBO, caídas y accidentes\n' +
  '✅ Protección por UN AÑO completo\n' +
  '✅ Solo el 10% del valor de su equipo\n' +
  '✅ En cuotas cómodas con Addi 💙\n\n' +
  'Todavía está a tiempo de activarlo: toque el botón y su asesor le confirma de una vez las cuotas y el medio de pago 👇';

/** El PDF de muestra que Meta exige para aprobar un encabezado de documento. */
const SAMPLE_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const GUIA_LINKS = {
  guia_envio_pedido: 'https://coordinadora.com/rastreo/rastreo-de-guia/',
  guia_envio_smart: 'https://coordinadora.com/rastreo/rastreo-de-guia/',
  guia_envio_inter: 'https://siguetuenvio.interrapidisimo.com/',
  guia_envio_envia: 'https://envia.co/',
  guia_envio_servientrega: 'https://www.servientrega.com/wps/portal/rastreo-envio',
};

export const TEMPLATES = [
  // --- La confirmacion del pedido. Es la mas importante: sin ella no sale el
  //     primer mensaje a ningun cliente nuevo.
  {
    name: 'confirmacion_compra_smart',
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: CONFIRMACION_BODY,
        example: { body_text: [['DAVID CASTRO', '1 IPHONE 17 PRO MAX 256', 'CALLE 16 # 23-71 CENTRO']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Mis datos son correctos.' },
          { type: 'QUICK_REPLY', text: 'Modificar mi dirección.' },
        ],
      },
    ],
  },

  // --- Las guias: mismo texto, cambia el link de rastreo. El encabezado es un
  //     DOCUMENTO porque el rotulo va como PDF en el mismo mensaje.
  ...Object.entries(GUIA_LINKS).map(([name, link]) => ({
    name,
    language: 'es',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [SAMPLE_PDF] } },
      { type: 'BODY', text: guiaBody(link) },
    ],
  })),

  // --- El respaldo post-venta. Tres nombres con el mismo contenido: el codigo
  //     prueba en orden y usa la primera APROBADA (Meta a veces rechaza una y
  //     aprueba otra identica).
  ...['respaldo_entregado_pro', 'respaldo_entregado_full', 'respaldo_entregado_smart'].map((name) => ({
    name,
    language: 'es',
    category: 'MARKETING',
    components: [
      { type: 'BODY', text: RESPALDO_BODY, example: { body_text: [['DAVID']] } },
      // Meta NO admite emojis ni saltos de linea en el texto de un boton.
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quiero mi respaldo' }] },
    ],
  })),

  // --- Saludo suelto: sirve para retomar cualquier conversacion pasada la
  //     ventana de 24h desde el picker de "/".
  {
    name: 'saludo_general',
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hola, buen día. Te saludamos de Smart Gadgets 😊 Queremos continuar con tu solicitud.',
      },
    ],
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const kek = Buffer.from(process.env.KEK_V1 ?? '', 'base64');
  const control = new Client({ connectionString: stripSsl(process.env.CONTROL_PLANE_DATABASE_URL), ssl: pgSsl() });
  await control.connect();
  const t = (await control.query(`SELECT id, slug, "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek = kekDecrypt((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`, [t.id])).rows[0].wrappedDek, kek);
  await control.end();

  const tdb = new Client({ connectionString: stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL, t.dbName)), ssl: pgSsl() });
  await tdb.connect();
  const line = (await tdb.query(`SELECT label, mode, "encryptedApiKey" FROM "WaLine" WHERE provider='dialog360' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  await tdb.end();
  if (!line) { console.log('No hay linea de 360dialog.'); return; }
  if (line.mode !== 'production') { console.log('La linea no esta en produccion.'); return; }

  const http = axios.create({
    baseURL: 'https://waba-v2.360dialog.io',
    // LARGO a proposito: con encabezado de documento, 360dialog descarga el PDF
    // de muestra y lo sube a Meta dentro de la misma llamada.
    timeout: 180_000,
    headers: { 'D360-API-KEY': decField(line.encryptedApiKey, dek), 'Content-Type': 'application/json' },
  });

  console.log(`Tenant ${t.slug} · linea "${line.label}"\n`);

  const existing = new Map();
  try {
    const res = (await http.get('/v1/configs/templates', { params: { limit: 200 } })).data;
    for (const x of res?.waba_templates ?? res?.templates ?? []) {
      existing.set(`${x.name}:${x.language}`, String(x.status ?? '').toLowerCase());
    }
    console.log(`Ya hay ${existing.size} plantilla(s) en la WABA.`);
  } catch (e) {
    console.log('No se pudo listar lo existente:', e.response?.status, JSON.stringify(e.response?.data ?? e.message).slice(0, 300));
    console.log('Se aborta: sin saber que hay, crear a ciegas puede duplicar.');
    return;
  }

  const targets = TEMPLATES.filter((x) => only.length === 0 || only.includes(x.name));
  console.log(`\n${apply ? 'CREANDO' : 'SECO (usa --apply para crearlas)'} — ${targets.length} plantilla(s)\n`);

  let creadas = 0, saltadas = 0, fallidas = 0;
  for (const tpl of targets) {
    const key = `${tpl.name}:${tpl.language}`;
    if (existing.has(key)) {
      console.log(`  = ${tpl.name} — ya existe (${existing.get(key)}), se salta`);
      saltadas++;
      continue;
    }
    if (!apply) {
      console.log(`  + ${tpl.name} [${tpl.category}] — se crearia`);
      continue;
    }
    try {
      const res = (await http.post('/v1/configs/templates', tpl)).data;
      console.log(`  + ${tpl.name} -> ${String(res?.status ?? 'creada').toLowerCase()}`);
      creadas++;
    } catch (e) {
      console.log(`  ! ${tpl.name} FALLO ${e.response?.status}: ${JSON.stringify(e.response?.data ?? e.message).slice(0, 400)}`);
      fallidas++;
    }
  }

  if (apply) {
    console.log(`\nCreadas ${creadas} · saltadas ${saltadas} · fallidas ${fallidas}`);
    console.log('Meta las revisa antes de dejarlas enviar: quedan en "pending" un rato.');
  }
}
// Solo corre si se invoca directamente: el seeder de abajo lo importa por sus
// definiciones y no debe disparar creaciones contra Meta al hacerlo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
