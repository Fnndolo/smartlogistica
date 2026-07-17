'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

export function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');

  const reset = () => {
    setCurrent('');
    setNew('');
    setRepeat('');
    setOpen(false);
  };

  const change = useMutation({
    mutationFn: () => api.post('/v1/members/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Clave actualizada');
      reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar la clave'),
  });

  const mismatch = repeat.length > 0 && newPassword !== repeat;
  const valid = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === repeat;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <KeyRound className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Clave de acceso</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cambia la clave con la que entras a la plataforma.
            </p>
          </div>
        </div>
        {open ? null : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Cambiar
          </Button>
        )}
      </div>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pass">Clave actual</Label>
            <Input
              id="cur-pass"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pass">Clave nueva</Label>
              <Input
                id="new-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNew(e.target.value)}
                placeholder="Minimo 8 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-pass">Repetir clave nueva</Label>
              <Input
                id="rep-pass"
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch ? <p className="text-[11px] text-destructive">Las claves no coinciden.</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => change.mutate()} loading={change.isPending} disabled={!valid}>
              <Check className="h-3.5 w-3.5" />
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
