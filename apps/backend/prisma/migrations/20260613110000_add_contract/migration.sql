-- Modulo gestione contratti (MVP).
CREATE TYPE "counterparty_type" AS ENUM ('TRANSPORTER', 'DISPOSER', 'BROKER');
CREATE TYPE "contract_type" AS ENUM ('WASTE_DISPOSAL', 'WASTE_TRANSPORT', 'FULL_SERVICE', 'FRAMEWORK');
CREATE TYPE "pricing_model" AS ENUM ('FLAT_RATE', 'PAY_PER_LIFT', 'PAY_BY_WEIGHT', 'PAY_BY_VOLUME', 'ZONE_BASED', 'TIERED_VOLUME', 'MINIMUM_GUARANTEE', 'HYBRID');
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "contract_number" VARCHAR(50) NOT NULL,
    "producer_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "counterparty_type" "counterparty_type" NOT NULL,
    "contract_type" "contract_type" NOT NULL,
    "description" TEXT,
    "cer_codes" TEXT[],
    "pricing_model" "pricing_model" NOT NULL,
    "base_price" DECIMAL(10,2),
    "unit_of_measure" VARCHAR(10) NOT NULL DEFAULT 'kg',
    "pricing_config" JSONB,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "duration_months" INTEGER,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "renewal_notice_days" INTEGER NOT NULL DEFAULT 60,
    "payment_terms" VARCHAR(20) NOT NULL DEFAULT 'net_30',
    "billing_frequency" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contracts_tenant_id_contract_number_key" ON "contracts"("tenant_id", "contract_number");
CREATE INDEX "contracts_tenant_id_status_idx" ON "contracts"("tenant_id", "status");
CREATE INDEX "contracts_tenant_id_producer_id_idx" ON "contracts"("tenant_id", "producer_id");
