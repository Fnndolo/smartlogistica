export type TenantRole = 'OWNER' | 'ADMIN' | 'OPERATOR';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
}
