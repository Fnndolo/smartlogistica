import { Controller, Get, Query } from '@nestjs/common';
import { auditQuerySchema, type AuditPage, type AuditQuery } from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { AuditService } from './audit.service';

/** Bitacora del workspace (Registros). Solo el propietario: lo valida el servicio. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
    @CurrentUser() user: AuthContext,
  ): Promise<AuditPage> {
    return this.audit.list(query, user);
  }
}
