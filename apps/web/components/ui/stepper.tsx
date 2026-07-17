import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface StepperProps {
  steps: string[];
  current: number;
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn('flex items-center gap-3', className)} aria-label="Progreso">
      {steps.map((label, index) => {
        const isCompleted = index < current;
        const isActive = index === current;
        const isLast = index === steps.length - 1;
        return (
          <li key={label} className="flex flex-1 items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors',
                  isCompleted && 'border-foreground bg-foreground text-background',
                  isActive && 'border-foreground bg-background text-foreground ring-4 ring-foreground/10',
                  !isCompleted && !isActive && 'border-border bg-background text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-sm font-medium transition-colors',
                  isActive || isCompleted ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {!isLast ? (
              <div
                className={cn(
                  'h-px flex-1 transition-colors',
                  isCompleted ? 'bg-foreground' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
