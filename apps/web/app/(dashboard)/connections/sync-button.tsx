'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

import { BTN_GHOST } from './connection-ui';

interface SyncButtonProps {
  connectionId: string;
}

export function SyncButton({ connectionId }: SyncButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.post(`/v1/connections/vtex/${connectionId}/sync`);
      toast.success('Sincronización iniciada — el backfill corre en segundo plano');
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo iniciar la sincronización';
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" className={BTN_GHOST} onClick={handleSync} loading={syncing}>
      <RefreshCw />
      Sincronizar
    </Button>
  );
}
