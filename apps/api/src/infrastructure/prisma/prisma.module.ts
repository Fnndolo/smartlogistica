import { Global, Module } from '@nestjs/common';

import { ControlPlaneService } from './control-plane.service';
import { TenantConnectionService } from './tenant-connection.service';

@Global()
@Module({
  providers: [ControlPlaneService, TenantConnectionService],
  exports: [ControlPlaneService, TenantConnectionService],
})
export class PrismaModule {}
