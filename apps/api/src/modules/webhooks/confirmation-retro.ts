import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

/**
 * Ventana en la que una confirmacion "huerfana" (llego antes que el pedido)
 * sigue siendo valida para retro-aplicarse al ingresar el pedido.
 */
const WINDOW_MS = 72 * 60 * 60 * 1000;

/** Ultimos 10 digitos del telefono (movil CO), quitando +, 57 y separadores. */
const tenDigits = (phone: string): string => {
  const d = phone.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
  return d.slice(-10);
};

/**
 * Retro-aplica una confirmacion de WhatsApp que llego ANTES de que el pedido
 * ingresara a la plataforma.
 *
 * El mensaje de confirmacion sale cuando la orden se crea en VTEX, pero el
 * espejo solo ingesta el pedido cuando VTEX lo pasa a ready-for-handling
 * (minutos u horas despues). El cliente que responde rapido confirmaba "al
 * aire": el webhook la registraba en ConfirmationLog como "sin pedido
 * pendiente" y el pedido quedaba en "Sin responder" para siempre. Verificado
 * en produccion con diferencias de 58-87 segundos entre ambas.
 *
 * Al ingresar el pedido, si su telefono tiene una confirmacion reciente en el
 * log (que no haya sido descartada), se aplica y el log pasa a "aplicada".
 */
export async function applyRecentConfirmation(
  prisma: TenantPrismaClient,
  order: { id: string; customerPhone: string | null; addressStatus: string | null },
): Promise<boolean> {
  if (!order.customerPhone || order.addressStatus) return false;
  const digits = tenDigits(order.customerPhone);
  if (digits.length < 7) return false;

  const candidates = await prisma.confirmationLog.findMany({
    where: {
      phone: { contains: digits },
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const hit = candidates.find(
    (c) =>
      tenDigits(c.phone) === digits &&
      (c.action === 'confirmed' || c.action === 'modified') &&
      !(c.note ?? '').startsWith('Descartada') &&
      !(c.note ?? '').startsWith('Telefono invalido'),
  );
  if (!hit) return false;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      addressStatus: hit.action,
      confirmedAddress: hit.action === 'modified' ? hit.address : null,
      addressConfirmedAt: hit.createdAt,
    },
  });
  // El log pasa a "aplicada" (matched>0) para que en Ajustes se vea en verde.
  await prisma.confirmationLog.update({
    where: { id: hit.id },
    data: { matched: { increment: 1 }, note: null },
  });
  return true;
}
