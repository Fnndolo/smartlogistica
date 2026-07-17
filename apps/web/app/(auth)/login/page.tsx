import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Iniciar sesion',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Bienvenido de vuelta</h1>
        <p className="text-sm text-muted-foreground">
          Inicia sesion para gestionar tus pedidos.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <LoginForm searchParamsPromise={searchParams} />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Aun no tienes cuenta?{' '}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Crear workspace
        </Link>
      </p>
    </div>
  );
}
