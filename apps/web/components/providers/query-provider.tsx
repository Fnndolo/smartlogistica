'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30 s: lo que importa llega por SSE (invalidaciones) y los polls
            // usan refetchInterval, que no depende de esto. Con 1 s, CADA
            // regreso a la pestaña recargaba ~25-30 consultas aunque nada
            // hubiera cambiado.
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
