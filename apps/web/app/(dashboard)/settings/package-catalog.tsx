'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Boxes,
  Check,
  ChevronDown,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Ruler,
  Search,
  Star,
  Tag,
  Trash2,
  Weight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SkydropxPackaging } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  CardHead,
  EMPTY_CLS,
  FOCUS_RING,
  ICON_BTN_NEUTRAL_CLS,
  PageHead,
  Pill,
} from './settings-ui';

/* ===========================================================================
   CATALOGO DE PAQUETES (pieza compartida)

   Los dos catalogos — "Paquetes de guía" (Coordinadora) y "Paquetes Skydropx"
   — son HERMANOS: misma pagina, mismas filas, mismo panel. Aqui vive la pieza
   entera y cada tarjeta solo aporta su variante, su lista inicial y su PUT.

   Reglas de la pieza:
   · NO hay boton global de guardar. Se guarda al confirmar UN paquete en el
     panel (y al eliminarlo): una accion = un guardado. El endpoint sigue
     siendo de reemplazo total, asi que se manda la lista completa ya mutada.
   · UN solo boton "Agregar paquete": el de la cabecera (de pagina o de
     tarjeta). El estado vacio NO repite la llamada a la accion.
=========================================================================== */

export type PackageCatalogVariant = 'coordinadora' | 'skydropx';

/**
 * Un paquete EN EDICION: todo en texto, que es como vive en los campos. Las
 * dos variantes comparten forma; Coordinadora sencillamente no usa embalaje ni
 * valor declarado (quedan en '' y su tarjeta nunca los manda).
 */
export interface PackageDraft {
  /** Alias del paquete (el `name` del esquema). */
  name: string;
  length: string;
  width: string;
  height: string;
  weight: string;
  content: string;
  /** Solo Skydropx: codigo del catalogo de embalajes (ej. '4G'). */
  packagingCode: string;
  /** Solo Skydropx: valor asegurado en COP (vacio = se calcula en la guia). */
  declaredValue: string;
  isDefault: boolean;
}

export const EMPTY_DRAFT: PackageDraft = {
  name: '',
  length: '',
  width: '',
  height: '',
  weight: '',
  content: '',
  packagingCode: '',
  declaredValue: '',
  isDefault: false,
};

/** Embalaje por defecto del catalogo de Skydropx: '4G' = Caja de carton. */
export const DEFAULT_PACKAGING_CODE = '4G';

/** Rango que asegura Skydropx (el esquema lo repite del lado del servidor). */
const DECLARED_MIN = 10_000;
const DECLARED_MAX = 10_000_000;

/* ------------------------------- validacion ------------------------------- */

const positive = (v: string): boolean => Number(v) > 0;

/** Valor declarado: vacio es valido; lleno tiene que caer dentro del rango. */
export const declaredValueValid = (v: string): boolean => {
  const s = v.trim();
  if (!s) return true;
  const n = Number(s);
  return Number.isFinite(n) && n >= DECLARED_MIN && n <= DECLARED_MAX;
};

/**
 * Regla de siempre (alias + los cuatro numeros mayores que cero) mas lo propio
 * de Skydropx: contenido obligatorio y valor declarado dentro de rango.
 */
export const draftValid = (d: PackageDraft, variant: PackageCatalogVariant): boolean =>
  d.name.trim().length > 0 &&
  positive(d.weight) &&
  positive(d.height) &&
  positive(d.width) &&
  positive(d.length) &&
  (variant === 'coordinadora' || d.content.trim().length > 0) &&
  declaredValueValid(d.declaredValue);

/** "20.0" -> "20" para la fila; si aun no es numero, deja el texto crudo. */
const num = (v: string): string => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? String(n) : v.trim();
};

/** Miles con punto (es-CO) para el rango del valor declarado. */
const cop = (n: number): string => n.toLocaleString('es-CO');

/** Busqueda tolerante: sin mayusculas y sin tildes. */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/* --------------------------------- estilo --------------------------------- */

/* Lenguaje de campo IDENTICO al del panel de guia: superficie de tarjeta, 10px
   de radio y la unidad como sufijo DENTRO del campo (cm / kg). */
const FIELD_LABEL_CLS = 'block text-[11px] font-bold uppercase tracking-[0.06em] text-hint';
const INPUT_CLS =
  'h-auto min-h-[38px] rounded-[10px] border-input bg-card text-[13px] shadow-none transition-colors [transition-duration:140ms] placeholder:text-hint hover:border-accent';
