#!/usr/bin/env node
/**
 * Levanta un tunel publico (cloudflared quick tunnel) hacia el API local
 * (localhost:3001), captura la URL `*.trycloudflare.com` y la escribe en
 * apps/api/.env.local como PUBLIC_WEBHOOK_BASE_URL. Sin cuenta, sin tokens.
 *
 * Uso:
 *   1) pnpm tunnel        (deja esta terminal abierta)
 *   2) pnpm dev           (en otra terminal — el API arranca con la URL ya seteada)
 *   3) En la app: Conexiones -> Sincronizar (registra el webhook con la URL nueva)
 *
 * La URL cambia cada vez que corres este script; "Sincronizar" re-registra el
 * webhook en VTEX automaticamente, asi que no hay nada manual que copiar.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', 'apps', 'api', '.env.local');
const LOCAL_PORT = 3001;
const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function resolveCloudflared() {
  // 1) en PATH
  // 2) ruta tipica de winget (Packages)
  const wingetPackages = join(
    homedir(),
    'AppData',
    'Local',
    'Microsoft',
    'WinGet',
    'Packages',
  );
  if (existsSync(wingetPackages)) {
    for (const dir of readdirSync(wingetPackages)) {
      if (dir.toLowerCase().includes('cloudflare.cloudflared')) {
        const exe = join(wingetPackages, dir, 'cloudflared.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return 'cloudflared'; // fallback: confiar en PATH
}

function patchEnv(url) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `PUBLIC_WEBHOOK_BASE_URL=${url}`;
  if (/^PUBLIC_WEBHOOK_BASE_URL=.*$/m.test(content)) {
    content = content.replace(/^PUBLIC_WEBHOOK_BASE_URL=.*$/m, line);
  } else {
    content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
  }
  writeFileSync(ENV_PATH, content, 'utf8');
}

const bin = resolveCloudflared();
console.log(`[tunnel] usando: ${bin}`);
console.log(`[tunnel] abriendo tunel hacia http://localhost:${LOCAL_PORT} ...`);

const child = spawn(bin, ['tunnel', '--url', `http://localhost:${LOCAL_PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let urlCaptured = false;
function handle(buf) {
  const text = buf.toString();
  process.stdout.write(text);
  if (!urlCaptured) {
    const m = text.match(TRYCLOUDFLARE_RE);
    if (m) {
      urlCaptured = true;
      const url = m[0];
      patchEnv(url);
      console.log('\n==================================================================');
      console.log(`[tunnel] URL publica: ${url}`);
      console.log(`[tunnel] escrita en apps/api/.env.local (PUBLIC_WEBHOOK_BASE_URL)`);
      console.log('[tunnel] Ahora: (re)inicia `pnpm dev` y pulsa "Sincronizar" en Conexiones.');
      console.log('==================================================================\n');
    }
  }
}

child.stdout.on('data', handle);
child.stderr.on('data', handle); // cloudflared imprime la URL por stderr

child.on('exit', (code) => {
  console.log(`[tunnel] cloudflared termino (code=${code})`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
