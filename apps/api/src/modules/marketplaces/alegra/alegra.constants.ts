/** Base de la API REST de Alegra (v1). Auth = HTTP Basic con `email:token`. */
export const ALEGRA_BASE_URL = 'https://api.alegra.com/api/v1';

/**
 * Limite por llamada a Alegra. Con 15 s, los dias en que Alegra va lento
 * (consultas simples de 8-11 s, medido el 2026-11-03) las facturas se cortaban
 * con "(HTTP ?)" aunque Alegra las terminara creando: quedaban duplicados.
 */
export const ALEGRA_REQUEST_TIMEOUT_MS = 25_000;

/** Crear la factura (con la validacion de la DIAN) tarda mas que una consulta. */
export const ALEGRA_INVOICE_TIMEOUT_MS = 60_000;
