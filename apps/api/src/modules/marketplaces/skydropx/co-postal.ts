import type { SkydropxCity } from '@smartlogistica/shared';

import { CO_POSTAL_ROWS } from './co-postal-codes.data';

/**
 * Catalogo postal de Colombia para el modo Skydropx (el XLSX oficial de
 * 4-72 convertido con scripts/convert-postal-codes.mjs). Es NUESTRO
 * catalogo, independiente del de Coordinadora: ciudad + departamento en el
 * formato que Skydropx espera (area_level1 = departamento completo) y el
 * CP que se auto-asigna SIEMPRE segun la ciudad del pedido.
 */

const norm = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface Indexed extends SkydropxCity {
  key: string; // ciudad (display) normalizada
  keys: string[]; // TODOS los nombres con los que matchea exacto
  deptKey: string;
  main: boolean; // cabecera municipal (DANE termina en 000)
}

const ALL: Indexed[] = CO_POSTAL_ROWS.map(([department, city, postalCode, dane]) => {
  // La cabecera municipal es la fila cuyo DANE termina en 000 — NO la que
  // no trae guion: 55 cabeceras vienen con nombre compuesto ("CARTAGENA DE
  // INDIAS - CARTAGENA") y 18 corregimientos vienen sin guion.
  const main = dane.endsWith('000');
  const segments = city
    .split(' - ')
    .map((s) => s.trim())
    .filter(Boolean);
  // Cabecera con nombre compuesto: se muestra el primer segmento (limpio
  // para el picker y para area_level2), pero matchea por TODOS ("CARTAGENA
  // DE INDIAS" y "CARTAGENA" encuentran la misma fila).
  const display = main && segments.length > 1 ? segments[0] : city;
  return {
    city: display,
    department,
    postalCode,
    dane,
    key: norm(display),
    keys: main ? segments.map(norm) : [norm(city)],
    deptKey: norm(department),
    main,
  };
});

const BY_DANE = new Map<string, Indexed>();
const BY_CITY_DEPT = new Map<string, Indexed>();
const BY_CITY = new Map<string, Indexed>();
for (const e of ALL) {
  if (!BY_DANE.has(e.dane)) BY_DANE.set(e.dane, e);
  if (e.main) {
    for (const k of e.keys) {
      const cd = `${k}|${e.deptKey}`;
      if (!BY_CITY_DEPT.has(cd)) BY_CITY_DEPT.set(cd, e);
      if (!BY_CITY.has(k)) BY_CITY.set(k, e);
    }
  }
}

const toCity = ({ city, department, postalCode, dane }: Indexed): SkydropxCity => ({
  city,
  department,
  postalCode,
  dane,
});

/** CP por codigo DANE exacto (el que trae el catalogo de Coordinadora);
 *  si el DANE es de un corregimiento sin CP propio, cae al municipio. */
export function postalCodeForDane(dane: string | null | undefined): string | null {
  const d = (dane ?? '').trim();
  if (!/^\d{8}$/.test(d)) return null;
  return BY_DANE.get(d)?.postalCode ?? BY_DANE.get(`${d.slice(0, 5)}000`)?.postalCode ?? null;
}

/** CP por nombre de ciudad (+departamento si viene): igualdad normalizada y,
 *  de ultimas, contiene — 'BOGOTA D C' encuentra 'BOGOTA D.C.'. */
export function postalCodeForCity(
  city: string | null | undefined,
  department?: string | null,
): string | null {
  const c = norm(city);
  if (!c) return null;
  const d = norm(department);
  if (d) {
    const hit = BY_CITY_DEPT.get(`${c}|${d}`);
    if (hit) return hit.postalCode;
  }
  const exact = BY_CITY.get(c);
  if (exact) return exact.postalCode;
  // contiene (en ambos sentidos), preferir mismo departamento
  const loose = ALL.filter(
    (e) => e.main && e.keys.some((k) => k.includes(c) || c.includes(k)),
  );
  if (loose.length === 0) return null;
  return (d ? loose.find((e) => e.deptKey === d) : undefined)?.postalCode ?? loose[0].postalCode;
}

/** Busqueda para el selector de ciudad en modo Skydropx: municipios primero,
 *  prefijo antes que contiene; tambien matchea por departamento. */
export function searchCoCities(query: string, limit = 15): SkydropxCity[] {
  const q = norm(query);
  if (!q) {
    return ALL.filter((e) => e.main)
      .slice(0, limit)
      .map(toCity);
  }
  const scoreKey = (k: string, e: Indexed): number => {
    if (k === q) return 0;
    if (k.startsWith(q)) return e.main ? 1 : 3;
    if (k.includes(q)) return e.main ? 2 : 4;
    if (`${k} ${e.deptKey}`.includes(q)) return 5;
    return -1;
  };
  const score = (e: Indexed): number => {
    let best = -1;
    for (const k of e.keys) {
      const s = scoreKey(k, e);
      if (s >= 0 && (best < 0 || s < best)) best = s;
    }
    return best;
  };
  return ALL.map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.e.key.length - b.e.key.length)
    .slice(0, limit)
    .map((x) => toCity(x.e));
}
