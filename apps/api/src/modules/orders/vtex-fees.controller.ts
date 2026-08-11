import { Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import { DEFAULT_VTEX_FEES, vtexFeesSchema, type VtexFees } from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { getTenantContext } from '../../infrastructure/tenant-context';

/**
 * Descuentos del NETO VTEX (clic en el precio de la tabla): comision % + IVA %
 * sobre la comision + valor fijo. GLOBAL (AppSetting key 'vtexFees'): cualquier
 * miembro lo LEE (la tabla calcula el neto con esto); solo un admin lo edita
 * (Ajustes). Es un calculo VISUAL — no toca facturas ni guias.
 */
@Controller('vtex-fees')
export class VtexFeesController {
  @Get()
  async get(): Promise<VtexFees> {
    const { prisma } = getTenantContext();
    const row = await prisma.appSetting.findUnique({ where: { key: 'vtexFees' } });
    if (!row) return DEFAULT_VTEX_FEES;
    const parsed = vtexFeesSchema.safeParse(row.value);
    return parsed.success ? parsed.data : DEFAULT_VTEX_FEES;
  }

  @Put()
  async save(
    @Body(new ZodValidationPipe(vtexFeesSchema)) body: VtexFees,
    @CurrentUser() user: AuthContext,
  ): Promise<VtexFees> {
    if (!isAdmin(user)) {
      throw new ForbiddenException('Solo administradores pueden editar los descuentos del neto');
    }
    const { prisma } = getTenantContext();
    await prisma.appSetting.upsert({
      where: { key: 'vtexFees' },
      create: { key: 'vtexFees', value: body as unknown as Prisma.InputJsonValue },
      update: { value: body as unknown as Prisma.InputJsonValue },
    });
    return body;
  }
}
