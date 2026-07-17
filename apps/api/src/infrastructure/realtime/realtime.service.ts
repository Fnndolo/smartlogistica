import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';

/**
 * Evento de cambios sobre pedidos de un tenant. El cliente (SSE) solo lo usa
 * como senal "algo cambio, refresca"; el `kind` y `externalId` quedan para
 * evolucionar a updates granulares mas adelante.
 */
export interface OrderRealtimeEvent {
  kind: 'order.upserted' | 'order.removed' | 'orders.refresh';
  externalId?: string;
  at: number;
}

const CHANNEL_PREFIX = 'rt:tenant:';
const CHANNEL_SUFFIX = ':orders';
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*${CHANNEL_SUFFIX}`;

/**
 * Bus de tiempo real basado en Redis Pub/Sub + un EventEmitter local.
 *
 * - UN solo connection subscriber por proceso (psubscribe con wildcard), sin
 *   importar cuantos clientes SSE haya conectados. Cada replica del API recibe
 *   todos los eventos y filtra localmente por tenant.
 * - publish() lo usan los workers (backfill/webhook) tras mutar pedidos.
 * - subscribe() lo usa el endpoint SSE; devuelve una funcion de limpieza que
 *   DEBE llamarse al desconectar el cliente para no fugar listeners.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private publisher!: Redis;
  private subscriber!: Redis;
  private readonly emitter = new EventEmitter();

  constructor(private readonly config: ConfigService) {
    // Muchos clientes SSE => muchos listeners. Sin limite artificial.
    this.emitter.setMaxListeners(0);
  }

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) throw new Error('REDIS_URL es requerido para RealtimeService');

    this.publisher = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });

    this.subscriber.psubscribe(CHANNEL_PATTERN).catch((err) => {
      this.logger.error({ err }, 'Failed to psubscribe to realtime channel');
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const tenantId = this.parseTenantId(channel);
      if (!tenantId) return;
      try {
        const event = JSON.parse(message) as OrderRealtimeEvent;
        this.emitter.emit(tenantId, event);
      } catch (err) {
        this.logger.warn({ err, channel }, 'Malformed realtime message');
      }
    });

    this.logger.log('RealtimeService listening on Redis pub/sub');
  }

  async publish(tenantId: string, event: Omit<OrderRealtimeEvent, 'at'>): Promise<void> {
    if (!this.publisher) return;
    const payload: OrderRealtimeEvent = { ...event, at: Date.now() };
    await this.publisher
      .publish(this.channel(tenantId), JSON.stringify(payload))
      .catch((err) => this.logger.warn({ err, tenantId }, 'Failed to publish realtime event'));
  }

  /** Suscribe un handler a los eventos de un tenant. Devuelve la funcion de limpieza. */
  subscribe(tenantId: string, handler: (event: OrderRealtimeEvent) => void): () => void {
    this.emitter.on(tenantId, handler);
    return () => this.emitter.off(tenantId, handler);
  }

  private channel(tenantId: string): string {
    return `${CHANNEL_PREFIX}${tenantId}${CHANNEL_SUFFIX}`;
  }

  private parseTenantId(channel: string): string | null {
    if (!channel.startsWith(CHANNEL_PREFIX) || !channel.endsWith(CHANNEL_SUFFIX)) return null;
    return channel.slice(CHANNEL_PREFIX.length, channel.length - CHANNEL_SUFFIX.length) || null;
  }

  async onModuleDestroy(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.subscriber?.quit().catch(() => null);
    await this.publisher?.quit().catch(() => null);
  }
}
