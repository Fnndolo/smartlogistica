import type { MetadataRoute } from 'next';

import { APP_NAME, IS_SANDBOX } from '@/lib/sandbox';

/**
 * Manifest de la PWA (se sirve en /manifest.webmanifest). Hace la plataforma
 * instalable en el celular: icono propio, arranque a pantalla completa
 * (standalone, sin barra del navegador) y splash con el fondo de marca.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Instalada en el celular, la de pruebas se distingue por el nombre.
    name: APP_NAME,
    short_name: IS_SANDBOX ? 'SL Pruebas' : 'SmartLog',
    description: 'Centraliza y automatiza la logistica de tus marketplaces.',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0B0F17',
    lang: 'es',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
