import { z } from 'zod';

const accountNameRegex = /^[a-z0-9-]{3,40}$/;

export const vtexAccountNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(accountNameRegex, 'Solo minusculas, numeros y guiones (3-40 chars)');

/**
 * NOMBRE visible de la tienda ("Smart Gadgets", "Outlet"). Con dos VTEX
 * conectados es lo unico que distingue una de otra en las pestañas de pedidos
 * y en la lista de conexiones. Se puede cambiar cuando se quiera: el que manda
 * para los datos sigue siendo `accountName`, que nunca cambia.
 */
export const vtexConnectionLabelSchema = z.string().trim().min(2).max(40);

export const vtexCredentialsSchema = z.object({
  accountName: vtexAccountNameSchema,
  /** Vacio = se usa el accountName como nombre visible. */
  label: vtexConnectionLabelSchema.optional(),
  appKey: z.string().trim().min(20, 'App Key invalida').max(256),
  appToken: z.string().trim().min(40, 'App Token invalido').max(2048),
});

export type VtexCredentialsInput = z.infer<typeof vtexCredentialsSchema>;

export const vtexTestConnectionSchema = vtexCredentialsSchema;
export const vtexCreateConnectionSchema = vtexCredentialsSchema;

/** Renombrar una conexion ya creada (no toca credenciales ni pedidos). */
export const vtexRenameConnectionSchema = z.object({ label: vtexConnectionLabelSchema });
export type VtexRenameConnectionInput = z.infer<typeof vtexRenameConnectionSchema>;

export const vtexConnectionSummarySchema = z.object({
  id: z.string(),
  provider: z.literal('vtex'),
  accountName: vtexAccountNameSchema,
  /** Nombre visible. Nunca vacio: cae al accountName si no se puso ninguno. */
  label: z.string(),
  status: z.enum(['connected', 'error', 'disabled']),
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type VtexConnectionSummary = z.infer<typeof vtexConnectionSummarySchema>;
