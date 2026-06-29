-- Migrazione additiva: aggiunge i campi Stripe per il billing SaaS.
-- Aggiunta a Tenant: stripeCustomerId (cliente Stripe per-tenant),
-- stripeSubscriptionId (ID abbonamento attivo), subscriptionEnd (scadenza).
-- subscriptionEnd era già nel modello Prisma ma non nella DB baseline.
-- Forward-only, backward-safe (colonne nullable).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id"     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" VARCHAR(255);

-- Indice per lookup rapido da webhook Stripe (customerId → tenant)
CREATE INDEX IF NOT EXISTS "tenants_stripe_customer_id_idx" ON "tenants" ("stripe_customer_id");
