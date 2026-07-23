'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, Shield, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberSummary, WarehouseSummary } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type Role = MemberSummary['role'];

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Admin',
  OPERATOR: 'Operador',
};
const ROLE_HELP: Record<Role, string> = {
  OWNER: 'Ve y gestiona todo. Es el dueño del workspace (el primer usuario).',
  ADMIN: 'Ve y gestiona todo: sedes, conexiones, equipo y facturación.',
  OPERATOR: 'Solo ve las sedes que le asignes: detalle y conversación de sus pedidos.',
};

export function TeamList({ initial }: { initial?: MemberSummary[] }) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const canManage = me?.role === 'OWNER' || me?.role === 'ADMIN';
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

  if (isPending) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-12">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="mt-3 text-sm font-semibold">No se pudo cargar el equipo</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {error instanceof ApiError ? error.message : 'El servidor no respondio.'}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()} loading={isFetching}>
          <RefreshCw className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        {data.map((m) => (
          <MemberRow key={m.userId} member={m} warehouses={warehouses} canManage={canManage} />
        ))}
      </div>

      {canManage ? (
        adding ? (
          <AddMemberForm
            warehouses={warehouses}
            onClose={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ['members'] });
            }}
          />
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Agregar miembro
          </Button>
        )
      ) : null}
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
              member.role !== 'OPERATOR'
                ? 'border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                : 'border-border bg-muted text-foreground',
            )}
          >
            {member.role !== 'OPERATOR' ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{member.name ?? member.email}</p>
              <Badge
                variant={
                  member.role === 'OWNER' ? 'success' : member.role === 'ADMIN' ? 'secondary' : 'outline'
                }
              >
                {ROLE_LABEL[member.role]}
              </Badge>
              {member.isYou ? <Badge variant="secondary">Tú</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {member.role !== 'OPERATOR'
                ? ROLE_HELP[member.role]
                : names.length
                  ? `Sedes: ${names.join(', ')}`
                  : 'Sin sedes asignadas — no verá ningún pedido.'}
            </p>
          </div>
        </div>

        {canManage && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Editar
            </Button>
            {member.isYou ? null : confirming ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove.mutate()}
                  loading={remove.isPending}
                >
                  Confirmar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div className="space-y-1.5">
            <Label htmlFor={`member-name-${member.userId}`}>Nombre</Label>
            <Input
              id={`member-name-${member.userId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. David Castro"
            />
            <p className="text-[11px] text-muted-foreground">
              Con este nombre se le menciona (@{name.trim() || 'Nombre'}) y firma sus mensajes.
            </p>
          </div>
          {member.role !== 'OWNER' ? <RolePicker value={role} onChange={setRole} /> : null}
          {role === 'OPERATOR' ? (
            <SedePicker warehouses={warehouses} value={sedes} onChange={setSedes} />
          ) : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
              <Check className="h-3.5 w-3.5" />
              Guardar
            </Button>
            <Button
              variant="ghost"
              size="sm"
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
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agregar miembro</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
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
        <p className="text-[11px] text-muted-foreground">
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
            placeholder="Minimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Todavia no hay invitaciones por correo: creas la cuenta y le entregas la clave. Si el correo ya
        existe en la plataforma, se le suma el acceso a este workspace y su clave no cambia.
      </p>

      <RolePicker value={role} onChange={setRole} />
      {role === 'OPERATOR' ? (
        <SedePicker warehouses={warehouses} value={sedes} onChange={setSedes} />
      ) : null}

      <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!valid}>
        <Plus className="h-4 w-4" />
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
      <div className="grid gap-2 sm:grid-cols-2">
        {(['OPERATOR', 'ADMIN'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              value === r ? 'border-foreground/30 bg-muted/50' : 'border-border hover:border-foreground/20',
            )}
          >
            <div className="flex items-center gap-2">
              {r === 'ADMIN' ? <Shield className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              <span className="text-sm font-medium">{ROLE_LABEL[r]}</span>
              {value === r ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{ROLE_HELP[r]}</p>
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
      <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Aun no tienes sedes creadas.
      </p>
    );
  }
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-1.5">
      <Label>Sedes que puede ver</Label>
      <div className="flex flex-wrap gap-2">
        {warehouses.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => toggle(w.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              value.includes(w.id)
                ? 'border-foreground/30 bg-muted font-medium'
                : 'border-border text-muted-foreground hover:border-foreground/20',
            )}
          >
            {value.includes(w.id) ? <Check className="h-3 w-3" /> : null}
            {w.name}
          </button>
        ))}
      </div>
    </div>
  );
}
