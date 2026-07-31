import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// En cel las pills van un punto mas grandes (proporcional a la pantalla).
const badgeVariants = cva(
  'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[10px] py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.06em] transition-colors md:px-[9px] md:py-[2.5px] md:text-[10px]',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        // secondary = gris SUAVE con borde visible (mockup .p-mut), no casi-negro.
        secondary: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border text-muted-foreground/75',
        success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Punto de estado a la izquierda (color del texto actual). */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
