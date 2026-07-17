'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, ChevronDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PRESETS,
  type PresetValue,
  buildCustomRange,
  computeRange,
  isoToYmdInColombia,
  presetLabel,
  resolvePreset,
} from '@/lib/date-presets';

export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const activePreset = resolvePreset(from, to);

  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(isoToYmdInColombia(from));
  const [customTo, setCustomTo] = useState(isoToYmdInColombia(to));
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Cerrar al click afuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Sync inputs custom con la URL cuando cambia
  useEffect(() => {
    setCustomFrom(isoToYmdInColombia(from));
    setCustomTo(isoToYmdInColombia(to));
  }, [from, to]);

  function applyPreset(value: PresetValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'custom') {
      // Solo abrimos el panel custom; el apply real ocurre en applyCustom()
      return;
    }
    const range = computeRange(value);
    params.set('from', range.from);
    params.set('to', range.to);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function applyCustom() {
    const range = buildCustomRange(customFrom, customTo);
    if (!range) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('from', range.from);
    params.set('to', range.to);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('from');
    params.delete('to');
    params.delete('page');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
    setOpen(false);
  }

  const label = activePreset ? presetLabel(activePreset) : 'Todas las fechas';
  const hasFilter = Boolean(from && to);

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        onClick={() => setOpen((s) => !s)}
        className={cn(hasFilter && 'border-foreground/40')}
      >
        <Calendar className="h-3.5 w-3.5" />
        <span className="text-xs">
          Creado: <span className="font-semibold">{label}</span>
        </span>
        {hasFilter ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpiar filtro"
            onClick={(e) => {
              e.stopPropagation();
              clearFilter();
            }}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </Button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          <ul className="p-1.5">
            {PRESETS.map((preset) => {
              const isActive = activePreset === preset.value;
              return (
                <li key={preset.value}>
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.value)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                      'hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        isActive ? 'border-foreground' : 'border-muted-foreground/40',
                      )}
                    >
                      {isActive ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                    </span>
                    {preset.label}
                  </button>
                </li>
              );
            })}
          </ul>

          {activePreset === 'custom' || (activePreset === null && hasFilter) ? (
            <div className="border-t border-border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  Desde
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="block h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    max={customTo || undefined}
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Hasta
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="block h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    min={customFrom || undefined}
                  />
                </label>
              </div>
              <Button
                onClick={applyCustom}
                disabled={!customFrom || !customTo}
                size="sm"
                className="mt-3 w-full"
              >
                Aplicar
              </Button>
            </div>
          ) : null}

          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Zona horaria: Colombia (GMT-5)
          </div>
        </div>
      ) : null}
    </div>
  );
}