const SUFFIX_CLS =
  'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-hint';
const HELP_CLS = 'text-[11px] leading-[1.45] text-hint';

/** Duracion del deslizamiento del panel (ida y vuelta). */
const DRAWER_MS = 200;

/* -------------------------------- variantes ------------------------------- */

interface VariantConfig {
  title: string;
  description: string;
  /** Icono de la casilla cuando va embebido en Ajustes como tarjeta. */
  icon: React.ReactNode;
  namePlaceholder: string;
  contentPlaceholder: string;
  /** Toast de exito al guardar (el de siempre en cada catalogo). */
  savedMessage: string;
  emptyHint: string;
}

/** Toast propio de la eliminacion (que tambien es un guardado de la lista). */
const DELETED_MESSAGE = 'Paquete eliminado';
const DEFAULT_MESSAGE = 'Paquete predeterminado actualizado';

const VARIANTS: Record<PackageCatalogVariant, VariantConfig> = {
  coordinadora: {
    title: 'Paquetes de guía',
    description:
      'Como los empaques del portal de Coordinadora: al generar una guía los eliges y llenan medidas y peso de un clic. Aplican a todas las sedes.',
    icon: <Package />,
    namePlaceholder: 'Ej. Celular',
    contentPlaceholder: 'Ej. TECNOLOGIA',
    savedMessage: 'Paquetes guardados',
    emptyHint:
      'Guarda las medidas que más repites (ej. «Celular», «Portátil») y al generar una guía las cargas de un clic.',
  },
  skydropx: {
    title: 'Paquetes Skydropx',
    description:
      'Como los «Mis paquetes» de tu panel de Skydropx (su API no los deja traer): al generar en modo Skydropx los eliges y llenan medidas y peso de un clic. Independientes de los paquetes de Coordinadora.',
    icon: <Boxes />,
    namePlaceholder: 'Ej. CAJA MEDIANA',
    contentPlaceholder: 'Ej. TECNOLOGIA',
    savedMessage: 'Paquetes de Skydropx guardados',
    emptyHint:
      'Guarda las medidas que más repites (ej. «TECNOLOGIA») y al generar una guía en modo Skydropx las cargas de un clic.',
  },
};

/* ============================ selector de embalaje ========================= */

/**
 * Desplegable del EMBALAJE de Skydropx. No es un <select> nativo: el del
 * navegador se dibuja fuera del drawer, ignora el diseño y con un catalogo de
 * ~20 items ocupaba media pantalla. Este vive DENTRO del panel, se limita en
 * alto y trae buscador, que con esa lista larga es lo que hace falta.
 */
