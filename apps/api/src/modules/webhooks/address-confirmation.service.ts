import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';
import type { ConfirmAddressWebhookInput } from '@smartlogistica/shared';

import { RealtimeService } from '../../infrastructure/realtime/realtime.service';

/**
 * Aplica la confirmacion de direccion que llega por WhatsApp (Whapify) a los
 * pedidos PENDIENTES (sin cerrar en VTEX) del telefono que respondio. La
 * direccion es por persona, asi que se marca en todos sus pedidos pendientes.
 */
@Injectable()
export class AddressConfirmationService {
  private readonly logger = new Logger(AddressConfirmationService.name);

  constructor(private readonly realtime: RealtimeService) {}

  /** Ultimos 10 digitos del telefono (movil CO), quitando +, 57 y separadores. */
  private tenDigits(phone: string): string {
    const d = phone.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
    return d.slice(-10);
  }

  async apply(
    tenantId: string,
    prisma: TenantPrismaClient,
    input: ConfirmAddressWebhookInput,
  ): Promise<{ updated: number }> {
    const digits = this.tenDigits(input.phone);
    if (digits.length < 7) return { updated: 0 };

    // Candidatos: pedidos pendientes (no cerrados en VTEX) cuyo telefono contiene
    // esos digitos. Se refina por coincidencia exacta de los ultimos 10.
    const candidates = await prisma.order.findMany({
      where: {
        customerPhone: { contains: digits },
        events: { none: { type: 'vtex_invoiced' } },
      },
      select: { id: true, customerPhone: true },
    });
    const ids = candidates
      .filter((o) => o.customerPhone && this.tenDigits(o.customerPhone) === digits)
      .map((o) => o.id);
    if (ids.length === 0) {
      this.logger.warn(`Confirmacion de direccion sin pedido pendiente para tel ...${digits}`);
      return { updated: 0 };
    }

    const address = input.action === 'modified' ? (input.address?.trim() || null) : null;
    await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: {
        addressStatus: input.action,
        confirmedAddress: address,
        addressConfirmedAt: new Date(),
      },
    });

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    this.logger.log(`Direccion ${input.action} en ${ids.length} pedido(s) del tel ...${digits}`);
    return { updated: ids.length };
  }
}
