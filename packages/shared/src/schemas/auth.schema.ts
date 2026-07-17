import { z } from 'zod';

const slugRegex = /^[a-z][a-z0-9-]{2,30}[a-z0-9]$/;
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalido').max(254),
  password: z
    .string()
    .min(10, 'Minimo 10 caracteres')
    .max(128, 'Maximo 128 caracteres')
    .regex(passwordRegex, 'Debe incluir letras y numeros'),
  workspaceName: z.string().trim().min(2, 'Minimo 2 caracteres').max(60),
  workspaceSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, 'Solo minusculas, numeros y guiones (3-32 chars)'),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalido'),
  password: z.string().min(1, 'Requerido'),
});

export type LoginInput = z.infer<typeof loginSchema>;
