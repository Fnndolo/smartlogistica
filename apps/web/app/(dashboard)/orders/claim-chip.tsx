'use client';

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/** "Ana Pérez" -> "AP"; correos -> primeras 2 letras del usuario. */
export function initialsOf(nameOrEmail: string): string {
  const clean = (nameOrEmail.split('@')[0] ?? nameOrEmail).trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

/** Matiz ESTABLE por persona (hash del userId -> 0..359). Siempre el mismo. */
export function personHue(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Distintivo de "tomar pedido": ficha redonda con las iniciales de quien lo
 * tomo, en su color personal. La MIA es solida en acento con halo (lo tuyo se
 * detecta de un vistazo). Va al INICIO de la fila.
 */
export function ClaimChip({
  userId,
  name,
  mine,
  className,
}: {
  userId: string;
  name: string;
  mine: boolean;
  className?: string;
}) {
  const tip = mine ? 'Lo tienes tú' : `Tomado por ${name}`;
  if (mine) {
    return (
      <span
        title={tip}
        aria-label={tip}
        className={cn(
          'ring-halo inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-[8.5px] font-bold uppercase tracking-wider text-accent-foreground',
          className,
        )}
      >
        {initialsOf(name)}
      </span>
    );
  }
  const style = { '--pc': String(personHue(userId)) } as CSSProperties;
  return (
    <span
      title={tip}
      aria-label={tip}
      style={style}
      className={cn(
        'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[8.5px] font-bold uppercase tracking-wider',
        'border-[hsl(var(--pc)_60%_50%/0.4)] bg-[hsl(var(--pc)_60%_50%/0.12)] text-[hsl(var(--pc)_65%_38%)] dark:text-[hsl(var(--pc)_75%_72%)]',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Hueco reservado cuando el pedido esta libre: los numeros de fila alinean. */
export function ClaimSlot() {
  return <span aria-hidden className="inline-block h-[22px] w-[22px] shrink-0" />;
}
