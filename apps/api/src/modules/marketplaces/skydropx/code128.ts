/**
 * Code 128 minimo (subconjuntos B y C) para dibujar el codigo de barras de la
 * relacion de despacho con pdfkit. Se calcula aqui en vez de sumar una
 * dependencia: la codificacion es un estandar cerrado y son 30 lineas.
 *
 * Devuelve los ANCHOS de barra/espacio alternados, empezando por barra.
 */

/** Los 107 patrones del estandar (0..105 + arranque/paro). Cada digito es el
 *  ancho en modulos de una barra o espacio, alternando desde barra. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/**
 * Codifica el texto y devuelve los anchos en modulos. Los numeros de guia son
 * todo digitos, asi que se usa el subconjunto C (dos digitos por simbolo, mitad
 * de ancho); cualquier otra cosa cae a B.
 */
export function code128Widths(value: string): number[] {
  const text = value.trim();
  const numericEven = /^\d+$/.test(text) && text.length % 2 === 0;
  const codes: number[] = [];

  if (numericEven) {
    codes.push(START_C);
    for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  } else {
    codes.push(START_B);
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      // Subconjunto B: ASCII 32..126 -> valores 0..94.
      codes.push(c >= 32 && c <= 126 ? c - 32 : 0);
    }
  }

  // Suma de control: arranque + cada valor por su posicion, modulo 103.
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  for (const c of codes) {
    for (const d of PATTERNS[c]) widths.push(Number(d));
  }
  return widths;
}
