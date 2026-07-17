import type { Prisma } from '.prisma/tenant-client';

import type { VtexOrderDetail } from './vtex.types';

/**
 * Mapea un VtexOrderDetail al payload de Prisma.OrderUncheckedCreateInput / UpdateInput.
 * Mantiene el detail completo en rawPayload para que no perdamos campos al evolucionar.
 */
export function mapVtexOrderToUpsert(
  accountName: string,
  detail: VtexOrderDetail,
): {
  create: Prisma.OrderUncheckedCreateInput;
  update: Prisma.OrderUncheckedUpdateInput;
} {
  const customer = detail.clientProfileData ?? {};
  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || '(sin nombre)';
  const totalUnits = (detail.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);

  const base = {
    externalId: detail.orderId,
    provider: 'vtex',
    accountName,
    customerName,
    customerEmail: customer.email ?? null,
    customerDocument: customer.document ?? null,
    customerPhone: customer.phone ?? null,
    status: detail.status,
    totalValue: detail.value != null ? toMoneyString(detail.value) : '0.00',
    currency: detail.currencyCode ?? 'COP',
    totalUnits,
    marketplaceCreatedAt: new Date(detail.creationDate),
    rawPayload: detail as unknown as Prisma.InputJsonValue,
  };

  return {
    create: base,
    update: base,
  };
}

export function mapVtexOrderItems(detail: VtexOrderDetail): Prisma.OrderItemUncheckedCreateWithoutOrderInput[] {
  return (detail.items ?? []).map((item) => ({
    sku: item.refId ?? item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: toMoneyString(item.price ?? 0),
  }));
}

/**
 * VTEX devuelve montos en centavos (entero). Convertimos a decimal con 2 lugares.
 * Ejemplo: 199900 → "1999.00"
 */
function toMoneyString(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
