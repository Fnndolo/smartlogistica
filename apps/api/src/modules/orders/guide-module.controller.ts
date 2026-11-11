import { Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import { guideModuleSchema, type GuideModule } from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { loadGuideModule, storeGuideModule } from './guide-module.store';

/**
 * Encender/apagar el MODULO DE GUIAS. Cualquier miembro lo LEE (el drawer
 * decide si muestra la pestaña Guia); solo un admin lo cambia (Ajustes).
 */
@Controller('guide-module')
export class GuideModuleController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get()
  async get(): Promise<GuideModule> {
    return loadGuideModule();
  }

  @Put()
  async save(
    @Body(new ZodValidationPipe(guideModuleSchema)) body: GuideModule,
    @CurrentUser() user: AuthContext,
  ): Promise<GuideModule> {
    if (!isAdmin(user)) {
      throw new ForbiddenException('Solo administradores pueden encender o apagar las guías');
    }
    const saved = await storeGuideModule(body);
    // Las pestañas abiertas re-leen SOLO este ajuste (la pestaña Guia aparece
    // o se va). Evento propio y no orders.refresh: ese recargaria lista,
    // conteos y pulso en todas las pestañas por algo que no cambia pedidos.
    await this.realtime.publish(getTenantContext().tenantId, { kind: 'guide-module.changed' });
    return saved;
  }
}
