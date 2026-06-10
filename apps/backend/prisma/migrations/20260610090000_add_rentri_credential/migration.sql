-- Credenziale RENTRI per-tenant (Modello di Interoperabilità AgID).
-- Chiave privata cifrata a riposo (private_key_enc), mai in chiaro.
CREATE TABLE "rentri_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "certificate_pem" TEXT NOT NULL,
    "private_key_enc" TEXT NOT NULL,
    "algorithm" VARCHAR(10) NOT NULL DEFAULT 'RS256',
    "environment" VARCHAR(10) NOT NULL DEFAULT 'demo',
    CONSTRAINT "rentri_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rentri_credentials_tenant_id_key" ON "rentri_credentials"("tenant_id");
