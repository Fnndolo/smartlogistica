'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { SkydropxAddressTemplate, SkydropxSedeConfig } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Props {
  warehouseId: string;
  initial: SkydropxSedeConfig | null;
}

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400';

/**
 * Remitente Skydropx de la sede: cual de las direcciones GUARDADAS en el panel
 * de Skydropx usa esta sede como origen. Gestion SEPARADA de Coordinadora
 * (Coordinadora lo suyo, Skydropx lo suyo): las direcciones verificadas
 * habilitan paqueterias que exigen origen verificado (ej. Inter Rapidisimo).
 */
export function SkydropxSedeCard({ warehouseId, initial }: Props) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  // Mismos roles que gestionan la conexion Skydropx del tenant.
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const { data: config } = useQuery({
    queryKey: ['skydropx-sede-config', warehouseId],
    queryFn: () => api.get<SkydropxSedeConfig | null>(`/v1/skydropx/sede-config/${warehouseId}`),
    initialData: initial,
  });

  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Remitente Skydropx</h3>
              {config ? (
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  Fijado
                </Badge>
              ) : (
                <Badge variant="outline">Sin fijar</Badge>
              )}
            </div>

            <p className="mt-0.5 text-sm text-muted-foreground">
              La dirección de origen guardada en Skydropx que usa esta sede para cotizar y generar
              guías. Las verificadas habilitan paqueterías como Inter Rapidísimo.
            </p>

            {config ? (
              <p className="mt-1.5 truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{config.alias ?? 'Dirección'}</span>
                {config.city ? (
                  <>
                    <span className="px-1.5 text-border">·</span>
                    {config.city}
                  </>
                ) : null}
                {config.postalCode ? (
                  <>
                    <span className="px-1.5 text-border">·</span>
                    CP {config.postalCode}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>

        {canManage && !open ? (
          <Button
            variant={config ? 'outline' : 'default'}
            size="sm"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {config ? 'Editar' : 'Fijar'}
          </Button>
        ) : null}
      </div>

      {open ? (
        <SkydropxSedePicker
          warehouseId={warehouseId}
          currentId={config?.addressTemplateId ?? null}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['skydropx-sede-config', warehouseId] });
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SkydropxSedePicker({
  warehouseId,
  currentId,
  onDone,
  onCancel,
}: {
  warehouseId: string;
  /** Plantilla ya fijada (arranca preseleccionada al editar). */
  currentId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Direcciones guardadas en el panel de Skydropx. Si la conexion Skydropx no
  // esta configurada el GET responde 400 con mensaje claro -> se muestra en
  // gris sin romper la tarjeta (por eso retry: false).
  const { data, isPending, error } = useQuery({
    queryKey: ['skydropx-address-templates'],
    queryFn: () => api.get<SkydropxAddressTemplate[]>('/v1/skydropx/address-templates'),
    staleTime: 60_000,
    retry: false,
  });

  const [selectedId, setSelectedId] = useState<string | null>(currentId);
  const [saving, setSaving] = useState(false);

  // Solo las 'from' sirven de remitente (las 'to' son destinos guardados).
  const froms = (data ?? []).filter((t) => t.addressType === 'from');

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.put(`/v1/skydropx/sede-config/${warehouseId}`, { addressTemplateId: selectedId });
      toast.success('Remitente Skydropx guardado');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar el remitente');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      {isPending ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          {error instanceof ApiError
            ? error.message
            : 'No se pudieron cargar las direcciones de Skydropx.'}
        </p>
      ) : froms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          No hay direcciones de origen guardadas en el panel de Skydropx.
        </p>
      ) : (
        <div className="space-y-2">
          {froms.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              selected={t.id === selectedId}
              onSelect={() => setSelectedId(t.id)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={save}
          loading={saving}
          disabled={!selectedId || isPending || Boolean(error)}
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}

/** Fila seleccionable de plantilla: alias — ciudad · CP + badge de verificada. */
function TemplateRow({
  template,
  selected,
  onSelect,
}: {
  template: SkydropxAddressTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-accent/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent' : 'border-border',
        )}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{template.alias}</span>
        <span className="text-muted-foreground">
          {template.city ? ` — ${template.city}` : ''}
          {template.postalCode ? ` · CP ${template.postalCode}` : ''}
        </span>
      </p>
      {template.verifiedCarriers.length > 0 ? (
        <Badge variant="success" className="shrink-0">
          Verificada: {template.verifiedCarriers.join(', ')}
        </Badge>
      ) : null}
    </button>
  );
}
