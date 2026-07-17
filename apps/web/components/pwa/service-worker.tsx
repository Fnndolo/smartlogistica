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
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* la app funciona igual sin SW; no bloquear */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
