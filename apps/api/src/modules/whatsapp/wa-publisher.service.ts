import { Injectable } from '@nestjs/common';
import type { WaMessage as WaMessageDto } from '@smartlogistica/shared';
import type { PrismaClient } from '.prisma/tenant-client';

import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { waKindOf, type WaMessageRow } from './wa-shared';

/**
 * Publicador de mensajes de WhatsApp: fila WaMessage -> DTO (con URLs
 * firmadas) + publicacion SSE. Lo comparten los envios (WhatsappService)
 * y la recepcion (WhatsappWebhookService).
 */
@Injectable()
export class WaPublisherService {
  constructor(
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Publica wa.message CON el mensaje ya montado: el panel lo PINTA AL
   * INSTANTE (cero refetch). El evento generico {phone} queda como respaldo.
   */
  async publishWaMessage(
    tenantId: string,
    prisma: PrismaClient,
    row: WaMessageRow & { phone: string },
  ): Promise<void> {
    try {
      let byId: Map<string, WaMessageRow> | undefined;
      if (row.replyToId) {
        const quoted = await prisma.waMessage.findUnique({ where: { id: row.replyToId } });
        if (quoted) byId = new Map([[quoted.id, quoted as WaMessageRow]]);
      }
      const message = await this.toDto(row, byId);
      await this.realtime.publish(tenantId, {
        kind: 'wa.message',
        phone: row.phone,
        message: message as unknown as Record<string, unknown>,
      });
    } catch {
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone: row.phone });
    }
  }

  async toDto(r: WaMessageRow, byId?: Map<string, WaMessageRow>): Promise<WaMessageDto> {
    const mediaUrl = r.attachmentKey
      ? await this.storage.getSignedUrl(r.attachmentKey).catch(() => null)
      : r.mediaUrl;
    const quoted = r.replyToId && byId ? byId.get(r.replyToId) : undefined;
    // Stickers de ANTES del kind propio: quedaron como image .webp — se
    // retro-detectan para pintarlos como sticker (sueltos, sin burbuja).
    const kind =
      waKindOf(r.kind) === 'image' && (r.attachmentKey ?? '').toLowerCase().endsWith('.webp')
        ? ('sticker' as const)
        : waKindOf(r.kind);
    const reactions = Array.isArray(r.reactions)
      ? (r.reactions as Array<{ emoji?: unknown; mine?: unknown }>)
          .filter((x) => x && typeof x.emoji === 'string' && x.emoji)
          .map((x) => ({ emoji: String(x.emoji), mine: Boolean(x.mine) }))
      : [];
    const status = ['sent', 'delivered', 'read', 'failed'].includes(r.status ?? '')
      ? (r.status as WaMessageDto['status'])
      : null;
    return {
      id: r.id,
      direction: r.direction === 'out' ? 'out' : 'in',
      kind,
      body: r.body,
      mediaUrl,
      authorName: r.authorName,
      buttons: Array.isArray(r.buttons) ? (r.buttons as unknown[]).map(String) : [],
      replyTo: quoted
        ? {
            id: quoted.id,
            direction: quoted.direction === 'out' ? 'out' : 'in',
            kind: waKindOf(quoted.kind),
            body: quoted.body,
            authorName: quoted.authorName,
          }
        : null,
      reactions,
      status,
      error: r.error ?? null,
      edited: Boolean(r.edited),
      starred: Boolean(r.starred),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
