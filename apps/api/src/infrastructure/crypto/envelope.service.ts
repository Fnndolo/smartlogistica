import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ControlPlaneService } from '../prisma/control-plane.service';
import { KekService } from './kek.service';

const ALGO = 'aes-256-gcm' as const;
const IV_LEN = 12; // GCM recomendado
const TAG_LEN = 16;
const VERSION_PREFIX_LEN = 1; // 1 byte para version de KEK

/**
 * Envelope encryption:
 *   KEK (en memoria) cifra DEKs por tenant
 *   DEK (en memoria momentanea) cifra campos individuales (credenciales VTEX, etc.)
 *
 * Formato de blob KEK-cifrado:
 *   [version:1][iv:12][tag:16][ciphertext:N]
 *
 * Formato de campo DEK-cifrado (guardado en columnas separadas):
 *   iv:12 + tag:16 + ciphertext:N
 */
@Injectable()
export class EnvelopeService {
  constructor(
    private readonly kek: KekService,
    private readonly control: ControlPlaneService,
  ) {}

  // === KEK-level (wraps DEKs and small secrets like DB role passwords) ===

  generateDek(): Buffer {
    return randomBytes(32);
  }

  /** Cifra un buffer arbitrario con la KEK activa. Devuelve un blob auto-descriptivo. */
  kekEncrypt(plaintext: Buffer): Buffer {
    const { key, version } = this.kek.current();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([version]), iv, tag, ct]);
  }

  kekDecrypt(blob: Buffer): Buffer {
    if (blob.length < VERSION_PREFIX_LEN + IV_LEN + TAG_LEN) {
      throw new Error('Blob KEK-cifrado corrupto o truncado');
    }
    const version = blob[0]!;
    const iv = blob.subarray(VERSION_PREFIX_LEN, VERSION_PREFIX_LEN + IV_LEN);
    const tag = blob.subarray(VERSION_PREFIX_LEN + IV_LEN, VERSION_PREFIX_LEN + IV_LEN + TAG_LEN);
    const ct = blob.subarray(VERSION_PREFIX_LEN + IV_LEN + TAG_LEN);
    const key = this.kek.byVersion(version);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  // === DEK-level (per-tenant field encryption) ===

  private async loadDek(tenantId: string): Promise<Buffer> {
    const record = await this.control.tenantDek.findUnique({ where: { tenantId } });
    if (!record) throw new Error(`Tenant ${tenantId} sin DEK aprovisionada`);
    return this.kekDecrypt(record.wrappedDek);
  }

  /** Crea un nuevo DEK para el tenant, lo envuelve con la KEK actual, y lo persiste. */
  async createTenantDek(tenantId: string): Promise<void> {
    const dek = this.generateDek();
    const wrapped = this.kekEncrypt(dek);
    dek.fill(0);
    await this.control.tenantDek.create({
      data: {
        tenantId,
        wrappedDek: wrapped,
        kekVersion: this.kek.current().version,
      },
    });
  }

  /**
   * Encripta un string con la DEK del tenant. Devuelve un blob auto-contenido
   * con formato [iv:12][tag:16][ciphertext:N]. Una sola columna Bytes en DB,
   * imposible mezclar iv/tag de distintos campos.
   */
  async encryptField(tenantId: string, plaintext: string): Promise<Buffer> {
    const dek = await this.loadDek(tenantId);
    try {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, dek, iv);
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]);
    } finally {
      dek.fill(0);
    }
  }

  async decryptField(tenantId: string, blob: Buffer): Promise<string> {
    if (blob.length < IV_LEN + TAG_LEN) {
      throw new Error('Blob cifrado corrupto o truncado');
    }
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = blob.subarray(IV_LEN + TAG_LEN);
    const dek = await this.loadDek(tenantId);
    try {
      const decipher = createDecipheriv(ALGO, dek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } finally {
      dek.fill(0);
    }
  }
}
