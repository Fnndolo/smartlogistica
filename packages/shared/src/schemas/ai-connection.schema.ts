import { z } from 'zod';

/**
 * Conexion a un proveedor de IA con vision, a NIVEL TENANT (como VTEX, no por
 * sede). Se usa para extraer el/los IMEI de la foto subida. El proveedor y el
 * modelo son elegibles; la API key va cifrada (envelope), nunca vuelve al front.
 */
export const aiProviderSchema = z.enum(['openai', 'gemini', 'anthropic']);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

/** Modelo de vision por defecto de cada proveedor (editable en la UI). */
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-opus-4-8',
};

export const aiCredentialsSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().trim().min(10, 'API key muy corta').max(512),
  // Si se omite, el server usa AI_DEFAULT_MODELS[provider].
  model: z.string().trim().min(1).max(120).optional(),
});
export type AiCredentialsInput = z.infer<typeof aiCredentialsSchema>;

/** Resumen seguro — NUNCA incluye la API key. */
export const aiConnectionSummarySchema = z.object({
  provider: aiProviderSchema,
  model: z.string(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AiConnectionSummary = z.infer<typeof aiConnectionSummarySchema>;

/** Resultado de "Probar conexion" (no persiste nada). */
export const aiTestResultSchema = z.object({
  ok: z.literal(true),
  modelCount: z.number().int().nullable(),
});
export type AiTestResult = z.infer<typeof aiTestResultSchema>;
