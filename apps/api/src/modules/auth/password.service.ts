import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de passwords con Argon2id.
 * Parametros recomendados OWASP 2024: t=2, m=19MB, p=1, output=32 bytes.
 * Argon2id resiste GPU/ASIC mejor que bcrypt y es el estandar moderno.
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    memoryCost: 19_456, // 19 MB
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  } as const;

  async hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // verify lanza si el hash esta corrupto — tratamos como fallido
      return false;
    }
  }
}
