/**
 * Genera los iconos PWA (PNG) sin dependencias: dibuja el cubo del logo sobre un
 * fondo oscuro de marca, con antialiasing por supersampling, y codifica el PNG a
 * mano (zlib de Node). Salida en public/icons/.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// Paleta de marca.
const BG = [11, 15, 23]; // #0B0F17 (near-black, igual que el tile del logo)
const FG = [255, 255, 255]; // cubo blanco

// Segmentos del cubo del logo, en el viewBox 24x24 (mismos que el <svg>).
const SEGMENTS = [
  [4, 7, 12, 3],
  [12, 3, 20, 7],
  [4, 7, 4, 17],
  [4, 17, 12, 21],
  [12, 21, 20, 17],
  [20, 17, 20, 7],
  [4, 7, 12, 11],
  [12, 11, 20, 7],
  [12, 11, 12, 21],
];

/** Distancia de un punto al segmento AB. */
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Dibuja el icono a `size` px. `padRatio` = margen del cubo (mayor en maskable
 * para respetar la zona segura). `radiusRatio` = redondeo del fondo (0 = full-bleed).
 */
function drawIcon(size, { padRatio = 0.22, radiusRatio = 0.22 } = {}) {
  const SS = 4; // supersampling
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);

  const radius = radiusRatio * S;
  // El cubo (viewBox 24) se escala a un cuadro interior con padding.
  const inner = S * (1 - 2 * padRatio);
  const scale = inner / 24;
  const offset = S * padRatio;
  const stroke = 1.9 * scale; // grosor del trazo escalado
  const half = stroke / 2;

  const roundedAlpha = (x, y) => {
    if (radiusRatio <= 0) return 1;
    // Distancia al borde redondeado (esquinas).
    const cx = Math.min(x, S - x);
    const cy = Math.min(y, S - y);
    if (cx >= radius || cy >= radius) return 1;
    const dx = radius - cx;
    const dy = radius - cy;
    const d = Math.hypot(dx, dy);
    return Math.max(0, Math.min(1, radius - d + 0.5));
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // Fondo (con esquinas redondeadas -> alpha).
      const bgA = roundedAlpha(x + 0.5, y + 0.5);
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];
      let a = bgA;

      // Cubo: coordenada en viewBox.
      const vx = (x - offset) / scale;
      const vy = (y - offset) / scale;
      let dmin = Infinity;
      for (const [ax, ay, bx, by] of SEGMENTS) {
        const d = distToSeg(vx, vy, ax, ay, bx, by) * scale;
        if (d < dmin) dmin = d;
      }
      const cubeCov = Math.max(0, Math.min(1, half - dmin + 0.5));
      if (cubeCov > 0 && bgA > 0) {
        r = FG[0];
        g = FG[1];
        b = FG[2];
        a = Math.max(a, cubeCov);
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = Math.round(a * 255);
    }
  }

  return downsample(buf, S, SS, size);
}

/** Promedia el buffer supersampleado a la resolucion final (antialiasing). */
function downsample(buf, S, SS, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += buf[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// === Codificador PNG (RGBA, sin filtros) ===
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Scanlines con byte de filtro 0.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function save(name, size, opts) {
  const rgba = drawIcon(size, opts);
  writeFileSync(join(OUT, name), encodePng(rgba, size));
  console.log('  ✓', name, `(${size}x${size})`);
}

console.log('Generando iconos PWA...');
save('icon-192.png', 192, { padRatio: 0.24, radiusRatio: 0.22 });
save('icon-512.png', 512, { padRatio: 0.24, radiusRatio: 0.22 });
// Maskable: mas padding (zona segura ~20%) y fondo full-bleed (sin esquinas).
save('icon-maskable-512.png', 512, { padRatio: 0.34, radiusRatio: 0 });
// Apple: iOS aplica su propio redondeo -> fondo full-bleed.
save('apple-touch-icon.png', 180, { padRatio: 0.26, radiusRatio: 0 });
console.log('Listo.');
