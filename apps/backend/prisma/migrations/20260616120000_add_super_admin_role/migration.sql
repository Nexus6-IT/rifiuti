-- Aggiunge il ruolo SUPER_ADMIN all'enum user_role (provisioning cross-tenant).
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
