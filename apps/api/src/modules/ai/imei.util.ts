/**
 * Valida un IMEI de 15 digitos con el algoritmo de Luhn (el digito 15 es el
 * check digit). Un numero de 15 digitos que pasa Luhn es un IMEI bien formado.
 */
export function isValidImei(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = imei.charCodeAt(i) - 48;
    // Se duplica cada segunda cifra desde la derecha; en 0-indexed desde la
    // izquierda (largo 15) eso corresponde a los indices impares.
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Extrae los IMEI validos del texto que devuelve el modelo de vision. El prompt
 * pide "uno por linea", pero somos defensivos: normalizamos separadores y
 * validamos con Luhn. Soporta dual-SIM (varios IMEI). Deduplica.
 */
export function extractValidImeis(text: string): string[] {
  const found = new Set<string>();

  // Primario: por linea/separador, quitar todo lo que no sea digito.
  for (const chunk of text.split(/[\n\r,;]+/)) {
    const digits = chunk.replace(/[^0-9]/g, '');
    if (digits.length === 15 && isValidImei(digits)) {
      found.add(digits);
    } else if (digits.length === 16 && isValidImei(digits.slice(0, 15))) {
      // IMEISV (16): los ultimos 2 son version de software; el IMEI son los primeros 15.
      found.add(digits.slice(0, 15));
    }
  }

  // Respaldo: secuencias tipo IMEI con separadores comunes dentro de una linea.
  for (const m of text.match(/(?:\d[ .\-]?){15}\d?/g) ?? []) {
    const digits = m.replace(/[^0-9]/g, '');
    if (digits.length >= 15 && isValidImei(digits.slice(0, 15))) {
      found.add(digits.slice(0, 15));
    }
  }

  return [...found];
}

/**
 * Extrae seriales del texto del modelo. A diferencia del IMEI, el serial NO tiene
 * checksum estandar, asi que NO validamos: tomamos los tokens alfanumericos que
 * el modelo devuelve (uno por linea), limpiando prefijos/etiquetas. Deduplica.
 */
export function parseSerials(text: string): string[] {
  const found = new Set<string>();
  for (const rawLine of text.split(/[\n\r]+/)) {
    let s = rawLine.trim();
    if (!s || s.toUpperCase() === 'NONE') continue;
    // Quitar bullets y etiquetas comunes: "* ", "- ", "S/N:", "Serial:", "SN "
    s = s
      .replace(/^[*\-•\s]+/, '')
      .replace(/^(s\/?n|serial|serie|nro?\.?\s*de\s*serie)\s*[:.\-]?\s*/i, '')
      .trim();
    // Serial: alfanumerico (con posibles - / _), 4 a 40 chars.
    if (/^[A-Za-z0-9][A-Za-z0-9\-/_]{3,39}$/.test(s)) {
      found.add(s);
    }
  }
  return [...found];
}
