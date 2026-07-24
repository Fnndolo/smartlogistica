import { z } from 'zod';

/**
 * Web Push: suscripcion de un dispositivo (tal como la entrega
 * PushSubscription.toJSON() del navegador).
 */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(100),
  }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
