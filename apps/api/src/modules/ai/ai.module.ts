import { Module } from '@nestjs/common';

import { AiConnectionController } from './ai-connection.controller';
import { AiConnectionService } from './ai-connection.service';
import { AiVisionClient } from './ai-vision-client.service';

@Module({
  controllers: [AiConnectionController],
  providers: [AiConnectionService, AiVisionClient],
  exports: [AiConnectionService, AiVisionClient],
})
export class AiModule {}
