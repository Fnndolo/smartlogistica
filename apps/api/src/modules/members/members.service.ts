import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ChangePasswordInput,
  CreateMemberInput,
  MemberSummary,
  UpdateMemberInput,
} from '@smartlogistica/shared';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { PasswordService } from '../auth/password.service';

/**
 * Equipo del workspace.
 *
 * Los datos viven en dos bases: el rol en el control-plane (Membership) y el
 * acceso por sede en la del tenant (WarehouseMember). No hay transaccion que
 * abarque ambas, asi que el orden importa: primero la membresia (la fuente de
 * verdad del acceso) y despues las sedes.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: ControlPlaneService,
    private readonly passwords: PasswordService,
  ) {}

  private tenantId(auth: AuthContext): string {
    if (!auth.activeTenantId) throw new BadRequestException('No hay un workspace activo');
    return auth.activeTenantId;
  }

  private assertOwner(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores pueden gestionar el equipo');
    }
  }

  /** Miembros del workspace con su rol y las sedes a las que acceden. */
  async list(auth: AuthContext): Promise<MemberSummary[]> {
    const tenantId = this.tenantId(auth);

    const memberships = await this.prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) return [];

    // Acceso por sede (base del tenant). OWNER/ADMIN ven todas, no necesitan filas.
    const { prisma } = getTenantContext();
    const links = await prisma.warehouseMember.findMany({
      where: { userId: { in: memberships.map((m) => m.userId) } },
      select: { userId: true, warehouseId: true },
    });
    const byUser = new Map<string, string[]>();
    for (const l of links) {
      const list = byUser.get(l.userId);
      if (list) list.push(l.warehouseId);
      else byUser.set(l.userId, [l.warehouseId]);
    }

    return memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      warehouseIds: m.role !== 'OPERATOR' ? [] : (byUser.get(m.userId) ?? []),
      isYou: m.userId === auth.userId,
    }));
  }

  /**
   * Da de alta un miembro. Si el correo ya existe en la plataforma se le suma el
   * acceso a este workspace SIN tocar su clave (podria ser de otra empresa); la
   * clave del formulario solo se usa al crear la cuenta.
   */
  async create(input: CreateMemberInput, auth: AuthContext): Promise<MemberSummary> {
    this.assertOwner(auth);
    const tenantId = this.tenantId(auth);

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, name: true },
    });

    let user = existing;
    if (!user) {
      const passwordHash = await this.passwords.hash(input.password);
      user = await this.prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: { id: true, email: true, name: true },
      });
    } else {
      const already = await this.prisma.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
      });
      if (already) throw new ConflictException('Ese correo ya es parte del equipo');
      // Cuenta existente sin nombre: aprovechar el del formulario.
      if (!user.name) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { name: input.name },
          select: { id: true, email: true, name: true },
        });
      }
    }

    const membership = await this.prisma.membership.create({
      data: { userId: user.id, tenantId, role: input.role },
    });

    const warehouseIds = await this.setWarehouses(user.id, input.role, input.warehouseIds);

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: membership.role,
      createdAt: membership.createdAt.toISOString(),
      warehouseIds,
      isYou: false,
    };
  }

  /** Cambia el rol y/o las sedes de un miembro. */
  async update(userId: string, input: UpdateMemberInput, auth: AuthContext): Promise<MemberSummary> {
    this.assertOwner(auth);
    const tenantId = this.tenantId(auth);

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!membership) throw new NotFoundException('Ese miembro no existe en este workspace');

    const role = input.role ?? membership.role;

    // No dejar el workspace sin propietario (incluye degradarte a ti mismo).
    if (membership.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(tenantId, userId);
    }

    const updated =
      input.role && input.role !== membership.role
        ? await this.prisma.membership.update({
            where: { userId_tenantId: { userId, tenantId } },
            data: { role: input.role },
          })
        : membership;

    // Nombre visible (global a la cuenta del usuario).
    let name = membership.user.name;
    if (input.name && input.name !== name) {
      await this.prisma.user.update({ where: { id: userId }, data: { name: input.name } });
      name = input.name;
    }

    // Las sedes solo se tocan si vinieron en el body; OWNER/ADMIN las ven todas.
    const warehouseIds =
      input.warehouseIds || role !== membership.role
        ? await this.setWarehouses(userId, role, input.warehouseIds ?? [])
        : await this.currentWarehouses(userId, role);

    return {
      userId,
      email: membership.user.email,
      name,
      role: updated.role,
      createdAt: membership.createdAt.toISOString(),
      warehouseIds,
      isYou: userId === auth.userId,
    };
  }

  /** Saca a un miembro del workspace (no borra su cuenta: puede estar en otros). */
  async remove(userId: string, auth: AuthContext): Promise<void> {
    this.assertOwner(auth);
    const tenantId = this.tenantId(auth);

    if (userId === auth.userId) {
      throw new BadRequestException('No puedes quitarte a ti mismo del equipo');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    if (!membership) throw new NotFoundException('Ese miembro no existe en este workspace');
    if (membership.role === 'OWNER') await this.assertNotLastOwner(tenantId, userId);

    await this.prisma.membership.delete({ where: { userId_tenantId: { userId, tenantId } } });

    const { prisma } = getTenantContext();
    await prisma.warehouseMember.deleteMany({ where: { userId } });
  }

  /** Cambia la clave del propio usuario. Exige la actual. */
  async changePassword(input: ChangePasswordInput, auth: AuthContext): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { passwordHash: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) throw new BadRequestException('La clave actual no es correcta');

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.user.update({ where: { id: auth.userId }, data: { passwordHash } });
  }

  private async assertNotLastOwner(tenantId: string, userId: string): Promise<void> {
    const owners = await this.prisma.membership.count({
      where: { tenantId, role: 'OWNER', userId: { not: userId } },
    });
    if (owners === 0) {
      throw new BadRequestException(
        'El workspace debe tener al menos un propietario. Nombra otro antes de hacer este cambio.',
      );
    }
  }

  private async currentWarehouses(userId: string, role: string): Promise<string[]> {
    if (role !== 'OPERATOR') return [];
    const { prisma } = getTenantContext();
    const links = await prisma.warehouseMember.findMany({
      where: { userId },
      select: { warehouseId: true },
    });
    return links.map((l) => l.warehouseId);
  }

  /**
   * Deja el acceso por sede EXACTAMENTE como se pide. En OWNER/ADMIN se limpian
   * las filas: ven todas las sedes por rol, y dejarlas seria confuso (al pasarlo
   * a OPERATOR heredaria accesos viejos sin que nadie los eligiera).
   */
  private async setWarehouses(userId: string, role: string, warehouseIds: string[]): Promise<string[]> {
    const { prisma } = getTenantContext();

    if (role !== 'OPERATOR') {
      await prisma.warehouseMember.deleteMany({ where: { userId } });
      return [];
    }

    const valid = warehouseIds.length
      ? await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds }, archived: false },
          select: { id: true },
        })
      : [];
    const ids = valid.map((w) => w.id);

    await prisma.warehouseMember.deleteMany({ where: { userId, warehouseId: { notIn: ids } } });
    if (ids.length) {
      await prisma.warehouseMember.createMany({
        data: ids.map((warehouseId) => ({ userId, warehouseId })),
        skipDuplicates: true,
      });
    }
    return ids;
  }
}
