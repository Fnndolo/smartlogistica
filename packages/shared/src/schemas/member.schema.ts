import { z } from 'zod';

/**
 * Equipo: los usuarios que tienen acceso al workspace (tenant).
 *
 * El rol vive en el control-plane (Membership) y el acceso por sede en la base
 * del tenant (WarehouseMember). OWNER (el propietario, el primero) y ADMIN ven
 * y hacen todo; un OPERATOR solo ve las sedes que se le asignen (detalle +
 * conversacion, sin facturar ni guias).
 */
export const tenantRoleSchema = z.enum(['OWNER', 'ADMIN', 'OPERATOR']);

export const memberSummarySchema = z.object({
  userId: z.string(),
  email: z.string(),
  /** Nombre visible (menciones y chat). null si aun no se configura. */
  name: z.string().nullable(),
  role: tenantRoleSchema,
  createdAt: z.string(),
  /** Sedes asignadas. Vacio en un OWNER: ve todas por definicion. */
  warehouseIds: z.array(z.string()),
  /** El propio usuario que consulta (para no dejarle quitarse el acceso). */
  isYou: z.boolean(),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

/**
 * Alta de un miembro. No hay invitacion por correo todavia: el OWNER crea la
 * cuenta con una clave temporal y se la entrega. Si el correo ya existe en la
 * plataforma, se le suma el acceso a este workspace sin tocar su clave.
 */
export const createMemberSchema = z.object({
  /** Nombre visible: con el se menciona (@David Castro) y firma sus mensajes. */
  name: z.string().trim().min(2, 'Minimo 2 caracteres').max(80),
  email: z.string().trim().toLowerCase().email('Correo invalido').max(200),
  password: z.string().min(8, 'Minimo 8 caracteres').max(200),
  role: tenantRoleSchema.default('OPERATOR'),
  warehouseIds: z.array(z.string()).max(100).default([]),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  name: z.string().trim().min(2, 'Minimo 2 caracteres').max(80).optional(),
  role: tenantRoleSchema.optional(),
  warehouseIds: z.array(z.string()).max(100).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** Cambio de clave del propio usuario (Ajustes > perfil). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Ingresa tu clave actual').max(200),
  newPassword: z.string().min(8, 'Minimo 8 caracteres').max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
