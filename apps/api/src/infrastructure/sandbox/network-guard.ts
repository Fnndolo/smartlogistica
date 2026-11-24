import { Logger } from '@nestjs/common';
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import {
  decideOutbound,
  isSandboxMode,
  sandboxAllowedPhones,
  SandboxBlockedError,
  type OutboundDecision,
} from './sandbox-policy';

/**
 * Aplica la regla de sandbox-policy.ts a TODO el trafico saliente del proceso:
 * axios (la instancia por defecto y cada axios.create, que no heredan los
 * interceptores) y el fetch global. Sin SANDBOX_MODE no toca nada.
 *
 * Se instala al IMPORTAR este modulo, que va como PRIMER import de main.ts y
 * workers.ts: asi queda puesto antes de que cualquier servicio cree su cliente.
 *
 * Fuera de su alcance (se frenan en su propio servicio): web-push y el SDK de
 * S3, que usan el modulo https de Node directamente.
 */
const logger = new Logger('ModoPruebas');

function report(d: Exclude<OutboundDecision, { action: 'allow' }>): void {
  if (d.action === 'simulate') logger.log(`Simulado (no salió): ${d.reason}`);
  else logger.warn(`Bloqueado: ${d.reason}`);
}

function install(): boolean {
  if (!isSandboxMode()) return false;
  const phones = sandboxAllowedPhones();

  const guardAxios = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const d = decideOutbound(
      { method: config.method, url: axios.getUri(config), body: config.data },
      phones,
    );
    if (d.action === 'allow') return config;
    report(d);
    if (d.action === 'block') throw new SandboxBlockedError(d.reason);
    // Simulado: responde OK sin salir a la red.
    config.adapter = async (cfg): Promise<AxiosResponse> => ({
      data: { success: true, sandbox: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: cfg,
    });
    return config;
  };

  axios.interceptors.request.use(guardAxios);
  const createInstance = axios.create.bind(axios);
  axios.create = ((cfg) => {
    const instance = createInstance(cfg);
    instance.interceptors.request.use(guardAxios);
    return instance;
  }) as typeof axios.create;

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : input instanceof URL ? input.toString() : String(input);
    const d = decideOutbound(
      { method: init?.method ?? req?.method ?? 'GET', url, body: init?.body },
      phones,
    );
    if (d.action === 'allow') return realFetch(input, init);
    report(d);
    if (d.action === 'block') throw new SandboxBlockedError(d.reason);
    return new Response(JSON.stringify({ success: true, sandbox: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  logger.warn(
    `MODO PRUEBAS ACTIVO: escrituras externas bloqueadas (VTEX, Alegra, guías, webhooks); ` +
      `WhatsApp solo a ${phones.size} número(s) autorizado(s).`,
  );
  return true;
}

export const sandboxGuardInstalled = install();
