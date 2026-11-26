import { Module } from '@nestjs/common';

import { WarrantiesController } from './warranties.controller';
import { WarrantiesService } from './warranties.service';

/** GARANTIAS (reemplazan la hoja de calculo). Almacenamiento y tiempo real son globales. */
@Module({
  controllers: [WarrantiesController],
  providers: [WarrantiesService],
})
export class WarrantiesModule {}
