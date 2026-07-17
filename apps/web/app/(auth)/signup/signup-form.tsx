'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@smartlogistica/shared';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function SignupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', workspaceName: '', workspaceSlug: '' },
  });

  const workspaceName = watch('workspaceName');

  useEffect(() => {
    if (!slugTouched && workspaceName) {
      const next = slugify(workspaceName);
      if (next.length >= 3) {
        setValue('workspaceSlug', next, { shouldValidate: false });
      }
    }
  }, [workspaceName, slugTouched, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await api.post('/v1/auth/signup', values);
      toast.success('Workspace creado');
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'No se pudo crear la cuenta. Intenta de nuevo.';
      toast.error(message);
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="workspaceName">Nombre del workspace</Label>
        <Input
          id="workspaceName"
          autoComplete="organization"
          placeholder="Smart Gadgets"
          aria-invalid={Boolean(errors.workspaceName)}
          {...register('workspaceName')}
        />
        <FieldError message={errors.workspaceName?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="workspaceSlug">Identificador</Label>
        <div className="flex items-stretch overflow-hidden rounded-md border border-input">
          <span className="flex items-center bg-muted px-3 text-xs text-muted-foreground">
            smartlogistica.app/
          </span>
          <Input
            id="workspaceSlug"
            className="border-0 shadow-none focus-visible:ring-0"
            placeholder="acme"
            aria-invalid={Boolean(errors.workspaceSlug)}
            {...register('workspaceSlug', {
              onChange: () => setSlugTouched(true),
            })}
          />
        </div>
        <FieldError message={errors.workspaceSlug?.message} />
      </div>

      <hr className="border-border" />

      <div className="space-y-1.5">
        <Label htmlFor="email">Correo electronico</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
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
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          {...register('password')}
        />
        <FieldError message={errors.password?.message} />
        <p className="mt-1 text-xs text-muted-foreground">Minimo 10 caracteres, incluyendo letras y numeros.</p>
      </div>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        Crear workspace
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Al crear una cuenta aceptas nuestros{' '}
        <a href="/terms" className="underline-offset-4 hover:underline">
          terminos
        </a>{' '}
        y{' '}
        <a href="/privacy" className="underline-offset-4 hover:underline">
          politica de privacidad
        </a>
        .
      </p>
    </form>
  );
}
