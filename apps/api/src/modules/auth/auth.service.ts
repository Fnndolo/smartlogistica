import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Session, User } from '.prisma/control-plane-client';
import type { LoginInput, SignupInput } from '@smartlogistica/shared';

import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantProvisioningService } from '../tenants/tenant-provisioning.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

export interface AuthenticatedUser {
  user: User;
  session: Session;
  tenantId: string;
  tenantSlug: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: ControlPlaneService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tenants: TenantProvisioningService,
  ) {}

  async signup(
    input: SignupInput,
    meta: { userAgent?: string; ip?: string },
  ): Promise<AuthenticatedUser> {
    // Verificar unicidad antes de gastar argon2
    const [existingUser, existingTenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: input.email } }),
      this.prisma.tenant.findUnique({ where: { slug: input.workspaceSlug } }),
    ]);
    if (existingUser) {
      throw new ConflictException('El email ya esta registrado');
    }
    if (existingTenant) {
      throw new ConflictException('El identificador del workspace ya esta en uso');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.user.create({
      data: { email: input.email, passwordHash },
    });

    let tenantId: string;
    let tenantSlug: string;
    try {
      const tenant = await this.tenants.provision({
        ownerUserId: user.id,
        slug: input.workspaceSlug,
        name: input.workspaceName,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;
    } catch (err) {
      // Compensacion: si el provisioning falla, borrar el usuario para que pueda reintentar
      await this.prisma.user.delete({ where: { id: user.id } }).catch(() => null);
      this.logger.error({ err, userId: user.id }, 'Tenant provisioning failed');
      throw err instanceof Error
        ? new BadRequestException(`No se pudo crear el workspace: ${err.message}`)
        : new BadRequestException('No se pudo crear el workspace');
    }

    const session = await this.sessions.create(user.id, meta);

    await this.audit({
      actorUserId: user.id,
      tenantId,
      action: 'user.signup',
      metadata: { email: user.email, workspaceSlug: tenantSlug },
      ip: meta.ip,
    });

    return { user, session, tenantId, tenantSlug };
  }

  async login(
    input: LoginInput,
    meta: { userAgent?: string; ip?: string },
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { tenant: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    // Timing-equal: aun si el usuario no existe, ejecutamos un argon2 verify dummy
    if (!user) {
      await this.passwords.verify(DUMMY_HASH, input.password).catch(() => false);
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.audit({
        actorUserId: user.id,
        action: 'user.login.failed',
        metadata: { reason: 'bad_password' },
        ip: meta.ip,
      });
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('Usuario sin workspace activo');
    }

    const session = await this.sessions.create(user.id, meta);

    await this.audit({
      actorUserId: user.id,
      tenantId: membership.tenantId,
      action: 'user.login',
      metadata: {},
      ip: meta.ip,
    });

    return {
      user,
      session,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.invalidate(sessionId);
  }

  private async audit(entry: {
    actorUserId?: string;
    tenantId?: string;
    action: string;
    metadata: object;
    ip?: string;
  }): Promise<void> {
    await this.prisma.systemAuditLog
      .create({
        data: {
          actorUserId: entry.actorUserId,
          tenantId: entry.tenantId,
          action: entry.action,
          metadata: entry.metadata as never,
          ip: entry.ip,
        },
      })
      .catch((err) => this.logger.warn({ err }, 'Failed to write audit log'));
  }
}

// Hash dummy con la misma config de argon2 — generado offline para evitar timing-attack
// en login cuando el email no existe.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$JNwOdjclkAOX8tfSPVeUw7T1WRY3PiQ/d8GGE2LvIqM';
