import type { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Utilidades de MEDIOS para WhatsApp (sin estado): transcodificacion de notas
 * de voz (ffmpeg) y normalizacion de stickers (sharp).
 */

/**
 * Transcodifica CUALQUIER audio del navegador a OGG/Opus (el formato de
 * nota de voz que WhatsApp SI acepta) con ffmpeg-static. null si falla.
 */
export async function toOggOpus(
  buffer: Buffer,
  mime: string,
  logger?: Logger,
): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const ffmpegPath = (await import('ffmpeg-static')).default as unknown as string | null;
    if (!ffmpegPath) return null;
    const [os, fs, path, cp, util] = await Promise.all([
      import('node:os'),
      import('node:fs/promises'),
      import('node:path'),
      import('node:child_process'),
      import('node:util'),
    ]);
    const run = util.promisify(cp.execFile);
    const inExt = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const inPath = path.join(os.tmpdir(), `${randomUUID()}.${inExt}`);
    const outPath = path.join(os.tmpdir(), `${randomUUID()}.ogg`);
    await fs.writeFile(inPath, buffer);
    // OJO: -map_metadata -1 es OBLIGATORIO. ffmpeg copia la metadata del
    // mp4 del navegador (creation_time/handler_name/major_brand...) dentro
    // del OGG y Meta RECHAZA la entrega de esos OGG con 131053 (verificado
    // por probe: el mismo audio limpio ENTREGA, con metadata NO).
    await run(
      ffmpegPath,
      [
        '-y',
        '-i',
        inPath,
        '-vn',
        '-map_metadata',
        '-1',
        '-map',
        '0:a:0',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-fflags',
        '+bitexact',
        '-flags:a',
        '+bitexact',
        outPath,
      ],
      { timeout: 30_000 },
    );
    const out = await fs.readFile(outPath);
    await fs.unlink(inPath).catch(() => null);
    await fs.unlink(outPath).catch(() => null);
    return out.length > 0 ? { buffer: out, mime: 'audio/ogg' } : null;
  } catch (err) {
    logger?.warn(`Transcode a ogg fallo: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Meta EXIGE stickers estaticos webp 512x512 de MENOS de 100KB: los que
 * pasan de ahi los ACEPTA al subir pero los rechaza al ENTREGAR (131053
 * silencioso). Se re-comprimen aca con sharp hasta caber.
 */
export async function normalizeSticker(buffer: Buffer): Promise<Buffer> {
  const LIMIT = 95 * 1024;
  if (buffer.length <= LIMIT) return buffer;
  const sharp = (await import('sharp')).default;
  const encode = (quality: number) =>
    sharp(buffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality })
      .toBuffer();
  for (const q of [80, 65, 50, 35, 25]) {
    const out = await encode(q);
    if (out.length <= LIMIT) return out;
  }
  return encode(15);
}
