'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker de la PWA (solo en produccion y con soporte del
 * navegador). En desarrollo se omite para no interferir con el HMR de Next.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // Cuando un SW NUEVO reemplaza a uno anterior (deploy que cambio /sw.js),
    // recargar UNA vez para usar los assets frescos y no quedar con chunks viejos.
    // Solo si YA habia un SW controlando (no en la primera visita, para no recargar
    // de gratis la primera vez que se registra).
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* la app funciona igual sin SW; no bloquear */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  return null;
}
