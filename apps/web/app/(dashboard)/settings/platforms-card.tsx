'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { badgeColorSchema, type BadgeColor, type Platform } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { BADGE_COLOR_CLASSES, SWATCH_COLOR_CLASSES } from '../orders/platform-badge';
import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  CardHead,
  EMPTY_CLS,
  FOCUS_RING,
} from './settings-ui';

interface Row {
  /** Clave local estable de la fila (sobrevive al renombrado y a las nuevas). */
  key: string;
  /** id estable de la plataforma; null = fila nueva (se genera al guardar). */
  id: string | null;
  name: string;
  color: BadgeColor;
}

const ALL_COLORS = badgeColorSchema.options;

/** Nombre en cristiano de cada color (solo para lectores de pantalla/tooltip). */
const COLOR_LABEL: Record<BadgeColor, string> = {
  rose: 'Rosa',
  red: 'Rojo',
  yellow: 'Amarillo',
  amber: 'Ámbar',
  orange: 'Naranja',
  emerald: 'Esmeralda',
  lime: 'Lima',
  sky: 'Celeste',
  blue: 'Azul',
  cyan: 'Cian',
  violet: 'Violeta',
  fuchsia: 'Fucsia',
  slate: 'Gris',
};

/**
 * Badge con la MISMA receta que pinta la columna "Plataforma" de la sede
 * (PlatformBadge): lo que se ve aqui es exactamente lo que vera el equipo.
 */
const BADGE_CLS =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[2.5px] text-[9.5px] font-semibold uppercase tracking-[0.05em]';

/** Foco de teclado sobre la bandeja de la paleta (bg-surface, no bg-card). */
const CHIP_FOCUS = cn(FOCUS_RING, 'focus-visible:ring-offset-surface');

/** Mensaje unico de validacion (nombre de 2 a 40 letras y sin repetir). */
const VALIDATION_HINT = 'Cada plataforma necesita un nombre (2 a 40 letras) y no puede repetirse.';

const toRows = (ps: Platform[]): Row[] =>
  ps.map((p) => ({ key: p.id, id: p.id, name: p.name, color: p.color }));

/** Huella del borrador: sirve para saber si hay cambios SIN guardar. */
const fingerprint = (rs: Row[]): string => JSON.stringify(rs.map((r) => [r.id, r.name, r.color]));

/**
 * Catalogo de PLATAFORMAS: de donde viene cada pedido. VTEX es la integracion
 * (no se puede eliminar, solo su color); las demas (Krediya, Mercado Libre...)
 * se eligen al MONTAR un pedido a mano. El color pinta el badge de la columna
 * "Plataforma" en la sede.
 *
 * La tarjeta MUESTRA la paleta (los badges de verdad, tal cual salen en la
 * tabla) y solo se convierte en formulario cuando eliges editar UNA — antes
 * era una hoja de calculo de inputs vacios donde nada se leia como contenido.
 */
