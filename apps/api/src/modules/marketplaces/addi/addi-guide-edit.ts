/**
 * Edicion del REMITENTE de una guia de Addi en la suite de Coordinadora.
 *
 * Funciones PURAS (sin red): el cuerpo del PUT se arma EXACTAMENTE como lo
 * arma el formulario "Editar guia" de la suite (envios.coordinadora.com), con
 * una diferencia deliberada: el DESTINATARIO viaja tal cual esta guardado en la
 * guia. En la suite, al tocar el remitente el formulario deja la direccion del
 * destinatario en blanco (Addi la crea como "Otra direccion" y el formulario no
 * la recarga) y hay que volver a escribirla; aqui no se toca.
 */

/** La guia tal como la devuelve `GET guiasService/guias/{codigo}` (lo que usamos). */
export interface SuiteGuide {
  codigoRemision: string;
  identificacion: string;
  division: string | null;
  proceso: number | null;
  tipoCuenta: string | number | null;
  nombreRemitente: string | null;
  correoRemitente: string | null;
  ciudadRemitente: string | null;
  direccionRemitente: string | null;
  nombreDestinatario: string | null;
  documentoDestinatario: string | null;
  tipoDocumentoDestinatario: string | number | null;
  indicativoDestinatario: string | null;
  celularDestinatario: string | null;
  correoDestinatario: string | null;
  ciudadDestinatario: string | null;
  detalleDestinatario: string | null;
  tipoViaDestinatario: string | number | null;
  descripcionTipoViaDestinatario: string | null;
  viaDestinatario: string | null;
  numeroDestinatario: string | null;
  otraDireccionDestinatario: string | null;
  direccionDestinatario: string | null;
  codigoPostalDestinatario: string | null;
  localidadDestinatario: string | null;
  valorDeclarado: string | number | null;
  referenciaGuia: string | null;
  observaciones: string | null;
  contenido: string | null;
  nivelServicio: number | null;
  valorRecaudar: string | number | null;
  referenciaRecaudo: string | null;
  tipoProducto: string | number | null;
  quienPagaEnvio: string | null;
  codigoPais: number | null;
  cuentaContable: string | null;
  centroCostos: string | null;
  detalle: Array<{
    largo: number;
    alto: number;
    ancho: number;
    peso: number;
    cantidad: number;
    referencia: string | null;
    ubl: number | null;
    id_contenido: number | null;
    valorDeclarado: number | null;
  }>;
}

/** Remitente de una sede (CoordinadoraConnection de la plataforma). */
export interface SedeSender {
  name: string;
  phone: string;
  address: string;
  cityCode: string;
  postalCode: string | null;
}

/** Datos de la sesion de la suite que el formulario mete en el cuerpo. */
export interface SuiteActor {
  idUser: number;
  email: string;
  tipoPerfil: number;
}

/** Catalogo de tipos de via de Coordinadora (tipo-vias). */
const VIA_TYPES: Array<{ id: number; label: string; re: RegExp }> = [
  // Orden: los compuestos ANTES que sus prefijos ("Avenida calle" antes que "Avenida").
  { id: 3, label: 'Avenida calle', re: /^(?:AVENIDA\s+CALLE|AV\.?\s*CALLE|AC)$/ },
  { id: 4, label: 'Avenida carrera', re: /^(?:AVENIDA\s+CARRERA|AV\.?\s*CARRERA|AK|AV\.?\s*KR)$/ },
  { id: 2, label: 'Avenida', re: /^(?:AVENIDA|AV|AVE)$/ },
  { id: 5, label: 'Calle', re: /^(?:CALLE|CL|CLL)$/ },
  { id: 6, label: 'Carrera', re: /^(?:CARRERA|CRA|CR|KR|KRA|CRR|CARRERRA)$/ },
  { id: 8, label: 'Circunvalar', re: /^(?:CIRCUNVALAR|CV|CIRC)$/ },
  { id: 7, label: 'Circular', re: /^(?:CIRCULAR|CQ)$/ },
  { id: 9, label: 'Diagonal', re: /^(?:DIAGONAL|DG|DIAG)$/ },
  { id: 10, label: 'Manzana', re: /^(?:MANZANA|MZ|MZA)$/ },
  { id: 11, label: 'Transversal', re: /^(?:TRANSVERSAL|TV|TR|TRANSV)$/ },
  { id: 12, label: 'Vía', re: /^(?:VIA)$/ },
];
/** "Otra direccion": texto libre (es como Addi crea las guias). */
export const OTHER_ADDRESS_VIA = { id: 20, label: 'Otra dirección' } as const;

