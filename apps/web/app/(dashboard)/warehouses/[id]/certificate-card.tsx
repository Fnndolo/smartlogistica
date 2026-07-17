'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileBadge, Pencil } from 'lucide-react';
import type { CertificateTemplate } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

import { CertificateEditor } from './certificate-editor';

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400';

export function CertificateCard({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER';
  const [open, setOpen] = useState(false);

  const { data: template } = useQuery({
    queryKey: ['certificate-template', warehouseId],
    queryFn: () =>
      api.get<CertificateTemplate | null>(`/v1/warehouses/${warehouseId}/certificate/template`),
  });

  const count = template?.elements?.length ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <FileBadge className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Certificado de Garantia</h3>
              {count > 0 ? (
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  Configurado
                </Badge>
              ) : (
                <Badge variant="outline">Sin plantilla</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {count > 0
                ? `La factura de ${warehouseName} se convierte en certificado al facturar (${count} elemento${count === 1 ? '' : 's'}).`
                : `Diseña como convertir la factura de ${warehouseName} en Certificado de Garantia.`}
            </p>
          </div>
        </div>

        {canManage ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            {count > 0 ? 'Editar' : 'Diseñar'}
          </Button>
        ) : null}
      </div>

      {open ? (
        <CertificateEditor
          warehouseId={warehouseId}
          warehouseName={warehouseName}
          onClose={() => {
            qc.invalidateQueries({ queryKey: ['certificate-template', warehouseId] });
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
