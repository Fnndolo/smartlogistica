import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { Session, TenantRole, User } from '.prisma/control-plane-client';

import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';

export const SESSION_COOKIE_NAME = 'smartlog_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

export interface ValidateResult {
  session: Session;
  user: User;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
  refreshed: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: ControlPlaneService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, meta: { userAgent?: string; ip?: string }): Promise<Session> {
    const id = randomBytes(32).toString('base64url');
    return this.prisma.session.create({
      data: {
        id,
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: meta.userAgent?.slice(0, 256),
        ip: meta.ip,
      },
    });
  }

  async validateAndRefresh(sessionId: string): Promise<ValidateResult | null> {
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            memberships: {
              include: { tenant: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!row) return null;

    if (row.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => null);
      return null;
    }

    const remaining = row.expiresAt.getTime() - Date.now();
    let session: Session = row;
    let refreshed = false;
    if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
      session = await this.prisma.session.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      refreshed = true;
    }

    const membership = row.user.memberships[0];

    return {
      session,
      user: row.user,
      activeTenantId: membership?.tenantId ?? null,
      activeTenantSlug: membership?.tenant.slug ?? null,
      role: membership?.role ?? null,
      refreshed,
    };
  }

  async invalidate(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => null);
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  setCookie(res: Response, sessionId: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE_NAME, sessionId, { ...this.cookieOptions(), expires: expiresAt });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
  }

  /**
   * Opciones de la cookie de sesion. `sameSite` es configurable porque en
   * produccion web y API pueden vivir en dominios registrables distintos
   * (ej: Vercel + Railway) = contexto cross-site, donde SameSite=Lax NO envia
   * la cookie en requests de subrecurso como EventSource/fetch. En ese caso
   * usar COOKIE_SAMESITE=none (requiere COOKIE_SECURE=true / HTTPS). En dev y
   * con web+API bajo el mismo dominio registrable, 'lax' es lo correcto.
   */
  private cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain: string | undefined;
    path: '/';
  } {
    const secure = this.config.get<string>('COOKIE_SECURE', 'true') !== 'false';
    const domain = this.config.get<string>('COOKIE_DOMAIN') ?? undefined;
    const sameSite = (this.config.get<string>('COOKIE_SAMESITE') ?? 'lax').toLowerCase() as
      | 'lax'
      | 'strict'
      | 'none';
    return {
      httpOnly: true,
      secure: sameSite === 'none' ? true : secure, // SameSite=None exige Secure
      sameSite,
      domain: domain === 'localhost' ? undefined : domain,
      path: '/',
    };
  }
}
