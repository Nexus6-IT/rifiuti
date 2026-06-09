-- CreateEnum
CREATE TYPE "waste_operation_type" AS ENUM ('RECOVERY', 'DISPOSAL');

-- AlterTable
ALTER TABLE "firs" ADD COLUMN     "waste_operation_type" "waste_operation_type" NOT NULL DEFAULT 'DISPOSAL';

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '30 days';

-- CreateIndex
CREATE INDEX "firs_tenant_id_waste_operation_type_idx" ON "firs"("tenant_id", "waste_operation_type");
