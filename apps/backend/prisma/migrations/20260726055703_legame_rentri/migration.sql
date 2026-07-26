-- CreateEnum
CREATE TYPE "rentri_modalita_legame" AS ENUM ('AUTOMATICA', 'IBRIDA', 'MANUALE');

-- CreateEnum
CREATE TYPE "rentri_origine_legame" AS ENUM ('TRASMESSO_DA_NOI', 'ACQUISITO_DA_TERZI', 'AGGANCIO_MANUALE');

-- CreateEnum
CREATE TYPE "rentri_sync_log_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE');

-- AlterTable
ALTER TABLE "firs" ADD COLUMN     "rentri_numero_fir" VARCHAR(50),
ADD COLUMN     "rentri_origine_legame" "rentri_origine_legame",
ADD COLUMN     "rentri_transazione_id" VARCHAR(100);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "rentri_modalita_legame" "rentri_modalita_legame" NOT NULL DEFAULT 'MANUALE';

-- CreateTable
CREATE TABLE "rentri_sync_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fir_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "rentri_sync_log_status" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "request_payload" TEXT NOT NULL,
    "response_payload" TEXT,
    "error_message" TEXT,
    "error_code" VARCHAR(100),
    "protocol_number" VARCHAR(100),
    "synced_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "rentri_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rentri_sync_logs_tenant_id_idx" ON "rentri_sync_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "rentri_sync_logs_fir_id_idx" ON "rentri_sync_logs"("fir_id");

-- CreateIndex
CREATE INDEX "rentri_sync_logs_status_idx" ON "rentri_sync_logs"("status");

-- CreateIndex
CREATE INDEX "rentri_sync_logs_created_at_idx" ON "rentri_sync_logs"("created_at");

-- CreateIndex
CREATE INDEX "firs_tenant_id_rentri_numero_fir_idx" ON "firs"("tenant_id", "rentri_numero_fir");

-- AddForeignKey
ALTER TABLE "rentri_sync_logs" ADD CONSTRAINT "rentri_sync_logs_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
