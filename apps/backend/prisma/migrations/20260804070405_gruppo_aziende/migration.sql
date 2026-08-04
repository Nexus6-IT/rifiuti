-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aziende_limit" INTEGER,
ADD COLUMN     "parent_tenant_id" UUID;

-- CreateIndex
CREATE INDEX "tenants_parent_tenant_id_idx" ON "tenants"("parent_tenant_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parent_tenant_id_fkey" FOREIGN KEY ("parent_tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
