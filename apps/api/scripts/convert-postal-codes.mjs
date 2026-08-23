/**
 * Convierte el XLSX de codigos postales de Colombia (raiz del repo:
 * "Códigos postales nacionales.xlsx" — columnas departamento / Ciudad -
 * Corregimiento / codigo_postal / codigo_dane) en un dataset TS embebido
 * (JSON.parse de un literal: rapido para tsc y sin assets sueltos).
 * Correr desde apps/api: node scripts/convert-postal-codes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const xlsx = path.resolve(here, '..', '..', '..', 'Códigos postales nacionales.xlsx');
const outTs = path.resolve(here, '..', 'src', 'modules', 'marketplaces', 'skydropx', 'co-postal-codes.data.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpco-'));
const zip = path.join(tmp, 'cp.zip'); // Expand-Archive solo acepta extension .zip
fs.copyFileSync(xlsx, zip);
execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force"`);

const sharedXml = fs.readFileSync(path.join(tmp, 'xl', 'sharedStrings.xml'), 'utf8');
const strings = [...sharedXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
const sheet = fs.readFileSync(path.join(tmp, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];

/** Departamento canonico por prefijo DANE (la columna departamento del XLSX
 *  trae typos: HULA, MNARINOETA, tres variantes de Bogota...). */
const DEPT_BY_DANE = {
  '05': 'Antioquia', '08': 'Atlántico', '11': 'Bogotá D.C.', '13': 'Bolívar',
  '15': 'Boyacá', '17': 'Caldas', '18': 'Caquetá', '19': 'Cauca', '20': 'Cesar',
  '23': 'Córdoba', '25': 'Cundinamarca', '27': 'Chocó', '41': 'Huila',
  '44': 'La Guajira', '47': 'Magdalena', '50': 'Meta', '52': 'Nariño',
  '54': 'Norte de Santander', '63': 'Quindío', '66': 'Risaralda',
  '68': 'Santander', '70': 'Sucre', '73': 'Tolima', '76': 'Valle del Cauca',
  '81': 'Arauca', '85': 'Casanare', '86': 'Putumayo',
  '88': 'San Andrés y Providencia', '91': 'Amazonas', '94': 'Guainía',
  '95': 'Guaviare', '97': 'Vaupés', '99': 'Vichada',
};

const data = [];
const seenDane = new Set();
for (let i = 1; i < rows.length; i++) {
  const cells = [...rows[i][1].matchAll(/<c([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/g)].map((m) =>
    /t="s"/.test(m[1]) ? strings[Number(m[2])] : (m[2] ?? ''),
  );
  const [deptRaw, cityRaw, cpRaw, daneRaw] = cells.map((c) => String(c ?? '').trim());
  const cp = cpRaw;
  const dane = daneRaw;
  if (!cityRaw || !/^\d{6}$/.test(cp) || !/^\d{8}$/.test(dane)) continue;
  if (seenDane.has(dane)) continue; // duplicados (Bogota viene 3 veces, etc.)
  seenDane.add(dane);
  const dept = DEPT_BY_DANE[dane.slice(0, 2)] ?? deptRaw;
  let city = cityRaw.replace(/\s+/g, ' ');
  if (dane === '11001000') city = 'BOGOTÁ D.C.';
  data.push([dept, city, cp, dane]);
}

const json = JSON.stringify(data);
const ts = `/**
 * Codigos postales de COLOMBIA (generado desde "Códigos postales
 * nacionales.xlsx" con scripts/convert-postal-codes.mjs — NO editar a mano).
 * Filas: [departamento, ciudad-corregimiento, codigo_postal, codigo_dane].
 * Las filas SIN " - " en la ciudad son el municipio principal (su CP es el
 * que se auto-asigna); las demas son corregimientos.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const CO_POSTAL_ROWS: ReadonlyArray<readonly [string, string, string, string]> = JSON.parse(
  ${JSON.stringify(json)},
);
`;
fs.writeFileSync(outTs, ts);
console.log(`OK: ${data.length} filas -> ${outTs} (${Math.round(ts.length / 1024)}KB)`);
