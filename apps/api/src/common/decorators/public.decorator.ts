import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como publica — el SessionGuard global la salta.
 * Uso: anadir `@Public()` encima del metodo o controller.
 * Endpoints publicos validos: /auth/*, /webhooks/marketplace/*, /health.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