function PackagingPicker({
  id,
  value,
  options,
  loading,
  onPick,
}: {
  id: string;
  value: string;
  options: SkydropxPackaging[];
  loading: boolean;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera o con Escape (el Escape del panel se detiene
  // aqui: primero cierra la lista, no el drawer entero).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const known = options.find((p) => p.code === value);
  // Codigo guardado que ya no esta en el catalogo: se muestra tal cual en vez
  // de aparecer como "Sin embalaje" y perderse al guardar.
  const label = loading
    ? 'Cargando embalajes…'
    : known
      ? `${known.name} · ${known.code}`
      : value
        ? value
        : 'Sin embalaje';

  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const term = norm(q.trim());
  const shown = term ? options.filter((p) => norm(`${p.name} ${p.code}`).includes(term)) : options;

  const choose = (code: string) => {
    onPick(code);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex min-h-[38px] w-full items-center gap-2 rounded-[10px] border border-input bg-card px-3 py-2 text-left text-[13px] transition-colors [transition-duration:140ms] hover:border-accent disabled:opacity-60',
          FOCUS_RING,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !value && !loading && 'text-hint')}>
          {label}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-hint transition-transform [transition-duration:140ms]',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 overflow-hidden rounded-[11px] border border-border bg-popover shadow-[var(--shadow-float)]">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-hint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar embalaje…"
              aria-label="Buscar embalaje"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-hint"
            />
          </div>
          {/* Alto acotado: la lista scrollea DENTRO, nunca desborda el panel. */}
          <ul role="listbox" className="max-h-[220px] overflow-y-auto p-1">
            <PackagingOption selected={!value} onPick={() => choose('')}>
              Sin embalaje
            </PackagingOption>
            {shown.map((p) => (
              <PackagingOption
                key={p.code}
                selected={p.code === value}
                onPick={() => choose(p.code)}
              >
                {p.name} <span className="text-hint">· {p.code}</span>
              </PackagingOption>
            ))}
            {shown.length === 0 ? (
              <li className="px-2.5 py-3 text-center text-[12px] text-hint">
                Nada para «{q.trim()}».
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PackagingOption({
  selected,
  onPick,
  children,
}: {
  selected: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onPick}
        className={cn(
          'flex w-full items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-left text-[12.5px] transition-colors [transition-duration:120ms] hover:bg-wash hover:text-accent-ink',
          selected && 'bg-wash font-bold text-accent-ink',
          FOCUS_RING,
        )}
      >
        <span className="min-w-0 flex-1 break-words">{children}</span>
        {selected ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    </li>
  );
}

/* =============================== fila (lista) ============================== */

/**
 * Paquete guardado: superficie BLANCA con sombra suave y una linea por dato,
 * cada una con su icono (nombre / dimensiones / peso / contenido). La fila NO
 * se puede clickear: editar, predeterminar y eliminar viven en su menu.
 */
export function PackageRow({
  row,
  onOpen,
  onDelete,
  onMakeDefault,
}: {
  row: PackageDraft;
  onOpen: () => void;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  const alias = row.name.trim() || 'Sin nombre';

  return (
    <li>
      {/* La fila NO es clickeable: las acciones viven en el menu de la derecha
          (editar / predeterminada / eliminar). */}
      <div className="flex w-full items-start gap-3 rounded-[12px] border border-border bg-card px-3.5 py-3 text-left shadow-[var(--shadow-card)] transition-[border-color,box-shadow] [transition-duration:140ms] hover:shadow-[var(--shadow-float)]">
        <span className="block min-w-0 flex-1 space-y-[3px]">
          <span className="flex min-w-0 items-center gap-2">
            <Package aria-hidden className="h-[14px] w-[14px] shrink-0 text-accent" />
            <span className="min-w-0 truncate text-[13.5px] font-extrabold text-foreground">
              {alias}
            </span>
            {row.isDefault ? <Pill tone="cobalt">Predeterminada</Pill> : null}
          </span>
          <RowLine
            icon={<Ruler aria-hidden className="h-[13px] w-[13px] shrink-0 text-hint" />}
            label="Dimensiones (L × An × Al)"
            value={`${num(row.length)} × ${num(row.width)} × ${num(row.height)} cm`}
            numeric
          />
          <RowLine
            icon={<Weight aria-hidden className="h-[13px] w-[13px] shrink-0 text-hint" />}
            label="Peso"
            value={`${num(row.weight)} kg`}
            numeric
          />
          <RowLine
            icon={<Tag aria-hidden className="h-[13px] w-[13px] shrink-0 text-hint" />}
            label="Contenido"
            value={row.content.trim()}
          />
        </span>
        <RowMenu
          alias={alias}
          isDefault={Boolean(row.isDefault)}
          onEdit={onOpen}
          onMakeDefault={onMakeDefault}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}

/** Menu de la fila (tres puntos): editar, predeterminada y eliminar. */
function RowMenu({
  alias,
  isDefault,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  alias: string;
  isDefault: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Al cerrar el menu la confirmacion vuelve a cero: no puede quedar armada.
  useEffect(() => {
    if (!open) setConfirm(false);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Acciones de ${alias}`}
        className={cn(
          'grid h-8 w-8 place-items-center rounded-[9px] border border-transparent text-hint transition-colors [transition-duration:140ms] hover:border-border hover:bg-surface hover:text-foreground',
          open && 'border-border bg-surface text-foreground',
          FOCUS_RING,
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-10 w-[212px] overflow-hidden rounded-[11px] border border-border bg-popover p-1 shadow-[var(--shadow-float)]"
        >
          <MenuItem icon={<Pencil />} onClick={() => run(onEdit)}>
            Editar
          </MenuItem>
          <MenuItem icon={<Star />} disabled={isDefault} onClick={() => run(onMakeDefault)}>
            {isDefault ? 'Ya es la predeterminada' : 'Marcar como predeterminada'}
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          {confirm ? (
            <MenuItem icon={<Trash2 />} danger onClick={() => run(onDelete)}>
              Sí, eliminar
            </MenuItem>
          ) : (
            <MenuItem icon={<Trash2 />} danger onClick={() => setConfirm(true)}>
              Eliminar
            </MenuItem>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left text-[12.5px] font-semibold transition-colors [transition-duration:120ms]',
        disabled
          ? 'cursor-default text-hint'
          : danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-muted-foreground hover:bg-wash hover:text-accent-ink',
        FOCUS_RING,
      )}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center [&>svg]:h-[14px] [&>svg]:w-[14px]">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Una linea de la fila: icono · etiqueta · separador · valor. */
function RowLine({
  icon,
  label,
  value,
  numeric = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
      {icon}
      <span className="shrink-0">{label}</span>
      <span aria-hidden className="shrink-0 text-border">
        |
      </span>
      <span
        className={cn('min-w-0 truncate font-semibold text-foreground', numeric && 'tabular-nums')}
        title={value || undefined}
      >
        {value}
      </span>
    </span>
  );
}

/* ============================ panel (drawer) ============================== */

/** Una APERTURA del panel (su id reinicia el formulario en cada apertura). */
export interface PackageSession {
  id: string;
  /** Posicion en la lista; null = paquete nuevo. */
  index: number | null;
  draft: PackageDraft;
}

/**
 * Panel lateral «Plantilla de paquete»: mismo mecanismo que el drawer de
 * pedidos (portal, velo, Escape y bloqueo del scroll del cuerpo) pero pequeño
 * y autocontenido. Sirve igual para crear y para editar.
 */
export function PackageDrawer({
  session,
  variant,
  saving,
  deleting,
  onSave,
  onDelete,
  onClose,
}: {
  /** null = cerrado (se mantiene montado mientras sale). */
  session: PackageSession | null;
  variant: PackageCatalogVariant;
  saving: boolean;
  deleting: boolean;
  onSave: (draft: PackageDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState<PackageSession | null>(session);
  const [shown, setShown] = useState(false);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (session) {
      setRendered(session);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setRendered(null), DRAWER_MS);
    return () => clearTimeout(t);
  }, [session]);

  // Mientras se guarda o se elimina el panel NO se cierra: si el PUT falla hay
  // que poder corregir sin volver a teclear el paquete entero.
  const busy = saving || deleting;
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  /**
   * Quien abrio el panel, para devolverle el teclado al cerrar. Se captura
   * cuando APARECE el panel y en una ref, no dentro del efecto de Escape:
   * React corre los efectos de los hijos ANTES que los del padre, asi que el
   * formulario ya se habia llevado el foco a "Contenido" y era eso lo que se
   * guardaba como "origen".
   */
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (rendered && !openerRef.current) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    if (!rendered) openerRef.current = null;
  }, [rendered]);

  // Escape + bloqueo del scroll. Depende SOLO de `rendered`: antes tambien
  // dependia de `close`, que cambia de identidad en cada render (por `busy`),
  // y el cleanup arrancaba el foco de vuelta al formulario en plena escritura
  // — y en pleno "Guardar", que es cuando mas molesta.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!rendered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [rendered]);

  if (!mounted || !rendered) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={close}
        className={cn(
          'absolute inset-0 bg-scrim/55 backdrop-blur-[2px] transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-card shadow-[var(--shadow-float)] transition-transform duration-200 ease-out sm:w-[420px] sm:border-l sm:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-extrabold tracking-[-0.01em]">
              Plantilla de paquete
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {rendered.index === null ? 'Nueva plantilla' : 'Editando una plantilla guardada'}
            </p>
          </div>
          <Button
            variant="outline"
            className={ICON_BTN_NEUTRAL_CLS}
            onClick={close}
            disabled={busy}
            aria-label="Cerrar"
            title="Cerrar"
          >
            <X />
          </Button>
        </header>

        {/* key = apertura: cada vez que se abre, el formulario nace limpio. */}
        <PackageForm
          key={rendered.id}
          variant={variant}
          initial={rendered.draft}
          isNew={rendered.index === null}
          saving={saving}
          deleting={deleting}
          onSave={onSave}
          onDelete={onDelete}
          onCancel={close}
        />
      </aside>
    </div>,
    document.body,
  );
}

/** Cuerpo del panel: los campos de UN paquete y sus acciones. */
function PackageForm({
  variant,
  initial,
  isNew,
  saving,
  deleting,
  onSave,
  onDelete,
  onCancel,
}: {
  variant: PackageCatalogVariant;
  initial: PackageDraft;
  isNew: boolean;
  saving: boolean;
  deleting: boolean;
  onSave: (draft: PackageDraft) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cfg = VARIANTS[variant];
  const sdx = variant === 'skydropx';
  const [d, setD] = useState<PackageDraft>(initial);
  /** Eliminar pide confirmacion: persiste de una y no hay deshacer. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const patch = (p: Partial<PackageDraft>) => setD((cur) => ({ ...cur, ...p }));

  // Al abrir, el cursor ya esta en el primer campo (aqui no hay que buscarlo).
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Catalogo REAL de embalajes de Skydropx: la misma consulta (y la misma
  // clave) que usa el panel de guia, asi que se comparte la cache.
  const {
    data: packagings,
    error: packagingsError,
    isPending: packagingsPending,
  } = useQuery({
    queryKey: ['skydropx-packagings'],
    queryFn: () => api.get<SkydropxPackaging[]>('/v1/skydropx/packagings'),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
    enabled: sdx,
  });

  const busy = saving || deleting;
  const valid = draftValid(d, variant);
  const declaredBad = !declaredValueValid(d.declaredValue);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSave(d);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {sdx ? (
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-pack`} className={FIELD_LABEL_CLS}>
              Empaque
            </Label>
            {packagingsError ? (
              <p className="text-[11px] leading-[1.45] text-amber-600 dark:text-amber-400">
                {packagingsError instanceof ApiError
                  ? packagingsError.message
                  : 'No se pudo cargar el catálogo de embalajes de Skydropx.'}
              </p>
            ) : (
              <PackagingPicker
                id={`${id}-pack`}
                value={d.packagingCode}
                options={packagings ?? []}
                loading={packagingsPending}
                onPick={(code) => patch({ packagingCode: code })}
              />
            )}
          </div>
        ) : null}

        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-content`} className={FIELD_LABEL_CLS}>
            {sdx ? 'Contenido del paquete' : 'Contenido del paquete (opcional)'}
          </Label>
          <Input
            id={`${id}-content`}
            ref={firstFieldRef}
            value={d.content}
            placeholder={cfg.contentPlaceholder}
            onChange={(e) => patch({ content: e.target.value })}
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <NumField
            id={`${id}-l`}
            label="Largo"
            unit="cm"
            value={d.length}
            onChange={(v) => patch({ length: v })}
          />
          <NumField
            id={`${id}-w`}
            label="Ancho"
            unit="cm"
            value={d.width}
            onChange={(v) => patch({ width: v })}
          />
          <NumField
            id={`${id}-h`}
            label="Alto"
            unit="cm"
            value={d.height}
            onChange={(v) => patch({ height: v })}
          />
          <NumField
            id={`${id}-kg`}
            label="Peso"
            unit="kg"
            value={d.weight}
            onChange={(v) => patch({ weight: v })}
          />
        </div>

        {sdx ? (
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-declared`} className={FIELD_LABEL_CLS}>
              Valor declarado
            </Label>
            <div className="relative">
              <Input
                id={`${id}-declared`}
                inputMode="numeric"
                value={d.declaredValue}
                placeholder="0"
                aria-invalid={declaredBad}
                aria-describedby={`${id}-declared-help`}
                onChange={(e) => patch({ declaredValue: e.target.value.replace(/\D/g, '') })}
                className={cn(INPUT_CLS, 'pr-12 tabular-nums')}
              />
              <span className={SUFFIX_CLS} aria-hidden>
                COP
              </span>
            </div>
            <p
              id={`${id}-declared-help`}
              className={cn(HELP_CLS, declaredBad && 'font-semibold text-destructive')}
            >
              {declaredBad
                ? `El valor debe estar entre $${cop(DECLARED_MIN)} y $${cop(DECLARED_MAX)} COP.`
                : `Asegura el contenido del paquete entre $${cop(DECLARED_MIN)} y $${cop(DECLARED_MAX)} COP.`}
            </p>
          </div>
        ) : null}

        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-alias`} className={FIELD_LABEL_CLS}>
            Alias
          </Label>
          <Input
            id={`${id}-alias`}
            value={d.name}
            placeholder={cfg.namePlaceholder}
            onChange={(e) => patch({ name: e.target.value })}
            className={INPUT_CLS}
          />
        </div>

        <label
          htmlFor={`${id}-default`}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-[11px] border border-border bg-surface px-3 py-2.5 transition-colors [transition-duration:140ms] hover:border-accent',
            d.isDefault && 'border-accent bg-wash',
          )}
        >
          <input
            id={`${id}-default`}
            type="checkbox"
            checked={d.isDefault}
            onChange={(e) => patch({ isDefault: e.target.checked })}
            className={cn(
              'mt-px h-[15px] w-[15px] shrink-0 cursor-pointer rounded-[4px] border-input accent-accent',
              FOCUS_RING,
            )}
          />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-bold text-foreground">
              Marcar como predeterminada
            </span>
            <span className={cn('mt-0.5 block', HELP_CLS)}>
              Se utilizará esta plantilla como predeterminada en tus envíos.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button
          type="submit"
          className={BTN_PRIMARY_CLS}
          disabled={!valid || busy}
          loading={saving}
        >
          Guardar
        </Button>
        <Button
          type="button"
          variant="outline"
          className={BTN_GHOST_CLS}
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </Button>
        {isNew ? null : (
          // Confirmacion en DOS pasos (mismo patron que Equipo). Antes el
          // guardado era global, asi que un clic por error se deshacia con solo
          // no guardar; ahora eliminar PERSISTE de una, y sin red no habria
          // vuelta atras.
          <div className="ml-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-[11.5px] text-hint">¿Eliminar este paquete?</span>
                <Button
                  type="button"
                  variant="destructive"
                  className={cn(BTN_SM_CLS, 'rounded-[10px] font-bold')}
                  onClick={onDelete}
                  disabled={busy}
                  loading={deleting}
                >
                  {deleting ? null : <Trash2 />}
                  Sí, eliminar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                className={cn(BTN_GHOST_CLS, 'hover:border-destructive hover:text-destructive')}
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <Trash2 />
                Eliminar
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

/** Campo numerico con su unidad DENTRO (cm / kg) y cifras tabulares. */
function NumField({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className={FIELD_LABEL_CLS}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          className={cn(INPUT_CLS, 'pr-9 tabular-nums')}
        />
        <span className={SUFFIX_CLS} aria-hidden>
          {unit}
        </span>
      </div>
    </div>
  );
}

/* ============================== catalogo (body) =========================== */

/**
 * Cuerpo de la pagina de un catalogo: cabecera con el UNICO boton de agregar,
 * buscador, lista de filas y el panel. Cada confirmacion del panel manda la
 * lista COMPLETA (el endpoint es de reemplazo total) via `onSave`.
 */
export function PackageCatalog({
  variant,
  initial,
  onSave,
  standalone = false,
  blocked = null,
}: {
  variant: PackageCatalogVariant;
  /** Lista inicial ya convertida a borradores. */
  initial: PackageDraft[];
  /** PUT de reemplazo total con la lista completa (mas invalidaciones). */
  onSave: (rows: PackageDraft[]) => Promise<unknown>;
  /** true = pagina propia: cabecera de PAGINA en vez de tarjeta. */
  standalone?: boolean;
  /** Aviso que BLOQUEA el catalogo (ej. la lectura SSR fallo): sin lista ni panel. */
  blocked?: string | null;
}) {
  const cfg = VARIANTS[variant];
  const [rows, setRows] = useState<PackageDraft[]>(initial);
  const [query, setQuery] = useState('');
  const [session, setSession] = useState<PackageSession | null>(null);
  const seq = useRef(0);

  const persist = useMutation({
    mutationFn: (v: { next: PackageDraft[]; message: string }) => onSave(v.next),
    onSuccess: (_data, v) => {
      setRows(v.next);
      setSession(null);
      toast.success(v.message);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar los paquetes'),
  });
  // Distingue el guardado de la eliminacion para poner la hilera en el boton
  // correcto (los dos salen de la misma mutacion: un PUT de la lista entera).
  const pendingDelete = persist.isPending && persist.variables?.message === DELETED_MESSAGE;

  const open = (index: number | null, draft: PackageDraft) => {
    seq.current += 1;
    setSession({ id: `${index ?? 'new'}-${seq.current}`, index, draft });
  };

  const add = () =>
    open(null, {
      ...EMPTY_DRAFT,
      // El embalaje mas comun del catalogo de Skydropx ya viene elegido.
      packagingCode: variant === 'skydropx' ? DEFAULT_PACKAGING_CODE : '',
    });

  /** Confirmar el paquete = guardar SOLO ese (mutando la lista y mandandola). */
  const commit = (draft: PackageDraft) => {
    if (!session) return;
    const target = session.index ?? rows.length;
    const clean: PackageDraft = {
      ...draft,
      name: draft.name.trim(),
      content: draft.content.trim(),
      declaredValue: draft.declaredValue.trim(),
    };
    const merged =
      session.index === null ? [...rows, clean] : rows.map((r, i) => (i === target ? clean : r));
    // Predeterminada EXCLUSIVA: marcar una apaga las demas del catalogo.
    const next = clean.isDefault
      ? merged.map((r, i) => (i === target ? r : { ...r, isDefault: false }))
      : merged;
    persist.mutate({ next, message: cfg.savedMessage });
  };

  const remove = () => {
    if (!session || session.index === null) return;
    const i = session.index;
    persist.mutate({ next: rows.filter((_, j) => j !== i), message: DELETED_MESSAGE });
  };

  /** Eliminar DESDE LA FILA (menu de tres puntos), sin abrir el panel. */
  const removeAt = (index: number) =>
    persist.mutate({ next: rows.filter((_, j) => j !== index), message: DELETED_MESSAGE });

  /** Marcar predeterminada desde la fila: exclusiva, como al guardar. */
  const makeDefaultAt = (index: number) =>
    persist.mutate({
      next: rows.map((r, j) => ({ ...r, isDefault: j === index })),
      message: DEFAULT_MESSAGE,
    });

  /** Filtro de cliente por ALIAS o CONTENIDO (conserva el indice real). */
  const visible = useMemo(() => {
    const q = fold(query.trim());
    const all = rows.map((row, index) => ({ row, index }));
    if (!q) return all;
    return all.filter(({ row }) => fold(row.name).includes(q) || fold(row.content).includes(q));
  }, [rows, query]);

  // La cabecera de PAGINA ya trae su propio aire abajo; la de tarjeta no.
  const topGap = standalone ? '' : 'mt-4';

  const addButton = blocked ? null : (
    <Button className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)} onClick={add} disabled={persist.isPending}>
      <Plus />
      Agregar paquete
    </Button>
  );

  return (
    <div className={standalone ? undefined : CARD_CLS}>
      {/* En su propia pagina el titulo es de PAGINA (con el unico boton de
          agregar); embebida en Ajustes es una tarjeta mas — y el boton vive en
          la cabecera de la tarjeta, que sigue siendo UNO solo. */}
      {standalone ? (
        <PageHead title={cfg.title} description={cfg.description} action={addButton} />
      ) : (
        <CardHead
          icon={cfg.icon}
          title={cfg.title}
          description={cfg.description}
          action={addButton}
        />
      )}

      {blocked ? (
        <p className={cn(EMPTY_CLS, topGap)}>{blocked}</p>
      ) : (
        <>
          {rows.length > 0 ? (
            <div className={cn('relative', topGap)}>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-hint"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por alias o contenido…"
                aria-label="Buscar paquetes por alias o contenido"
                className={cn(INPUT_CLS, 'pl-9')}
              />
            </div>
          ) : null}

          {rows.length === 0 ? (
            <div className={cn(EMPTY_CLS, topGap, 'px-4 py-5')}>
              <p className="text-[12.5px] font-bold text-foreground">Sin paquetes aún</p>
              <p className="mx-auto mt-1 max-w-[46ch]">{cfg.emptyHint}</p>
            </div>
          ) : visible.length === 0 ? (
            <p className={cn(EMPTY_CLS, 'mt-3')}>Ningún paquete coincide con «{query.trim()}».</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {visible.map(({ row, index }) => (
                <PackageRow
                  key={index}
                  row={row}
                  onOpen={() => open(index, row)}
                  onDelete={() => removeAt(index)}
                  onMakeDefault={() => makeDefaultAt(index)}
                />
              ))}
            </ul>
          )}

          <PackageDrawer
            session={session}
            variant={variant}
            saving={persist.isPending && !pendingDelete}
            deleting={pendingDelete}
            onSave={commit}
            onDelete={remove}
            onClose={() => setSession(null)}
          />
        </>
      )}
    </div>
  );
}
