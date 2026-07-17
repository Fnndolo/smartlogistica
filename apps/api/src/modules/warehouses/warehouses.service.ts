import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
  WarehouseSummary,
} from '@smartlogistica/shared';

import type { AuthContext } from '../../common/types/authenticated-request';
import { isAdmin } from '../../common/rbac';
import { getTenantContext } from '../../infrastructure/tenant-context';

function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'sede'
  );
}

@Injectable()
export class WarehousesService {
  async create(input: CreateWarehouseInput, auth: AuthContext): Promise<WarehouseSummary> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden crear sedes');
    const { prisma } = getTenantContext();

    // slug unico: base + sufijo si colisiona
    let slug = slugify(input.name);
    if (await prisma.warehouse.findUnique({ where: { slug } })) {
      slug = `${slug}-${randomBytes(2).toString('hex')}`;
    }

    const w = await prisma.warehouse.create({
      data: { name: input.name, slug, invoicePrefix: input.invoicePrefix || null },
    });
    return this.toSummary(w, 0);
  }

  async list(auth: AuthContext): Promise<WarehouseSummary[]> {
    const { prisma } = getTenantContext();
    const allowed = await this.accessibleWarehouseIds(auth);

    const warehouses = await prisma.warehouse.findMany({
      where: {
        archived: false,
        ...(allowed ? { id: { in: allowed } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (warehouses.length === 0) return [];

    const counts = await prisma.order.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: warehouses.map((w) => w.id) } },
      _count: { _all: true },
    });
    const countById = new Map(counts.map((c) => [c.warehouseId, c._count._all]));

    return warehouses.map((w) => this.toSummary(w, countById.get(w.id) ?? 0));
  }

  async update(id: string, input: UpdateWarehouseInput, auth: AuthContext): Promise<WarehouseSummary> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden editar sedes');
    const { prisma } = getTenantContext();
    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sede no encontrada');
    const w = await prisma.warehouse.update({
      where: { id },
      data: { name: input.name, invoicePrefix: input.invoicePrefix || null },
    });
    const count = await prisma.order.count({ where: { warehouseId: id } });
    return this.toSummary(w, count);
  }

  async archive(id: string, auth: AuthContext): Promise<void> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden archivar sedes');
    const { prisma } = getTenantContext();
    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sede no encontrada');
    const pending = await prisma.order.count({ where: { warehouseId: id } });
    if (pending > 0) {
      throw new BadRequestException(
        `La sede tiene ${pending} pedido(s) asignados. Transfierelos o devuelvelos antes de archivar.`,
      );
    }
    await prisma.warehouse.update({ where: { id }, data: { archived: true } });
  }

  /**
   * IDs de sedes que el usuario puede ver. null = todas (admin). Para operadores,
   * solo las sedes de las que es miembro (WarehouseMember).
   */
  async accessibleWarehouseIds(auth: AuthContext): Promise<string[] | null> {
    if (isAdmin(auth)) return null;
    const { prisma } = getTenantContext();
    const memberships = await prisma.warehouseMember.findMany({
      where: { userId: auth.userId },
      select: { warehouseId: true },
    });
    return memberships.map((m) => m.warehouseId);
  }

  private toSummary(
    w: {
      id: string;
      name: string;
      slug: string;
      archived: boolean;
      invoicePrefix: string | null;
      createdAt: Date;
    },
    orderCount: number,
  ): WarehouseSummary {
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      archived: w.archived,
      invoicePrefix: w.invoicePrefix,
      orderCount,
      createdAt: w.createdAt.toISOString(),
    };
  }
}
