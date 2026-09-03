import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dialog360Mode } from '@smartlogistica/shared';

import { Dialog360Client } from './dialog360-client.service';
import { Dialog360WaClient } from './dialog360-wa-client';
import { MetaClient } from './meta-client.service';
import { MetaWaClient } from './meta-wa-client';
import type { WaClient } from './wa-client.port';

/** Lo que hace falta de una fila WaLine para construir su cliente. */
export interface WaLineRef {
  id: string;
  provider: string;
  mode: string;
  phoneNumberId: string | null;
  wabaId: string | null;
}

/**
 * El UNICO sitio del servidor que decide con que proveedor se habla.
 *
 * Todo lo demas — envios, recepcion, plantillas, automaticos — trabaja contra
 * `WaClient` y no sabe si detras hay 360dialog o Meta. Mientras el resto del
 * codigo no vuelva a inyectar una clase concreta, no puede volver a acoplarse.
 */
@Injectable()
export class WaClientFactory {
  constructor(
    private readonly dialog360: Dialog360Client,
    private readonly meta: MetaClient,
  ) {}

  create(conn: WaLineRef, apiKey: string): WaClient {
    if (conn.provider === 'meta') {
      // Sin estos dos ids no hay ni ruta de envio ni ruta de plantillas. El
      // alta los exige, asi que llegar aqui sin ellos es una fila corrupta.
      if (!conn.phoneNumberId || !conn.wabaId) {
        throw new BadRequestException(
          'Esa línea de Meta está incompleta: le falta el ID del número o el de la WABA',
        );
      }
      return new MetaWaClient(this.meta, apiKey, conn.phoneNumberId, conn.wabaId, conn.id);
    }
    const mode: Dialog360Mode = conn.mode === 'sandbox' ? 'sandbox' : 'production';
    return new Dialog360WaClient(
      this.dialog360,
      this.dialog360.buildHttp(apiKey, mode),
      mode,
      apiKey,
      conn.id,
    );
  }
}
