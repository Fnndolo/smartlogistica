-- Rol GESTOR: entra a TODAS las sedes y hace todo el trabajo de pedidos
-- (generales, tomar, chat, fotos, facturar en Alegra, generar guias), pero NO
-- gestiona equipo, NI conexiones, NI configuracion, NI transfiere pedidos
-- entre sedes (eso sigue siendo solo de OWNER/ADMIN).
-- BEFORE 'OPERATOR' solo para que el orden del enum siga la jerarquia.
ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'GESTOR' BEFORE 'OPERATOR';
