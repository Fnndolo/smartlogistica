/**
 * Garantiza el binario de ffmpeg ANTES de arrancar el API (notas de voz).
 * Si el gestor de paquetes no corrio el postinstall de ffmpeg-static (pnpm
 * bloquea scripts segun version/entorno), aqui se corre su install.js para
 * descargarlo. Idempotente y NUNCA bloquea el arranque: si falla, el API
 * arranca igual y cada envio de nota de voz da su error claro.
 * Se invoca desde el startCommand de Railway (apps/api/railway.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

try {
  const bin = require('ffmpeg-static');
  if (bin && fs.existsSync(bin)) {
    console.log(`[ensure-ffmpeg] listo: ${bin}`);
    process.exit(0);
  }
  const pkgDir = path.dirname(require.resolve('ffmpeg-static/package.json'));
  console.log(`[ensure-ffmpeg] binario AUSENTE -> descargando con ${path.join(pkgDir, 'install.js')}`);
  execFileSync(process.execPath, [path.join(pkgDir, 'install.js')], { cwd: pkgDir, stdio: 'inherit' });
  console.log(`[ensure-ffmpeg] resultado: ${bin && fs.existsSync(bin) ? `OK (${bin})` : 'AUN FALTA (revisar red del build)'}`);
} catch (err) {
  console.error(`[ensure-ffmpeg] error (el API arranca igual): ${err?.message ?? err}`);
}
process.exit(0);
