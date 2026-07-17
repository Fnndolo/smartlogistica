import { cn } from '@/lib/utils';

interface FieldErrorProps {
  message?: string;
  className?: string;
}

export function FieldError({ message, className }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p className={cn('mt-1.5 text-xs font-medium text-destructive', className)} role="alert">
      {message}
    </p>
  );
}
