import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Pipe de validacion via Zod. Convierte un schema Zod en un validador Nest.
 * Uso en controller:
 *   @UsePipes(new ZodValidationPipe(signupSchema))
 *   async signup(@Body() body: SignupInput) { ... }
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

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