export function PlatformsCard({ initial }: { initial: Platform[] | null }) {
  const qc = useQueryClient();
  // null = aun no hay catalogo REAL cargado (el SSR fallo). Se reintenta por
  // el cliente; el guardado queda bloqueado hasta tener datos de verdad — un
  // PUT sembrado con defaults pisaria el catalogo personalizado.
  const [rows, setRows] = useState<Row[] | null>(initial ? toRows(initial) : null);
  /** Ultimo estado GUARDADO: hay cambios pendientes si el borrador difiere. */
  const [saved, setSaved] = useState<Row[]>(() => (initial ? toRows(initial) : []));
  /** Fila abierta en el editor (una sola a la vez) y su copia para "Cancelar". */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Row | null>(null);
  const newKeys = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const editorId = `plat-editor-${uid}`;
  const nameId = `plat-name-${uid}`;

  const fallback = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/v1/platforms'),
    enabled: rows === null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (rows === null && fallback.data) {
      setRows(toRows(fallback.data));
      setSaved(toRows(fallback.data));
    }
  }, [rows, fallback.data]);

  // Al abrir el editor el cursor cae en el nombre (en VTEX esta deshabilitado).
  useEffect(() => {
    if (editingKey) nameRef.current?.focus();
  }, [editingKey]);

  const current = rows ?? [];
  const editing = current.find((r) => r.key === editingKey) ?? null;
  const dirty = rows !== null && fingerprint(rows) !== fingerprint(saved);

  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)));
  const dropRow = (key: string) => setRows((rs) => (rs ?? []).filter((r) => r.key !== key));

  /** Abrir el editor de UNA plataforma (guardando como estaba, para cancelar). */
  const openEditor = (row: Row) => {
    setEditingKey(row.key);
    // Una fila que todavia no existe en el servidor no tiene "como estaba":
    // cancelarla la descarta, igual que si se acabara de agregar.
    setSnapshot(row.id ? { ...row } : null);
  };
  /** "Agregar" abre UN formulario vacio, no una fila en blanco en la lista. */
  const startAdd = () => {
    const key = `new-${++newKeys.current}`;
    setRows((rs) => [...(rs ?? []), { key, id: null, name: '', color: 'sky' }]);
    setEditingKey(key);
    setSnapshot(null); // sin copia previa = fila nueva: cancelar la descarta
  };
  const cancelEdit = () => {
    if (!editingKey) return;
    if (snapshot) patch(editingKey, snapshot);
    else dropRow(editingKey);
    setEditingKey(null);
    setSnapshot(null);
  };
  const removeEditing = () => {
    if (!editingKey) return;
    dropRow(editingKey);
    setEditingKey(null);
    setSnapshot(null);
  };
  /** Vuelve el borrador a lo ultimo guardado (deshace borrados pendientes). */
  const discard = () => {
    setRows(saved.map((r) => ({ ...r })));
    setEditingKey(null);
    setSnapshot(null);
  };

  const valid =
    current.length > 0 &&
    current.every((r) => r.name.trim().length >= 2 && r.name.trim().length <= 40) &&
    new Set(current.map((r) => r.name.trim().toLowerCase())).size === current.length;

  const save = useMutation({
    mutationFn: () => {
      // id estable: el existente, o un slug del nombre (unico) para las nuevas.
      const taken = new Set(current.map((r) => r.id).filter(Boolean) as string[]);
      const payload = current.map((r) => {
        if (r.id) return { id: r.id, name: r.name.trim(), color: r.color };
        // Sufijo anticolision SIN pasarse de los 40 chars que exige el schema.
        const base = slugify(r.name);
        let id = base;
        for (let n = 2; taken.has(id); n++) {
          const suffix = `-${n}`;
          id = `${base.slice(0, 40 - suffix.length)}${suffix}`;
        }
        taken.add(id);
        return { id, name: r.name.trim(), color: r.color };
      });
      return api.put<Platform[]>('/v1/platforms', payload);
    },
    onSuccess: (list) => {
      setRows(toRows(list));
      setSaved(toRows(list));
      setEditingKey(null);
      setSnapshot(null);
      toast.success('Plataformas guardadas');
      // Refresca los badges de la tabla y el selector de "Montar pedido".
      qc.invalidateQueries({ queryKey: ['platforms'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar las plataformas'),
  });

  const hint = !valid && dirty ? VALIDATION_HINT : null;
  /** El PUT REEMPLAZA el catalogo entero: que quede claro que commit se hace. */
  const commitNote = `Al guardar se reemplaza el catálogo completo: quedarán ${current.length} ${
    current.length === 1 ? 'plataforma' : 'plataformas'
  }.`;

  return (
    <div className={CARD_CLS}>
      <CardHead
        icon={<Store />}
        title="Plataformas"
        description="De dónde viene cada pedido. Las eliges al montar un pedido a mano y pintan la columna «Plataforma» de la sede con su color. VTEX es la integración: puedes cambiarle el color, no eliminarla."
      />

      {rows === null ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>
          {fallback.isError ? (
            <>
              No se pudo cargar el catálogo de plataformas (¿API reiniciando?).{' '}
              <button
                type="button"
                onClick={() => fallback.refetch()}
                className={cn(
                  'rounded font-bold text-accent-ink underline underline-offset-2',
                  FOCUS_RING,
                )}
              >
                Reintentar
              </button>
            </>
          ) : (
            'Cargando plataformas...'
          )}
        </div>
      ) : current.length === 0 ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>
          <p className="mx-auto max-w-[46ch]">
            El catálogo está vacío. Agrega la primera plataforma (Krediya, Mercado Libre…) para
            poder elegirla al montar un pedido a mano.
          </p>
          <Button className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS, 'mx-auto mt-2.5')} onClick={startAdd}>
            <Plus />
            Agregar plataforma
          </Button>
          {/* Si el catalogo quedo vacio POR ELIMINACIONES sin guardar, hay que
              poder deshacerlas: sin esto quedaban invisibles y sin salida. */}
          {dirty ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="text-[11px] text-hint">Cambios sin guardar</span>
              <Button
                variant="outline"
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                onClick={() => setRows(saved.map((r) => ({ ...r })))}
              >
                Descartar
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* La paleta: los badges DE VERDAD, como se ven en la sede. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[11px] border border-border bg-surface px-2.5 py-2">
            {current.map((r) => {
              const isVtex = r.id === 'vtex';
              const isOpen = r.key === editingKey;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => openEditor(r)}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? editorId : undefined}
                  title={
                    isVtex
                      ? 'VTEX es la integración: solo el color'
                      : `Editar ${r.name.trim() || 'plataforma'}`
                  }
                  className={cn(
                    'group inline-flex items-center gap-1.5 rounded-full py-1',
                    CHIP_FOCUS,
                  )}
                >
                  <span
                    className={cn(
                      BADGE_CLS,
                      BADGE_COLOR_CLASSES[r.color],
                      'transition-transform [transition-duration:140ms] group-hover:-translate-y-px motion-reduce:transition-none motion-reduce:group-hover:translate-y-0',
                      isOpen && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-[5px] w-[5px] shrink-0 rounded-full bg-current"
                    />
                    {r.name.trim() || 'Nueva'}
                    <Pencil
                      aria-hidden
                      className={cn(
                        'ml-px h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity [transition-duration:140ms] group-hover:opacity-70',
                        isOpen && 'opacity-100',
                      )}
                    />
                  </span>
                  {isVtex ? (
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-hint">
                      Integración
                    </span>
                  ) : null}
                </button>
              );
            })}

            <button
              type="button"
              onClick={startAdd}
              className={cn(
                'my-1 inline-flex items-center gap-1 rounded-full border border-dashed border-input bg-card px-2 py-[2.5px] text-[9.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground transition-colors [transition-duration:140ms] hover:border-accent hover:text-accent-ink',
                CHIP_FOCUS,
              )}
            >
              <Plus aria-hidden className="h-2.5 w-2.5 shrink-0" />
              Agregar plataforma
            </button>
          </div>

          {/* Editor de UNA sola plataforma: lo demas sigue siendo lectura. */}
          {editing ? (
            <div
              id={editorId}
              className="mt-2.5 rounded-[11px] border border-accent/35 bg-wash p-3"
            >
              <div className="flex items-center gap-[9px]">
                <h4 className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-accent-ink">
                  {editing.id === null ? 'Nueva plataforma' : 'Editando plataforma'}
                </h4>
                <span aria-hidden className="h-px flex-1 bg-accent/25" />
              </div>

              <div className="mt-2.5 space-y-1.5">
                <Label htmlFor={nameId} className="text-[12px]">
                  Nombre
                </Label>
                <Input
                  id={nameId}
                  ref={nameRef}
                  value={editing.name}
                  placeholder="Ej. Krediya"
                  maxLength={40}
                  disabled={editing.id === 'vtex'}
                  onChange={(e) => patch(editing.key, { name: e.target.value })}
                  className="h-9 max-w-[300px] bg-card"
                />
                {editing.id === 'vtex' ? (
                  <p className="text-[11px] text-hint">
                    El nombre de la integración no se cambia; su color sí.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5">
                <Label className="text-[12px]">Color del badge</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patch(editing.key, { color: c })}
                      aria-label={COLOR_LABEL[c]}
                      aria-pressed={c === editing.color}
                      title={COLOR_LABEL[c]}
                      className={cn(
                        'grid h-6 w-6 place-items-center rounded-full transition-transform [transition-duration:140ms] hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100',
                        SWATCH_COLOR_CLASSES[c],
                        c === editing.color && 'ring-2 ring-accent ring-offset-2 ring-offset-wash',
                        FOCUS_RING,
                        'focus-visible:ring-offset-wash',
                      )}
                    >
                      {c === editing.color ? (
                        <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              {hint ? <p className="mt-2.5 text-[11px] text-hint">{hint}</p> : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-accent/20 pt-2.5">
                {editing.id !== 'vtex' ? (
                  <Button
                    variant="outline"
                    className={cn(
                      BTN_GHOST_CLS,
                      BTN_SM_CLS,
                      'hover:border-destructive hover:text-destructive',
                    )}
                    onClick={removeEditing}
                  >
                    <Trash2 />
                    Eliminar
                  </Button>
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                    onClick={cancelEdit}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
                    onClick={() => save.mutate()}
                    disabled={!dirty || !valid}
                    loading={save.isPending}
                  >
                    Guardar
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-hint">{commitNote}</p>
            </div>
          ) : dirty ? (
            /* Cambios pendientes con el editor cerrado (p. ej. una eliminada). */
            <div className="mt-2.5 rounded-[11px] border border-border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
                  <span className="font-bold text-foreground">Cambios sin guardar.</span>{' '}
                  {commitNote}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                    onClick={discard}
                  >
                    Descartar
                  </Button>
                  <Button
                    className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
                    onClick={() => save.mutate()}
                    disabled={!dirty || !valid}
                    loading={save.isPending}
                  >
                    Guardar catálogo
                  </Button>
                </div>
              </div>
              {hint ? <p className="mt-2 text-[11px] text-hint">{hint}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plataforma'
  );
}
