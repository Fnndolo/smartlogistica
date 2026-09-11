'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileBadge, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { CertificateMode, CertificateTemplate } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { CertificateEditor } from './certificate-editor';
import { ExternalCertificateForm } from './external-certificate-form';

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400';

const MODES: Array<{ value: CertificateMode; label: string; hint: string }> = [
  {
    value: 'template',
    label: 'Plantilla',
    hint: 'La factura de Alegra se transforma en certificado con la plantilla de esta sede.',
  },
  {
    value: 'off',
    label: 'Sin certificado',
    hint: 'No se adjunta ningún documento al chat. La factura igual queda emitida en Alegra.',
  },
  {
    value: 'external',
    label: 'Emisor externo',
    hint: 'El certificado lo emite otro sistema por API y se adjunta solo ese PDF; la factura de Alegra no se le manda al comprador.',
  },
];

/**
 * Certificado de Garantia de la sede: que documento recibe el comprador al
 * facturar. Tres modos — la plantilla de siempre, nada, o un emisor externo
 * por API (que trae su propio consecutivo y su propio diseño).
 */
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
  const [saving, setSaving] = useState(false);

  const { data: modeData } = useQuery({
    queryKey: ['certificate-mode', warehouseId],
    queryFn: () =>
      api.get<{ mode: CertificateMode }>(`/v1/warehouses/${warehouseId}/certificate/mode`),
  });
  const mode = modeData?.mode ?? 'template';

  const { data: template } = useQuery({
    queryKey: ['certificate-template', warehouseId],
    queryFn: () =>
      api.get<CertificateTemplate | null>(`/v1/warehouses/${warehouseId}/certificate/template`),
    // La plantilla solo se usa en modo 'template'.
    enabled: mode === 'template',
  });

  const count = template?.elements?.length ?? 0;

  const changeMode = async (next: CertificateMode) => {
    if (next === mode) return;
    setSaving(true);
    try {
      await api.put(`/v1/warehouses/${warehouseId}/certificate/mode`, { mode: next });
      await qc.invalidateQueries({ queryKey: ['certificate-mode', warehouseId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar el modo');
    } finally {
      setSaving(false);
    }
  };

  const badge = () => {
    if (mode === 'off') return <Badge variant="outline">Desactivado</Badge>;
    if (mode === 'external') return <Badge variant="success">Emisor externo</Badge>;
    return count > 0 ? (
      <Badge variant="success">
        <Check className="h-3 w-3" />
        Configurado
      </Badge>
    ) : (
      <Badge variant="outline">Sin plantilla</Badge>
    );
  };

  const description = () => {
    if (mode === 'off') return `Al facturar en ${warehouseName} no se adjunta ningún documento.`;
    if (mode === 'external')
      return `El certificado de ${warehouseName} lo emite un servicio externo por API.`;
    return count > 0
      ? `La factura de ${warehouseName} se convierte en certificado al facturar (${count} elemento${count === 1 ? '' : 's'}).`
      : `Diseña como convertir la factura de ${warehouseName} en Certificado de Garantia.`;
  };

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
              {badge()}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{description()}</p>
          </div>
        </div>

        {canManage && mode === 'template' ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            {count > 0 ? 'Editar' : 'Diseñar'}
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                disabled={saving}
                onClick={() => changeMode(m.value)}
                title={m.hint}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  mode === m.value
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                    : 'border-border text-muted-foreground hover:border-violet-500/30 hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {MODES.find((m) => m.value === mode)?.hint}
          </p>

          {mode === 'external' ? <ExternalCertificateForm warehouseId={warehouseId} /> : null}
        </>
      ) : null}

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
