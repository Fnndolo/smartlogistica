'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  User,
  UserCog,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MemberSummary, WarehouseSummary } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { canManageMembers, ROLE_HELP, ROLE_LABEL } from '@/lib/rbac';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  FOCUS_RING,
  ICON_BTN_CLS,
  ICON_BTN_NEUTRAL_CLS,
  MEM_CLS,
  PageHead,
  Pill,
  tileCls,
  type PillTone,
} from '../settings-ui';

type Role = MemberSummary['role'];

/** Roles que se pueden asignar aqui (Propietario no: es el primer usuario). */
const ASSIGNABLE_ROLES = ['OPERATOR', 'GESTOR', 'ADMIN'] as const satisfies readonly Role[];

/** Icono por rol: admin = escudo, gestor = usuario con engranaje, operador = usuario. */
function RoleIcon({ role, className }: { role: Role; className?: string }) {
  if (role === 'OPERATOR') return <User className={className} />;
  if (role === 'GESTOR') return <UserCog className={className} />;
  return <Shield className={className} />;
}

/** Pastilla del rol: propietario/admin/gestor/operador, cada uno distinguible. */
function rolePillTone(role: Role): PillTone {
  if (role === 'OWNER') return 'ok';
  if (role === 'ADMIN') return 'violet';
  if (role === 'GESTOR') return 'cobalt';
  return 'muted';
}

/** Casilla de 40px del mockup (.tile): violeta mando, cobalto gestion, apagada operacion. */
function roleTileCls(role: Role): string {
  if (role === 'GESTOR') return tileCls('cobalt');
  if (role !== 'OPERATOR') return tileCls('violet');
  return tileCls('muted');
}

