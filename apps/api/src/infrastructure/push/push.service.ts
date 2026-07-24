import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

import { ControlPlaneService } from '../prisma/control-plane.service';

/** Lo que se muestra en la notificacion del sistema (lo consume sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  /** Ruta interna a abrir al tocar la notificacion (tambien agrupa por tag). */
  url: string;
}

/**
 * Web Push: notificaciones del SISTEMA aunque la app este CERRADA (el push
 * despierta al Service Worker del dispositivo). Requiere VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY (y opcional VAPID_SUBJECT) en el env; sin ellas el
 * servicio queda apagado sin romper nada.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;
  private readonly publicKey: string;

  constructor(
    private readonly control: ControlPlaneService,
    config: ConfigService,
  ) {
    this.publicKey = config.get<string>('VAPID_PUBLIC_KEY') ?? '';
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY') ?? '';
    const subject = config.get<string>('VAPID_SUBJECT') ?? 'mailto:soporte@smartlogistica.app';
    this.enabled = Boolean(this.publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(subject, this.publicKey, privateKey);
    } else {
      this.logger.warn('Web Push apagado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
    }
  }

  /** Llave publica para que el cliente se suscriba (vacia = push apagado). */
  getPublicKey(): string {
    return this.enabled ? this.publicKey : '';
  }

  /** Alta/refresh de la suscripcion de un dispositivo (upsert por endpoint). */
  async subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ): Promise<void> {
    await this.control.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
      // Si el navegador renueva la suscripcion o entra otro usuario en el
      // mismo dispositivo, el endpoint queda ligado al usuario ACTUAL.
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.control.pushSubscription.delete({ where: { endpoint } }).catch(() => null);
  }

  /**
   * Envia la notificacion a TODOS los dispositivos de los usuarios dados.
   * Fire-and-forget amigable: errores por dispositivo no rompen nada y las
   * suscripciones muertas (404/410) se limpian solas.
   */
  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (!this.enabled || userIds.length === 0) return;
    const subs = await this.control.pushSubscription.findMany({
      where: { userId: { in: [...new Set(userIds)] } },
    });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // El dispositivo revoco la suscripcion: fuera de la lista.
            await this.control.pushSubscription
              .delete({ where: { endpoint: s.endpoint } })
              .catch(() => null);
          } else {
            this.logger.warn(
              `Push fallo (${status ?? '?'}) para ${s.endpoint.slice(0, 60)}...`,
            );
          }
        }
      }),
    );
  }
}
