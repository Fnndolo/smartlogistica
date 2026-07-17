import type { Request } from 'express';
import type { TenantRole } from '.prisma/control-plane-client';

export interface AuthContext {
  userId: string;
  email: string;
  sessionId: string;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
