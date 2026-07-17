import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isAxiosError } from 'axios';
import type {
  CoordinadoraCity,
  CoordinadoraCitySearchInput,
  CoordinadoraConnectInput,
  CoordinadoraConnectionSummary,
  CoordinadoraCredentialsInput,
  CoordinadoraTestResult,
  GuidePackage,
  GuideTracking,
} from '@smartlogistica/shared';

import { isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import { WarehousesService } from '../../warehouses/warehouses.service';
import {
  CoordinadoraClient,
  type CoordinadoraCreds,
  type GuiaResult,
  type RastreoResult,
} from './coordinadora-client.service';

interface ConnectionRow {
  warehouseId: string;
  idCliente: number;
  usuario: string;
  encryptedPassword: Buffer;
  nit: string;
  div: string;
  senderName: string;
  senderNit: string | null;
  senderPhone: string;
  senderAddress: string;
  senderCityCode: string;
  senderCityName: string | null;
  rotuloId: number;
  status: string;
  lastError: string | null;
  createdAt: Date;
}

export interface GuideRecipient {
  name: string;
  document: string;
  address: string;
  cityCode: string;
  phone: string;
}

@Injectable()
export class CoordinadoraService {
  constructor(
    private readonly client: CoordinadoraClient,
    private readonly envelope: EnvelopeService,
    private readonly warehouses: WarehousesService,
  ) {}

  // === Conexion por sede ===

  async get(warehouseId: string, auth: AuthContext): Promise<CoordinadoraConnectionSummary | null> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    const conn = await prisma.coordinadoraConnection.findUnique({ where: { warehouseId } });
    return conn ? this.toSummary(conn) : null;
  }

  /** Valida credenciales contra Coordinadora sin persistir nada. Solo admin. */
  async test(
    warehouseId: string,
    input: CoordinadoraCredentialsInput,
    auth: AuthContext,
  ): Promise<CoordinadoraTestResult> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    try {
      const cities = await this.client.testCredentials(this.credsFromInput(input));
      return { ok: true, cities };
    } catch (err) {
      throw this.translateError(err, 'No se pudo conectar a Coordinadora');
    }
  }

  /** Conecta/reconecta Coordinadora a la sede (creds + origen). Solo admin. */
  async connect(
    warehouseId: string,
    input: CoordinadoraConnectInput,
    auth: AuthContext,
  ): Promise<CoordinadoraConnectionSummary> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId, prisma } = getTenantContext();

    const existing = await prisma.coordinadoraConnection.findUnique({ where: { warehouseId } });
    // password opcional al editar: si se omite y ya existe, se conserva el guardado.
    if (!input.password && !existing) {
      throw new BadRequestException('Ingresa la contrasena de Coordinadora');
    }

    // Validar credenciales (con el password nuevo o el ya guardado).
    const password = input.password ?? (await this.envelope.decryptField(tenantId, existing!.encryptedPassword));
    try {
      await this.client.testCredentials({
        usuario: input.usuario,
        password,
        idCliente: input.idCliente,
        nit: input.nit,
        div: input.div,
      });
    } catch (err) {
      throw this.translateError(err, 'Las credenciales de Coordinadora son invalidas');
    }

    const encryptedPassword = input.password
      ? await this.envelope.encryptField(tenantId, input.password)
      : existing!.encryptedPassword;

    const data = {
      idCliente: input.idCliente,
      usuario: input.usuario,
      encryptedPassword,
      nit: input.nit,
      div: input.div,
      senderName: input.senderName,
      senderNit: input.senderNit ?? null,
      senderPhone: input.senderPhone,
      senderAddress: input.senderAddress,
      senderCityCode: input.senderCityCode,
      senderCityName: input.senderCityName ?? null,
      rotuloId: input.rotuloId,
      status: 'connected',
      lastError: null,
    };
    const conn = await prisma.coordinadoraConnection.upsert({
      where: { warehouseId },
      create: { warehouseId, ...data },
      update: data,
    });
    return this.toSummary(conn);
  }

  async disconnect(warehouseId: string, auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    await prisma.coordinadoraConnection.deleteMany({ where: { warehouseId } });
  }

  // === Datos para el preview de guia ===

  /** ¿Esta la sede conectada a Coordinadora? (para habilitar/deshabilitar la pestana). */
  async isConnected(warehouseId: string): Promise<boolean> {
    const { prisma } = getTenantContext();
    const conn = await prisma.coordinadoraConnection.findUnique({
      where: { warehouseId },
      select: { warehouseId: true },
    });
    return Boolean(conn);
  }

  /** Datos del remitente (origen) + formato de rotulo de la sede — para el preview. */
  async senderFor(warehouseId: string): Promise<{
    name: string;
    address: string;
    cityCode: string;
    cityName: string | null;
    phone: string;
    rotuloId: number;
  }> {
    const conn = await this.requireConnection(warehouseId);
    return {
      name: conn.senderName,
      address: conn.senderAddress,
      cityCode: conn.senderCityCode,
      cityName: conn.senderCityName,
      phone: conn.senderPhone,
      rotuloId: conn.rotuloId,
    };
  }

  /**
   * Busca ciudades para el selector de ORIGEN del form de conexion. Usa las
   * credenciales inline (si vienen, antes de guardar) o las ya guardadas. Admin.
   */
  async searchCitiesWithCreds(
    warehouseId: string,
    input: CoordinadoraCitySearchInput,
    auth: AuthContext,
  ): Promise<CoordinadoraCity[]> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const q = normalizeCity(input.query);
    if (q.length < 2) return [];
    const creds: CoordinadoraCreds =
      input.usuario && input.password && input.idCliente && input.nit
        ? {
            usuario: input.usuario,
            password: input.password,
            idCliente: input.idCliente,
            nit: input.nit,
            div: input.div ?? '01',
          }
        : await this.credsFor(warehouseId);
    try {
      const cities = await this.client.listCities(creds);
      return cities
        .filter((c) => normalizeCity(c.name).includes(q) || normalizeCity(c.department).includes(q))
        .slice(0, 30);
    } catch (err) {
      throw this.translateError(err, 'No se pudieron cargar las ciudades');
    }
  }

  /** Busca ciudades (para el selector de destino). Requiere >= 2 letras. */
  async searchCities(warehouseId: string, query: string): Promise<CoordinadoraCity[]> {
    const q = normalizeCity(query);
    if (q.length < 2) return [];
    const creds = await this.credsFor(warehouseId);
    const cities = await this.client.listCities(creds);
    return cities
      .filter((c) => normalizeCity(c.name).includes(q) || normalizeCity(c.department).includes(q))
      .slice(0, 30);
  }

  /** Resuelve la ciudad de VTEX (nombre + departamento) al codigo DANE. null si no hay match. */
  async resolveCity(
    warehouseId: string,
    cityName: string | null,
    department: string | null,
  ): Promise<CoordinadoraCity | null> {
    if (!cityName) return null;
    const creds = await this.credsFor(warehouseId);
    const cities = await this.client.listCities(creds).catch(() => [] as CoordinadoraCity[]);
    const target = normalizeCity(cityName);
    if (!target) return null;
    // El nombre del catalogo trae sufijo de depto: "BOGOTA (C/MARCA)" -> "BOGOTA".
    let matches = cities.filter((c) => stripDeptSuffix(c.name) === target);
    // VTEX a veces manda "Bogota D.C." -> quitar el sufijo "D C" y reintentar.
    if (matches.length === 0) {
      const t2 = target
        .replace(/\bD\s*C\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (t2 && t2 !== target) matches = cities.filter((c) => stripDeptSuffix(c.name) === t2);
    }
    if (matches.length === 0) return null;
    if (matches.length === 1 || !department) return matches[0];
    const dep = normalizeCity(department);
    return matches.find((c) => normalizeCity(c.department) === dep) ?? matches[0];
  }

  /** Seguimiento detallado de una guia (rastreoExtendido) via la conexion de la sede. */
  async trackGuide(
    warehouseId: string,
    guideNumber: string,
    auth: AuthContext,
  ): Promise<GuideTracking> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const creds = await this.credsFor(warehouseId);
    try {
      const t = await this.client.rastrear(creds, guideNumber);
      return {
        guideNumber,
        trackingUrl: `https://coordinadora.com/rastreo/rastreo-de-guia/?guia=${encodeURIComponent(guideNumber)}`,
        ...t,
      };
    } catch (err) {
      throw this.translateError(err, 'No se pudo consultar el seguimiento en Coordinadora');
    }
  }

  /**
   * Rastreo por LOTES (una sola llamada para muchas guias) — lo usa el refresco
   * del estado de envio de la lista. El acceso lo valida el caller.
   */
  async trackGuidesBatch(warehouseId: string, codigos: string[]): Promise<RastreoResult[]> {
    if (codigos.length === 0) return [];
    const creds = await this.credsFor(warehouseId);
    return this.client.rastrearMuchos(creds, codigos);
  }

  // === Generar guia (lo orquesta OrdersService) ===

  /** Genera la guia en Coordinadora y trae el rotulo (PDF). Solo admin. */
  async generateGuideForWarehouse(
    warehouseId: string,
    recipient: GuideRecipient,
    pkg: GuidePackage,
    reference: string | null,
    rotuloId: number | undefined,
    auth: AuthContext,
  ): Promise<{ guide: GuiaResult; rotulo: Buffer | null }> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const conn = await this.requireConnection(warehouseId);
    const creds = await this.credsFor(warehouseId, conn);

    try {
      const guide = await this.client.generarGuia(creds, {
        sender: {
          name: conn.senderName,
          nit: conn.senderNit,
          address: conn.senderAddress,
          cityCode: conn.senderCityCode,
          phone: conn.senderPhone,
        },
        recipient: { ...recipient, div: '01' },
        package: pkg,
        reference: reference ?? undefined,
      });
      // Rotulo: best-effort (si falla, la guia ya quedo generada). Formato = el
      // elegido al generar o el default de la sede.
      const rotulo = await this.client
        .imprimirRotulo(creds, guide.number, rotuloId ?? conn.rotuloId)
        .catch(() => null);
      return { guide, rotulo };
    } catch (err) {
      throw this.translateError(err, 'No se pudo generar la guia en Coordinadora');
    }
  }

  // === Helpers ===

  private async requireConnection(warehouseId: string): Promise<ConnectionRow> {
    const { prisma } = getTenantContext();
    const conn = await prisma.coordinadoraConnection.findUnique({ where: { warehouseId } });
    if (!conn) {
      throw new BadRequestException('Esta sede no tiene conexion con Coordinadora. Configurala primero.');
    }
    return conn as ConnectionRow;
  }

  private async credsFor(warehouseId: string, row?: ConnectionRow): Promise<CoordinadoraCreds> {
    const { tenantId, prisma } = getTenantContext();
    const conn = row ?? (await prisma.coordinadoraConnection.findUnique({ where: { warehouseId } }));
    if (!conn) throw new BadRequestException('Esta sede no tiene conexion con Coordinadora.');
    const password = await this.envelope.decryptField(tenantId, conn.encryptedPassword);
    return { usuario: conn.usuario, password, idCliente: conn.idCliente, nit: conn.nit, div: conn.div };
  }

  private credsFromInput(input: CoordinadoraCredentialsInput): CoordinadoraCreds {
    return {
      usuario: input.usuario,
      password: input.password,
      idCliente: input.idCliente,
      nit: input.nit,
      div: input.div,
    };
  }

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores pueden gestionar la conexion de envios');
    }
  }

  private async assertWarehouseAccess(warehouseId: string, auth: AuthContext): Promise<void> {
    const { prisma } = getTenantContext();
    const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || wh.archived) throw new NotFoundException('Sede no encontrada');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }
  }

  private toSummary(row: ConnectionRow): CoordinadoraConnectionSummary {
    return {
      warehouseId: row.warehouseId,
      idCliente: row.idCliente,
      usuario: row.usuario,
      nit: row.nit,
      div: row.div,
      senderName: row.senderName,
      senderNit: row.senderNit,
      senderPhone: row.senderPhone,
      senderAddress: row.senderAddress,
      senderCityCode: row.senderCityCode,
      senderCityName: row.senderCityName,
      rotuloId: row.rotuloId,
      status: row.status === 'error' ? 'error' : 'connected',
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private translateError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      return new BadRequestException(`${fallback}: ${err.message}`);
    }
    if (err instanceof Error && err.message) {
      return new BadRequestException(`${fallback}: ${err.message}`);
    }
    return new BadRequestException(fallback);
  }
}

/** Normaliza un nombre de ciudad/depto: sin acentos, mayus, alfa-num + espacios. */
function normalizeCity(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "BOGOTA (C/MARCA)" -> "BOGOTA" (quita el sufijo de departamento entre parentesis). */
function stripDeptSuffix(name: string): string {
  return normalizeCity(name.replace(/\([^)]*\)\s*$/, ''));
}
