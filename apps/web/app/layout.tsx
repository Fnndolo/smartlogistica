import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from '@/components/ui/sonner-toaster';
import { ServiceWorker } from '@/components/pwa/service-worker';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SmartLogistica',
    template: '%s · SmartLogistica',
  },
  description:
    'Plataforma de logistica para marketplaces. Centraliza pedidos de VTEX, Shopify, MercadoLibre y Exito en un solo flujo automatizado.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'SmartLogistica',
    description: 'Centraliza y automatiza la logistica de tus marketplaces.',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
  applicationName: 'SmartLogistica',
  appleWebApp: {
    capable: true,
    title: 'SmartLogistica',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Permite acercar (accesibilidad) pero evita el zoom accidental al hacer tap.
  maximumScale: 5,
  // Pinta bajo el notch/isla en pantalla completa (usar con safe-area-inset).
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F17' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
