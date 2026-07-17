import { Injectable, type OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Gestor de Key Encryption Keys (KEKs).
 *
 * Lee `KEK_V{n}` desde env (base64) y mantiene en memoria el conjunto de versiones
 * disponibles. La version activa esta en `CURRENT_KEK_VERSION`.
 *
 * Rotacion:
 *   1. Generar KEK nueva: openssl rand -base64 32 -> setear KEK_V{n+1} en secrets.
 *   2. Mantener KEK_V{n} mientras existan registros cifrados con ella.
 *   3. Subir CURRENT_KEK_VERSION = n+1; nuevos cifrados usan la nueva.
 *   4. Job rotate-deks rewrap los TenantDek viejos con la nueva.
 *   5. Tras N dias sin uso de la vieja, eliminarla del env.
 */
@Injectable()
export class KekService implements OnModuleInit {
  private readonly logger = new Logger(KekService.name);
  private readonly keys = new Map<number, Buffer>();
  private currentVersion = 0;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    for (const [key, value] of Object.entries(process.env)) {
      const match = key.match(/^KEK_V(\d+)$/);
      if (match && value && match[1]) {
        const v = Number(match[1]);
        const buf = Buffer.from(value, 'base64');
        if (buf.length !== 32) {
          throw new Error(`KEK_V${v} debe ser exactamente 32 bytes (256 bits) en base64`);
        }
        this.keys.set(v, buf);
      }
    }

    const current = Number(this.config.get<string>('CURRENT_KEK_VERSION') ?? 0);
    if (!current || !this.keys.has(current)) {
      throw new Error(
        'CURRENT_KEK_VERSION debe apuntar a una KEK existente (ej: CURRENT_KEK_VERSION=1 con KEK_V1=...). ' +
          `Versiones encontradas: [${[...this.keys.keys()].join(', ') || 'ninguna'}]`,
      );
    }
    this.currentVersion = current;
    this.logger.log(
      `Loaded ${this.keys.size} KEK version(s), current=v${current} [versions: ${[...this.keys.keys()].join(',')}]`,
    );
  }

  current(): { key: Buffer; version: number } {
    const key = this.keys.get(this.currentVersion);
    if (!key) throw new Error('KEK actual no disponible');
    return { key, version: this.currentVersion };
  }

  byVersion(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new Error(`KEK version ${version} no disponible (rotacion fallida o env incompleto)`);
    return key;
  }

  versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }
}
