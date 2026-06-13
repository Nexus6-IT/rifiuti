-- Registro cronologico carico/scarico rifiuti (D.Lgs 152/2006) per giacenze e
-- monitoraggio deposito temporaneo.
CREATE TYPE "waste_movement_type" AS ENUM ('CARICO', 'SCARICO');

CREATE TABLE "waste_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "type" "waste_movement_type" NOT NULL,
    "cer_code" VARCHAR(6) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" VARCHAR(10) NOT NULL DEFAULT 'KG',
    "movement_date" TIMESTAMP(3) NOT NULL,
    "fir_id" UUID,
    "notes" TEXT,
    CONSTRAINT "waste_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "waste_movements_tenant_id_cer_code_idx" ON "waste_movements"("tenant_id", "cer_code");
CREATE INDEX "waste_movements_tenant_id_movement_date_idx" ON "waste_movements"("tenant_id", "movement_date");
