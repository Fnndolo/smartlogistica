import type { Metadata } from 'next';
import Link from 'next/link';

import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Crear workspace',
};

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Crear tu workspace</h1>
        <p className="text-sm text-muted-foreground">
          Configuramos una base de datos dedicada para tu cuenta en segundos.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <SignupForm />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Ya tienes cuenta?{' '}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Iniciar sesion
        </Link>
      </p>
    </div>
  );
}
