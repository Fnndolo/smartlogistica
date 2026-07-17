import { z } from 'zod';

const accountNameRegex = /^[a-z0-9-]{3,40}$/;

export const vtexAccountNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(accountNameRegex, 'Solo minusculas, numeros y guiones (3-40 chars)');

export const vtexCredentialsSchema = z.object({
  accountName: vtexAccountNameSchema,
  appKey: z.string().trim().min(20, 'App Key invalida').max(256),
  appToken: z.string().trim().min(40, 'App Token invalido').max(2048),
});

export type VtexCredentialsInput = z.infer<typeof vtexCredentialsSchema>;

export const vtexTestConnectionSchema = vtexCredentialsSchema;
export const vtexCreateConnectionSchema = vtexCredentialsSchema;

export const vtexConnectionSummarySchema = z.object({
  id: z.string(),
  provider: z.literal('vtex'),
  accountName: vtexAccountNameSchema,
  status: z.enum(['connected', 'error', 'disabled']),
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type VtexConnectionSummary = z.infer<typeof vtexConnectionSummarySchema>;
