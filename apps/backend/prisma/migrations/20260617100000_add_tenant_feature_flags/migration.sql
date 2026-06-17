-- Feature flag per tenant (override; se null si derivano dal piano).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "feature_flags" JSONB;
