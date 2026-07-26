-- CreateEnum
CREATE TYPE "rentri_sync_log_origine" AS ENUM ('TRASMISSIONE', 'RICONCILIAZIONE');

-- AlterTable
ALTER TABLE "firs" ADD COLUMN     "rentri_last_reconciled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "rentri_sync_logs" ADD COLUMN     "origine" "rentri_sync_log_origine" NOT NULL DEFAULT 'TRASMISSIONE';

-- CreateIndex
CREATE INDEX "firs_tenant_id_rentri_sync_status_rentri_last_reconciled_at_idx" ON "firs"("tenant_id", "rentri_sync_status", "rentri_last_reconciled_at");
