'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Suscribe la pagina al stream SSE de cambios de pedidos. Cada mensaje de datos
 * dispara `onChange` (el caller hace un refetch debounced).
 *
 * Robustez:
 * - Watchdog: el server manda `ping` (evento tipado) cada 25s. Si NO llega
 *   ningun mensaje (ping o dato) en STALE_MS, asumimos conexion muerta, cerramos
 *   y reconectamos — asi el indicador "En vivo" no miente si el server cae sin
 *   cerrar el socket (caso que `onerror` no siempre detecta).
 * - Reconexion manual ademas de la nativa de EventSource.
 *
 * Devuelve si la conexion esta viva.
 */
const STALE_MS = 60_000;

export function useOrdersStream(onChange: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // Mismo origen que el web: /v1/orders/stream lo reenvia el proxy de Next al
    // API (asi el EventSource lleva la cookie de sesion sin lios de CORS).
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        // Sin ping/dato en STALE_MS -> conexion zombie: forzar reconexion.
        setConnected(false);
        es?.close();
        if (!stopped) connect();
      }, STALE_MS);
    };

    const connect = () => {
      es = new EventSource(`${apiUrl}/v1/orders/stream`, { withCredentials: true });

      es.onopen = () => {
        setConnected(true);
        armWatchdog();
      };
      // Eventos de datos (sin type) -> refrescar tabla.
      es.onmessage = () => {
        setConnected(true);
        armWatchdog();
        onChangeRef.current();
      };
      // Heartbeat tipado: NO refresca, solo confirma que el server vive.
      es.addEventListener('ping', () => {
        setConnected(true);
        armWatchdog();
      });
      es.onerror = () => {
        // EventSource reintenta solo; el watchdog cubre los stalls silenciosos.
        setConnected(false);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (watchdog) clearTimeout(watchdog);
      es?.close();
    };
  }, []);

  return connected;
}
