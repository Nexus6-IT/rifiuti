-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '30 days';

-- AlterTable
ALTER TABLE "rentri_credentials" ADD COLUMN     "credentials_id_firma_remota" VARCHAR(255);
