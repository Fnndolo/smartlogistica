import { Module } from '@nestjs/common';

import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  providers: [TenantProvisioningService],
  exports: [TenantProvisioningService],
})
export class TenantsModule {}
