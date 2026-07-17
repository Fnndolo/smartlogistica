import Link from 'next/link';
import { ArrowRight, Boxes, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-5 w-5 text-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">Aun no hay pedidos</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Cuando el backfill termine o un marketplace tenga pedidos en estado{' '}
        <span className="font-mono text-xs">ready-for-handling</span>, los veras aqui automaticamente.
      </p>
      <Button asChild className="mt-5" variant="outline">
        <Link href="/connections">
          <Boxes className="h-4 w-4" />
          Ver conexiones
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
