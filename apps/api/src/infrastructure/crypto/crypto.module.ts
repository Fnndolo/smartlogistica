import { Global, Module } from '@nestjs/common';

import { EnvelopeService } from './envelope.service';
import { KekService } from './kek.service';

@Global()
@Module({
  providers: [KekService, EnvelopeService],
  exports: [KekService, EnvelopeService],
})
export class CryptoModule {}
