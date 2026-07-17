'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@smartlogistica/shared';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

export function LoginForm({ searchParamsPromise }: { searchParamsPromise: Promise<{ next?: string }> }) {
  const { next } = use(searchParamsPromise);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await api.post('/v1/auth/login', values);
      router.push(next ?? '/dashboard');
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'No se pudo iniciar sesion. Intenta de nuevo.';
      toast.error(message);
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Correo electronico</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          {...register('email')}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contrasena</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          {...register('password')}
        />
        <FieldError message={errors.password?.message} />
      </div>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        Iniciar sesion
      </Button>
    </form>
  );
}
