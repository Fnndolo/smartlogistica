'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api-client';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await api.post('/v1/auth/logout');
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('No se pudo cerrar sesion');
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      Cerrar sesion
    </button>
  );
}