/** Lo que hace la suite al guardar (L.Sv): quitar tildes. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Caracteres que la suite no deja escribir en un detalle de direccion. */
const DETAIL_FORBIDDEN = /['":;*~+÷¡@%!¯¿?=^&$_€×`<¥>{}()|[\]/\\]/g;
const clean = (s: string) => stripAccents(s).replace(/\s+/g, ' ').trim();
const cleanDetail = (s: string) =>
  clean(s.replace(DETAIL_FORBIDDEN, ' ')).replace(/^[\s,.-]+|[\s,.-]+$/g, '');

export interface ParsedAddress {
  tipoVia: number;
  descripcionTipoVia: string;
  via: string;
  numero: string;
  otraDireccion: string;
  /** Lo que la suite guarda como direccion: "Calle 16 # 23-30" u "Otra direccion" literal. */
  direccion: string;
  detalle: string;
}

/**
 * Convierte la direccion de la sede (texto libre, ej. "CALLE 16 # 23 - 71
 * CENTRO") al formato DETALLADO de Coordinadora: tipo de via + via + numero +
 * detalle — como quedan las guias que el equipo edita a mano ("Calle 16 #
 * 23-30", detalle "CENTRO"). Lo que no se reconoce va como "Otra direccion"
 * (texto libre, igual que crea Addi sus guias): nunca se pierde.
 */
export function parseSedeAddress(raw: string): ParsedAddress {
  const text = clean(raw).toUpperCase();
  // <tipo via> <via> # <placa>-<placa>   (el "#" tambien llega como "No.")
  const re =
    /(?:^|[\s,;-])((?:AVENIDA|AV\.?)\s+(?:CALLE|CARRERA|KR)|AVENIDA|AVE|AV\.?|CALLE|CLL|CL|CARRERA|CARRERRA|CRA|CRR|KRA|KR|CR|AC|AK|CIRCUNVALAR|CIRC|CV|CIRCULAR|CQ|DIAGONAL|DIAG|DG|MANZANA|MZA|MZ|TRANSVERSAL|TRANSV|TV|TR|VIA)\.?\s*(\d+\s?[A-Z]{0,3}(?:\s?BIS)?(?:\s?[A-Z])?)\s*(?:#|N[O°º]\.?|NUMERO)\s*(\d+\s?[A-Z]{0,2})\s*-\s*(\d+\s?[A-Z]?)(?=$|[\s,;.-])/;
  const m = re.exec(text);
  if (m) {
    const keyword = m[1].replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const type = VIA_TYPES.find((t) => t.re.test(keyword));
    if (type) {
      const via = m[2].replace(/\s+/g, ' ').trim();
      const numero = `${m[3].replace(/\s+/g, '')}-${m[4].replace(/\s+/g, '')}`;
      const before = text.slice(0, m.index).trim();
      const after = text.slice(m.index + m[0].length).trim();
      const detalle = [cleanDetail(after), cleanDetail(before)].filter(Boolean).join(' - ');
      return {
        tipoVia: type.id,
        descripcionTipoVia: type.label,
        via,
        numero,
        otraDireccion: '',
        direccion: `${type.label} ${via} # ${numero}`,
        detalle: detalle.slice(0, 100),
      };
    }
  }
  const free = cleanDetail(raw).slice(0, 100);
  return {
    tipoVia: OTHER_ADDRESS_VIA.id,
    descripcionTipoVia: OTHER_ADDRESS_VIA.label,
    via: '',
    numero: '',
    otraDireccion: free,
    direccion: free,
    detalle: '',
  };
}

const str = (v: unknown): string => (v == null ? '' : String(v));
/** L.MH de la suite: hay valor y no es el texto "null". */
const present = (v: unknown): boolean => {
  const s = str(v).trim();
  return s !== '' && s !== 'null' && s !== 'undefined';
};

/**
 * Cuerpo de `PUT suiteBackendService/guias` para cambiar SOLO el remitente.
 * Campo por campo es lo que manda el formulario de la suite al guardar una
 * guia cargada para editar; todo lo que no es remitente sale de la guia misma.
 */
export function buildSenderUpdate(
  guide: SuiteGuide,
  sender: SedeSender,
  actor: SuiteActor,
): Record<string, unknown> {
  const addr = parseSedeAddress(sender.address);
  const tipoProducto = str(guide.tipoProducto) || '4';
  const special = tipoProducto === '8' || tipoProducto === '16';
  const nivel = guide.nivelServicio ?? 1;
  const ubl = tipoProducto !== '4' && tipoProducto !== '2' ? Number(tipoProducto) : 0;

  // Destinatario TAL CUAL. Si es "Otra direccion" (como la crea Addi) se
  // repite el texto en otraDireccion: es de donde la suite la reconstruye.
  const viaDest = str(guide.tipoViaDestinatario) || String(OTHER_ADDRESS_VIA.id);
  const dirDest = stripAccents(str(guide.direccionDestinatario));
  const otraDest = stripAccents(
    str(guide.otraDireccionDestinatario) ||
      (viaDest === String(OTHER_ADDRESS_VIA.id) ? str(guide.direccionDestinatario) : ''),
  );

  return {
    identificacion: guide.identificacion,
    idProceso: guide.proceso ?? null,
    divisionCliente: guide.division || '00',
    codigoPais: guide.codigoPais ?? 170,
    valoracion: present(guide.valorDeclarado) ? str(guide.valorDeclarado) : null,
    tipoCuenta: guide.tipoCuenta,
    contenido: guide.contenido,
    idUsuario: actor.idUser,
    idPlataforma: '1',
    tipoPerfil: actor.tipoPerfil || 1,
    nivelServicio: nivel,
    valorRecaudar: nivel === 22 && present(guide.valorRecaudar) ? str(guide.valorRecaudar) : null,
    referenciaRecaudo: nivel === 22 ? guide.referenciaRecaudo : null,
    detalle: guide.detalle.map((d) => ({
      pesoReal: d.peso,
      largo: d.largo,
      ancho: d.ancho,
      alto: d.alto,
      unidades: d.cantidad,
      ubl,
      referencia: d.referencia,
      ...(d.valorDeclarado ? { valorDeclarado: d.valorDeclarado } : {}),
      ...(d.id_contenido ? { idContenido: d.id_contenido } : {}),
    })),
    datosRemitente: {
      identificacionRemitente: null,
      tipoDocumentoRemitente: null,
      detalleRemitente: addr.detalle,
      viaRemitente: addr.via,
      tipoViaRemitente: String(addr.tipoVia),
      numeroRemitente: addr.numero,
      codigoCiudadRemitente: sender.cityCode,
      descripcionTipoViaRemitente: addr.descripcionTipoVia,
      direccionRemitente: addr.direccion,
      nombreRemitente: clean(sender.name).slice(0, 80),
      indicativoRemitente: '57',
      celularRemitente: sender.phone.replace(/\D/g, '').slice(-10),
      // La sede no guarda correo: se conserva el de la guia (el del comercio en Addi).
      correoRemitente: guide.correoRemitente,
      otraDireccionRemitente: addr.otraDireccion,
      localidadRemitente: '',
      ...(sender.postalCode ? { codigoPostalRemitente: sender.postalCode } : {}),
    },
    datosDestinatario: {
      identificacionDestinatario: present(guide.documentoDestinatario)
        ? guide.documentoDestinatario
        : null,
      tipoDocumentoDestinatario: present(guide.tipoDocumentoDestinatario)
        ? str(guide.tipoDocumentoDestinatario)
        : null,
      detalleDestinatario: present(guide.detalleDestinatario)
        ? stripAccents(str(guide.detalleDestinatario))
        : '',
      tipoViaDestinatario: viaDest,
      viaDestinatario: stripAccents(str(guide.viaDestinatario)),
      numeroDestinatario: stripAccents(str(guide.numeroDestinatario)),
      descripcionTipoViaDestinatario: guide.descripcionTipoViaDestinatario,
      direccionDestinatario: dirDest,
      codigoCiudadDestinatario: guide.ciudadDestinatario,
      nombreDestinatario: guide.nombreDestinatario,
      indicativoDestinatario: guide.indicativoDestinatario,
      celularDestinatario: guide.celularDestinatario,
      correoDestinatario: guide.correoDestinatario,
      otraDireccionDestinatario: otraDest,
      localidadDestinatario: stripAccents(str(guide.localidadDestinatario)).trim(),
      ...(present(guide.codigoPostalDestinatario)
        ? { codigoPostalDestinatario: guide.codigoPostalDestinatario }
        : {}),
    },
    tipoGuia: 1,
    referenciaGuia: guide.referenciaGuia,
    usuario: actor.email,
    fuente: 'envios',
    observaciones: guide.observaciones ?? '',
    cuentaContable: str(guide.cuentaContable).trim() || null,
    centroCostos: str(guide.centroCostos).trim() || null,
    tipoProducto: special ? '6' : tipoProducto,
    quienPagaEnvio: guide.quienPagaEnvio || '1',
    tipoEnvioEspecial: special,
    codigoRemision: guide.codigoRemision,
  };
}
