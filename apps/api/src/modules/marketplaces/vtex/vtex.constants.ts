/**
 * Estados de pedido que nos importan para el backfill y webhooks.
 * Lista oficial: https://developers.vtex.com/docs/guides/erp-integration-order-status
 *
 * En Fase 1 solo procesamos `ready-for-handling` y `handling` — son los estados
 * "para preparar" segun el manual de logistica de Addi.
 */
// Fase 1: solo "Listo para preparar". Ni "Preparando" (handling) ni los posteriores.
// Cuando el operador interno avanza un pedido, sale automaticamente de esta lista.
export const VTEX_RELEVANT_STATUSES = ['ready-for-handling'] as const;
export type VtexRelevantStatus = (typeof VTEX_RELEVANT_STATUSES)[number];

export const VTEX_HOST = (accountName: string): string =>
  `https://${accountName}.vtexcommercestable.com.br`;

export const VTEX_HEADERS = {
  appKey: 'X-VTEX-API-AppKey',
  appToken: 'X-VTEX-API-AppToken',
} as const;

export const VTEX_REQUEST_TIMEOUT_MS = 15_000;
