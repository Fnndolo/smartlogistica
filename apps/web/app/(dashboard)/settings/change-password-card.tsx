'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  SET_CARD_CLS,
  SET_ROW_CLS,
  SettingsRowBody,
} from './settings-ui';

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
    <div className={SET_CARD_CLS}>
      {/* Misma fila navegable (.set) que "Equipo" y "Conexiones": aqui no lleva
          a otra pagina, despliega el formulario debajo. */}
      <button
        type="button"
        onClick={() => (open ? reset() : setOpen(true))}
        aria-expanded={open}
        className={cn(SET_ROW_CLS, 'focus-visible:ring-offset-card')}
      >
        <SettingsRowBody
          icon={<KeyRound />}
          title="Clave de acceso"
          description="Cambia la clave con la que entras a la plataforma."
          expanded={open}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-[13px]">
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
                placeholder="Mínimo 8 caracteres"
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
              {mismatch ? (
                <p className="text-[11px] font-semibold text-destructive">Las claves no coinciden.</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
              onClick={() => change.mutate()}
              loading={change.isPending}
              disabled={!valid}
            >
              <Check />
              Guardar
            </Button>
            <Button variant="outline" className={cn(BTN_GHOST_CLS, BTN_SM_CLS)} onClick={reset}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
