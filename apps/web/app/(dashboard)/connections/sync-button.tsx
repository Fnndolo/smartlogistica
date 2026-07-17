'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

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
      toast.success('Sincronizacion iniciada — el backfill corre en background');
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo iniciar la sincronizacion';
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} loading={syncing}>
      <RefreshCw className="h-3.5 w-3.5" />
      Sincronizar
    </Button>
  );
}
