-- Rol ADMIN (gestiona todo como el OWNER, pero el "Propietario" es solo el primero)
ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'ADMIN';

-- Nombre visible del usuario (para menciones @Nombre y autor de mensajes)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;
