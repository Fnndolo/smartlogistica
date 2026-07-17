import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const SIGNED_URL_TTL_S = 3600; // 1h de validez
const SIGNED_URL_CACHE_MS = (SIGNED_URL_TTL_S - 300) * 1000; // refrescar 5min antes

interface CachedUrl {
  url: string;
  expiresAt: number;
}

/**
 * Abstraccion de storage de objetos sobre un backend S3-compatible.
 *
 * Hoy apunta a Cloudflare R2, pero cualquier proveedor S3-compatible (Supabase
 * Storage, AWS S3, MinIO, Backblaze B2) funciona cambiando solo las variables
 * STORAGE_* en el env — cero cambios de codigo. Si algun dia hiciera falta un
 * proveedor NO S3, se implementa otro adaptador con esta misma interfaz publica.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private readonly urlCache = new Map<string, CachedUrl>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('STORAGE_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('STORAGE_BUCKET');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn('Storage no configurado (faltan variables STORAGE_*). Uploads deshabilitados.');
      return;
    }
    this.bucket = bucket;
    this.client = new S3Client({
      region: this.config.get<string>('STORAGE_REGION') ?? 'auto',
      endpoint,
      // R2 (y la mayoria de S3-compatible detras de un unico endpoint de cuenta)
      // requieren path-style para evitar problemas de DNS de virtual-host.
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  private assertReady(): void {
    if (!this.client) {
      throw new Error('Storage no configurado — define STORAGE_ENDPOINT/KEYS/BUCKET en el env');
    }
  }

  /**
   * Sube un objeto. `key` incluye el namespacing por tenant.
   * `contentDisposition` (opcional) queda guardado en el objeto: al descargarlo
   * el navegador respeta ese nombre (usar `inline; filename=...` para no forzar
   * descarga y permitir la vista previa).
   */
  async put(
    key: string,
    body: Buffer,
    contentType: string,
    contentDisposition?: string,
  ): Promise<void> {
    this.assertReady();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
      }),
    );
  }

  /**
   * URL firmada de lectura (GET), valida ~1h. Cacheada por key para no re-firmar
   * en cada refetch (evita que el <img> se recargue en cada poll del chat).
   */
  async getSignedUrl(key: string): Promise<string> {
    this.assertReady();
    const now = Date.now();
    const cached = this.urlCache.get(key);
    if (cached && cached.expiresAt > now) return cached.url;

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: SIGNED_URL_TTL_S },
    );
    this.urlCache.set(key, { url, expiresAt: now + SIGNED_URL_CACHE_MS });
    return url;
  }

  async delete(key: string): Promise<void> {
    this.assertReady();
    this.urlCache.delete(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
