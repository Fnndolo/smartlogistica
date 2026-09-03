import type { WaTemplateLite, WaTemplateRaw } from './wa-client.port';

// Respuestas de terceros: acceso laxo a proposito.
type Any = Record<string, any>;

/**
 * Una plantilla del proveedor -> nuestra forma.
 *
 * Vive en un fichero propio y lo usan LOS DOS clientes (360dialog y Meta) a
 * proposito: la respuesta cruda es practicamente la misma — ambos devuelven el
 * `components` de Meta — y tener dos mapeadores gemelos garantiza que un dia
 * se separen y una plantilla se vea distinta segun el numero por el que se
 * mire. Un solo mapeador, un solo bug posible.
 *
 * Lo que normaliza, porque hay codigo que depende de ello:
 *  - `status` SIEMPRE en minusculas (una decena de sitios comparan con
 *    'approved'; Meta lo manda en MAYUSCULAS y 360dialog en minusculas).
 *  - `rejected_reason: 'NONE'` es "no la han rechazado", no un motivo.
 *  - los ejemplos vienen anidados un nivel de mas: [[ "v1", "v2" ]].
 */
export function mapTemplateRow(tpl: Any): WaTemplateRaw {
  const comps: Any[] = Array.isArray(tpl?.components) ? tpl.components : [];
  const head = comps.find((c) => c?.type === 'HEADER');
  const body = comps.find((c) => c?.type === 'BODY');
  const foot = comps.find((c) => c?.type === 'FOOTER');
  const btns = comps.find((c) => c?.type === 'BUTTONS');
  const bodyText = String(body?.text ?? '');
  const rejected = String(tpl?.rejected_reason ?? '');

  return {
    id: String(tpl?.id ?? tpl?.external_id ?? tpl?.name ?? ''),
    name: String(tpl?.name ?? ''),
    language: String(tpl?.language ?? 'es'),
    category: String(tpl?.category ?? ''),
    status: String(tpl?.status ?? '').toLowerCase(),
    rejectedReason: rejected && rejected !== 'NONE' ? rejected : null,
    header: head ? { format: String(head.format ?? 'TEXT'), text: String(head.text ?? '') } : null,
    body: bodyText,
    footer: foot ? String(foot.text ?? '') : null,
    buttons: ((btns?.buttons ?? []) as Any[])
      .map((b) => ({
        type: String(b?.type) === 'URL' ? ('URL' as const) : ('QUICK_REPLY' as const),
        text: String(b?.text ?? ''),
        ...(b?.url ? { url: String(b.url) } : {}),
      }))
      .filter((b) => b.text.length > 0),
    variables: countVars(bodyText),
    examples: ((body?.example?.body_text?.[0] ?? []) as Any[]).map((v) => String(v)),
    createdAt: tpl?.created_at ? String(tpl.created_at) : null,
    // Solo Meta trae un id propio con el que se podria editar. 360dialog
    // devuelve un id opaco suyo que no sirve para eso.
    templateId: typeof tpl?.id === 'string' && /^\d+$/.test(tpl.id) ? tpl.id : null,
  };
}

/** La version corta que consume el picker de "/" y los mensajes automaticos. */
export function toTemplateLite(t: WaTemplateRaw): WaTemplateLite {
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    body: t.body,
    buttons: t.buttons.map((b) => b.text),
  };
}

/** Cuantos huecos {{n}} DISTINTOS usa el cuerpo. */
function countVars(body: string): number {
  return new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
}

/**
 * El `components` que espera el proveedor al CREAR. Identico en los dos: es el
 * formato de Meta, y 360dialog lo pasa tal cual.
 */
export function buildTemplateComponents(input: {
  header?: string;
  body: string;
  examples: string[];
  footer?: string;
  buttons: Array<{ type: 'QUICK_REPLY' | 'URL'; text: string; url?: string }>;
}): Any[] {
  const components: Any[] = [];
  if (input.header) components.push({ type: 'HEADER', format: 'TEXT', text: input.header });
  components.push({
    type: 'BODY',
    text: input.body,
    // Sin `example` Meta rechaza cualquier plantilla con variables.
    ...(input.examples.length > 0 ? { example: { body_text: [input.examples] } } : {}),
  });
  if (input.footer) components.push({ type: 'FOOTER', text: input.footer });
  if (input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) =>
        b.type === 'URL'
          ? { type: 'URL', text: b.text, url: b.url }
          : { type: 'QUICK_REPLY', text: b.text },
      ),
    });
  }
  return components;
}