export function TeamList({ initial }: { initial?: MemberSummary[] }) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const canManage = canManageMembers(me?.role);
  const [adding, setAdding] = useState(false);

  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    initialData: initial,
    staleTime: 15_000,
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    staleTime: 60_000,
  });

  // El cuerpo cambia (cargando / error / lista) pero la cabecera de pagina
  // siempre esta: es la que lleva el boton "Agregar miembro".
  let body: React.ReactNode;
  if (isPending) {
    body = (
      <div className="flex items-center justify-center rounded-[14px] border border-border bg-card py-12">
        <Loader2 className="h-4 w-4 animate-spin text-hint motion-reduce:animate-none" />
      </div>
    );
  } else if (error) {
    body = (
      <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/5 px-4 py-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="mt-3 text-[13.5px] font-extrabold">No se pudo cargar el equipo</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {error instanceof ApiError ? error.message : 'El servidor no respondió.'}
        </p>
        <Button
          variant="outline"
          className={cn(BTN_GHOST_CLS, BTN_SM_CLS, 'mt-4')}
          onClick={() => void refetch()}
          loading={isFetching}
        >
          <RefreshCw />
          Reintentar
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-2.5">
        {data.map((m) => (
          <MemberRow key={m.userId} member={m} warehouses={warehouses} canManage={canManage} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Cabecera de pagina (.phead): titulo, bajada y accion a la derecha. */}
      <PageHead
        title="Equipo"
        description="Quién tiene acceso a este workspace y qué sedes ve cada quien."
        action={
          canManage && !adding ? (
            // Las acciones de cabecera del mockup son la variante compacta.
            <Button className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)} onClick={() => setAdding(true)}>
              <Plus />
              Agregar miembro
            </Button>
          ) : null
        }
      />

      <div className="space-y-2.5">
        {canManage && adding ? (
          <AddMemberForm
            warehouses={warehouses}
            onClose={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ['members'] });
            }}
          />
        ) : null}

        {body}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  warehouses,
  canManage,
}: {
  member: MemberSummary;
  warehouses: WarehouseSummary[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name ?? '');
  const [role, setRole] = useState<Role>(member.role);
  const [sedes, setSedes] = useState<string[]>(member.warehouseIds);

  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });

  const save = useMutation({
    mutationFn: () =>
      api.patch<MemberSummary>(`/v1/members/${member.userId}`, {
        ...(name.trim().length >= 2 ? { name: name.trim() } : {}),
        role,
        warehouseIds: role === 'OPERATOR' ? sedes : [],
      }),
    onSuccess: () => {
      toast.success('Miembro actualizado');
      setEditing(false);
      refresh();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/members/${member.userId}`),
    onSuccess: () => {
      toast.success('Miembro retirado del equipo');
      refresh();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo retirar'),
  });

  const [confirming, setConfirming] = useState(false);
  const names = warehouses.filter((w) => member.warehouseIds.includes(w.id)).map((w) => w.name);

  return (
    <div
      className={cn(
        MEM_CLS,
        'transition-[border-color,box-shadow] [transition-duration:140ms]',
        // En edicion la ficha se acentua (mockup: borde cobalto + anillo de 1px).
        editing && 'border-accent ring-1 ring-accent',
      )}
    >
      <div className="flex items-start gap-[13px]">
        <span className={roleTileCls(member.role)}>
          <RoleIcon role={member.role} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="min-w-0 truncate text-[13.5px] font-extrabold">
              {member.name ?? member.email}
            </b>
            <Pill tone={rolePillTone(member.role)}>{ROLE_LABEL[member.role]}</Pill>
            {member.isYou ? <Pill tone="muted">Tú</Pill> : null}
          </div>

          <p className="mt-0.5 truncate text-[12px] text-hint" title={member.email}>
            {member.email}
          </p>

          {member.role !== 'OPERATOR' ? (
            <p className="mt-[5px] max-w-[70ch] text-[12px] text-muted-foreground">
              {ROLE_HELP[member.role]}
            </p>
          ) : names.length ? (
            <div className="mt-[7px] flex flex-wrap gap-[5px]">
              {names.map((n) => (
                <span
                  key={n}
                  className="rounded-[7px] border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                >
                  {n}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-[5px] max-w-[70ch] text-[12px] font-semibold text-amber-600 dark:text-amber-400">
              Sin sedes asignadas — no verá ningún pedido.
            </p>
          )}
        </div>

        {canManage && !editing ? (
          <div className="flex shrink-0 flex-wrap items-center gap-[7px]">
            <Button
              variant="outline"
              className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              onClick={() => setEditing(true)}
            >
              Editar
            </Button>
            {member.isYou ? null : confirming ? (
              <>
                <Button
                  variant="destructive"
                  className={cn(BTN_SM_CLS, 'h-auto font-bold')}
                  onClick={() => remove.mutate()}
                  loading={remove.isPending}
                >
                  Confirmar
                </Button>
                <Button
                  variant="outline"
                  className={ICON_BTN_NEUTRAL_CLS}
                  onClick={() => setConfirming(false)}
                  aria-label="Cancelar"
                >
                  <X />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className={ICON_BTN_CLS}
                onClick={() => setConfirming(true)}
                aria-label={`Retirar a ${member.name ?? member.email}`}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-[13px] space-y-4 border-t border-border pt-[13px]">
          <div className="space-y-1.5">
            <Label htmlFor={`member-name-${member.userId}`}>Nombre</Label>
            <Input
              id={`member-name-${member.userId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. David Castro"
            />
            <p className="text-[11px] text-hint">
              Con este nombre se le menciona (@{name.trim() || 'Nombre'}) y firma sus mensajes.
            </p>
          </div>
          {member.role !== 'OWNER' ? <RolePicker value={role} onChange={setRole} /> : null}
          {role === 'OPERATOR' ? (
            <SedePicker warehouses={warehouses} value={sedes} onChange={setSedes} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
              onClick={() => save.mutate()}
              loading={save.isPending}
            >
              <Check />
              Guardar
            </Button>
            <Button
              variant="outline"
              className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              onClick={() => {
                setEditing(false);
                setName(member.name ?? '');
                setRole(member.role);
                setSedes(member.warehouseIds);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddMemberForm({
  warehouses,
  onClose,
  onDone,
}: {
  warehouses: WarehouseSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('OPERATOR');
  const [sedes, setSedes] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api.post<MemberSummary>('/v1/members', {
        name: name.trim(),
        email,
        password,
        role,
        warehouseIds: role === 'OPERATOR' ? sedes : [],
      }),
    onSuccess: () => {
      toast.success('Miembro agregado');
      onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo agregar'),
  });

  const valid = name.trim().length >= 2 && /.+@.+\..+/.test(email) && password.length >= 8;

  return (
    <div className={cn(CARD_CLS, 'space-y-4 border-accent/40 shadow-[var(--shadow-card)]')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-[10px]">
          <span className={tileCls('cobalt')}>
            <Plus />
          </span>
          <h3 className="truncate text-[13.5px] font-extrabold">Agregar miembro</h3>
        </div>
        <Button
          variant="outline"
          className={ICON_BTN_NEUTRAL_CLS}
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="member-name">Nombre</Label>
        <Input
          id="member-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. David Castro"
          autoComplete="off"
        />
        <p className="text-[11px] text-hint">
          Con este nombre se le menciona en el chat (@{name.trim() || 'Nombre'}) y firma sus
          mensajes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="member-email">Correo</Label>
          <Input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="member-password">Clave temporal</Label>
          <Input
            id="member-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className="text-[11px] text-hint">
        Todavía no hay invitaciones por correo: creas la cuenta y le entregas la clave. Si el correo ya
        existe en la plataforma, se le suma el acceso a este workspace y su clave no cambia.
      </p>

      <RolePicker value={role} onChange={setRole} />
      {role === 'OPERATOR' ? (
        <SedePicker warehouses={warehouses} value={sedes} onChange={setSedes} />
      ) : null}

      <Button
        className={BTN_PRIMARY_CLS}
        onClick={() => create.mutate()}
        loading={create.isPending}
        disabled={!valid}
      >
        <Plus />
        Agregar al equipo
      </Button>
    </div>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Rol</Label>
      {/* Propietario no se asigna aqui: es el primer usuario del workspace. */}
      {/* Tres columnas desde 761px, como .rolecards del mockup. */}
      <div className="grid gap-[9px] min-[761px]:grid-cols-3">
        {ASSIGNABLE_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={value === r}
            onClick={() => onChange(r)}
            className={cn(
              'rounded-[11px] border px-3 py-[11px] text-left transition-[border-color,background-color,box-shadow] [transition-duration:140ms]',
              FOCUS_RING,
              value === r
                ? 'border-accent bg-wash ring-1 ring-accent'
                : 'border-input bg-card hover:border-accent',
            )}
          >
            <span
              className={cn(
                'flex items-center gap-[7px] text-[12.5px] font-extrabold',
                value === r && 'text-accent-ink',
              )}
            >
              <RoleIcon role={r} className="h-3.5 w-3.5 shrink-0" />
              {ROLE_LABEL[r]}
              {value === r ? <Check className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}
            </span>
            <p className="mt-[5px] text-[11px] leading-[1.4] text-hint">{ROLE_HELP[r]}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SedePicker({
  warehouses,
  value,
  onChange,
}: {
  warehouses: WarehouseSummary[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (warehouses.length === 0) {
    return (
      <p className="rounded-[11px] border border-dashed border-border bg-surface px-3 py-3 text-[12px] text-muted-foreground">
        Aún no tienes sedes creadas.
      </p>
    );
  }
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-1.5">
      <Label>Sedes que puede ver</Label>
      <div className="flex flex-wrap gap-[5px]">
        {warehouses.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={value.includes(w.id)}
            onClick={() => toggle(w.id)}
            className={cn(
              'inline-flex min-h-[30px] items-center gap-1.5 rounded-[7px] border px-2.5 py-0.5 text-[11px] font-semibold transition-colors [transition-duration:140ms]',
              FOCUS_RING,
              value.includes(w.id)
                ? 'border-accent bg-wash text-accent-ink ring-1 ring-accent'
                : 'border-border bg-surface text-muted-foreground hover:border-accent hover:text-accent-ink',
            )}
          >
            {value.includes(w.id) ? <Check className="h-3 w-3 shrink-0" /> : null}
            {w.name}
          </button>
        ))}
      </div>
    </div>
  );
}
