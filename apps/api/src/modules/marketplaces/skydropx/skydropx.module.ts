import { Module } from '@nestjs/common';

import { SkydropxClient } from './skydropx-client.service';
import { SkydropxService } from './skydropx.service';

@Module({
  providers: [SkydropxClient, SkydropxService],
  exports: [SkydropxService],
})
export class SkydropxModule {}
