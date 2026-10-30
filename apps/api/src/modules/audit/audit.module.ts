import { Global, Module } from '@nestjs/common';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global: casi todos los modulos dejan rastro (pedidos, equipo, WhatsApp,
 * sedes) y obligar a cada uno a importarlo solo sumaria ruido.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
