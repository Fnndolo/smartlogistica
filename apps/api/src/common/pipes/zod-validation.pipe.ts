import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType, ZodTypeDef } from 'zod';

/**
 * Pipe de validacion via Zod. Convierte un schema Zod en un validador Nest.
 * Uso en controller:
 *   @UsePipes(new ZodValidationPipe(signupSchema))
 *   async signup(@Body() body: SignupInput) { ... }
 *
 * El tipo de ENTRADA del schema es `unknown` (y no `T`, que es lo que da
 * `ZodSchema<T>`): lo que llega es el JSON del request, sin validar. Escribirlo
 * como `T` dejaba fuera cualquier schema con `.transform()` — por ejemplo uno
 * que acepte dos formas del cuerpo y devuelva una sola — que es justo lo que un
 * validador deberia poder hacer.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Datos invalidos',
        errors: formatZodIssues(result.error),
      });
    }
    return result.data;
  }
}

function formatZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
