import { Module } from '@nestjs/common';

import { TenantsModule } from '../tenants/tenants.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  imports: [TenantsModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService],
  exports: [SessionService, PasswordService],
})
export class AuthModule {}
