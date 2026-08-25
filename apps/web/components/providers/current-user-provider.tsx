'use client';

import { createContext, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { TenantRole } from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  /** Tipado con el enum real: si aparece un rol nuevo, los gates no compilan
      hasta que se decida que ve y que no (ver @/lib/rbac). */
  role: TenantRole | null;
}

const CurrentUserContext = createContext<{ user: CurrentUser | null; isLoading: boolean }>({
  user: null,
  isLoading: true,
});

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<CurrentUser>('/v1/auth/me'),
    // Una sola vez por sesion del browser. Si necesitamos invalidar (logout,
    // cambio de tenant) llamamos a queryClient.invalidateQueries(['auth-me']).
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  // Si la cookie quedo invalida (el API responde 401), volver al login.
  useEffect(() => {
    if (isError && error instanceof ApiError && error.status === 401) {
      router.push('/login');
    }
  }, [isError, error, router]);

  return (
    <CurrentUserContext.Provider value={{ user: data ?? null, isLoading }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext).user;
}

export function useCurrentUserLoading(): boolean {
  return useContext(CurrentUserContext).isLoading;
}
