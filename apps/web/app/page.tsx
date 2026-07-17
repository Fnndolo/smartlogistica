import Link from 'next/link';
import { ArrowRight, Boxes, ShieldCheck, Workflow, Zap } from 'lucide-react';

import { cn } from '@/lib/utils';

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <BackgroundDecoration />

      <nav className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="text-sm font-semibold tracking-tight">SmartLogistica</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Iniciar sesion
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Crear cuenta
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </nav>

      <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-6 pb-24 pt-20 text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Beta privada · Integraciones VTEX · Shopify · MercadoLibre
        </span>

        <h1 className="max-w-4xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
          Toda tu logistica de marketplaces.{' '}
          <span className="bg-gradient-to-br from-foreground to-foreground/40 bg-clip-text text-transparent">
            En un solo flujo.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          Centraliza pedidos de VTEX, Shopify, MercadoLibre y Exito. Automatiza guias, facturacion
          y despacho desde una plataforma unica, segura y aislada por cuenta.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="group inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-all hover:opacity-90"
          >
            Empezar gratis
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="#features"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-background/60 px-6 text-sm font-medium backdrop-blur transition-colors hover:bg-muted"
          >
            Ver como funciona
          </Link>
        </div>
      </section>

      <section id="features" className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            icon={<Boxes className="h-5 w-5" />}
            title="Centraliza marketplaces"
            description="Conecta VTEX, Shopify y mas en minutos. Cada pedido aterriza en una tabla unica."
          />
          <FeatureCard
            icon={<Zap className="h-5 w-5" />}
            title="Sincronizacion en tiempo real"
            description="Webhooks firmados que disparan tu workflow segundos despues de un pedido nuevo."
          />
          <FeatureCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Aislamiento por cuenta"
            description="Una base de datos dedicada por cliente. Credenciales cifradas con AES-256-GCM."
          />
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/60 bg-background/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Workflow className="h-3.5 w-3.5" />
            <span>SmartLogistica &copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              Privacidad
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terminos
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/80 bg-background/60 p-6 backdrop-blur',
        'transition-all duration-300 hover:border-foreground/20 hover:shadow-[0_0_0_1px_hsl(var(--border))]',
      )}
    >
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
        {icon}
      </div>
      <h3 className="mb-1.5 text-sm font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        aria-hidden
      >
        <path
          d="M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4m0 0l8-4m-8 4v10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BackgroundDecoration() {
  return (
    <>
      <div className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="absolute left-1/2 top-0 -z-10 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-500/10 to-transparent blur-3xl" />
    </>
  );
}
