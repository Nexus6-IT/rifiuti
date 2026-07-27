-- AlterTable
ALTER TABLE "cer_codes" ADD COLUMN     "fonte" VARCHAR(20) NOT NULL DEFAULT 'locale',
ADD COLUMN     "presente_in_rentri" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rimosso_da_rentri_al" TIMESTAMP(3);
