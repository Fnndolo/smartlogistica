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

    // FORZAR la busqueda de actualizaciones del SW: los telefonos con la PWA
    // instalada pueden quedarse DIAS con un sw.js viejo (el navegador solo
    // chequea en navegaciones completas). Se chequea al registrar, cada vez
    // que la app vuelve a primer plano y cada 30 min.
    let reg: ServiceWorkerRegistration | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    const checkUpdate = () => void reg?.update().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkUpdate();
    };

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((r) => {
          reg = r;
          checkUpdate();
          document.addEventListener('visibilitychange', onVisible);
          interval = setInterval(checkUpdate, 30 * 60_000);
        })
        .catch(() => {
          /* la app funciona igual sin SW; no bloquear */
        });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      if (interval) clearInterval(interval);
    };
  }, []);

  return null;
}
