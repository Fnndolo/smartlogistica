import type { Request } from 'express';
import type { TenantRole } from '.prisma/control-plane-client';

export interface AuthContext {
  userId: string;
  email: string;
  /** Nombre visible (para chat/menciones); null si aun no se ha configurado. */
  name: string | null;
  sessionId: string;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
