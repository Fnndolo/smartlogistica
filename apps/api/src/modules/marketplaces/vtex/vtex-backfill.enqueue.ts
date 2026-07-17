import type { Queue } from 'bullmq';

/**
 * Encola un backfill/reconciliacion para una conexion VTEX de forma robusta.
 *
 * GOTCHA BullMQ: un `add` con un jobId que YA existe en Redis (incluso en estado
 * `completed`/`failed`) es ignorado silenciosamente — el job no vuelve a correr.
 * Si un backfill quedo retenido (p.ej. removeOnComplete por conteo), bloquea para
 * siempre los re-encolados (reconcile periodico, "Sincronizar"). Por eso:
 *   - si hay un job activo con ese id -> no solapamos (lo dejamos terminar).
 *   - si hay uno en cualquier otro estado -> lo removemos antes de re-encolar.
 *   - removeOnComplete/Fail:true para que NUNCA quede retenido a futuro.
 */
export async function enqueueVtexBackfill(
  queue: Queue,
  tenantId: string,
  accountName: string,
): Promise<void> {
  const jobId = `${tenantId}__${accountName}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => 'unknown');
    if (state === 'active') return; // ya corriendo; evitar solapamiento
    await existing.remove().catch(() => undefined);
  }
  await queue.add(
    'backfill',
    { tenantId, accountName },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    },
  );
}
