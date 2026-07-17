export type TenantRole = 'OWNER' | 'OPERATOR';

export interface SessionUser {
  id: string;
  email: string;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
}
