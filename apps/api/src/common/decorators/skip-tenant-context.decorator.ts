import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_CONTEXT = 'skipTenantContext';

/**
 * Marca un handler para que TenantInterceptor NO lo envuelva en
 * tenantContext.run(...). Imprescindible para endpoints SSE/streaming: el
 * interceptor consume solo el primer valor del Observable (firstValueFrom),
 * lo que cerraria el stream. Estos handlers obtienen el tenant desde req.auth.
 */
export const SkipTenantContext = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_CONTEXT, true);
