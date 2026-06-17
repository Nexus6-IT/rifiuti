-- Quota aziende per admin + proprietario tenant (self-service tenant admin).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_limit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;
CREATE INDEX IF NOT EXISTS "tenants_owner_user_id_idx" ON "tenants" ("owner_user_id");
