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

  /** Minusculas sin acentos, para comparar frases de forma robusta. */
  private normalize(s: string): string {
    return s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  /**
   * Detecta cuando lo que llega como "direccion" es en realidad el texto del
   * boton del flujo (ej: "Modificar mi direccion"), no una direccion real. Pasa
   * cuando el flujo captura {{last_input}} sin esperar la respuesta del cliente.
   */
  private looksLikeButtonText(address: string): boolean {
    const n = this.normalize(address);
    return (
      n === '' ||
      n.includes('modificar mi direccion') ||
      n.includes('modificar direccion') ||
      n.includes('mis datos son correctos')
    );
  }

  async apply(
    tenantId: string,
    prisma: TenantPrismaClient,
    input: ConfirmAddressWebhookInput,
  ): Promise<{ updated: number }> {
    const digits = this.tenDigits(input.phone);
    // Log del telefono crudo que manda Whapify: si un cliente "confirma" pero no
    // se refleja, aqui se ve si el numero llego distinto al del pedido.
    this.logger.log(
      `Webhook direccion recibido: raw="${input.phone}" -> ...${digits} action=${input.action}`,
    );
    if (digits.length < 7) {
      this.logger.warn(`Telefono demasiado corto tras normalizar: "${input.phone}" -> "${digits}"`);
      return { updated: 0 };
    }

    // Salvaguarda del flujo "modificar direccion": si en vez de la direccion llega
    // el texto del boton (porque el flujo no espero la respuesta del cliente antes
    // de capturar {{last_input}}), NO la guardamos -> no envenenamos la guia.
    if (input.action === 'modified' && this.looksLikeButtonText(input.address ?? '')) {
      this.logger.warn(
        `Direccion 'modified' ignorada: llego el texto del boton en vez de la direccion ` +
          `("${input.address ?? ''}"). Revisar el paso de captura de la respuesta en el flujo de Whapify.`,
      );
      return { updated: 0 };
    }

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
