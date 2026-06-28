-- CreateEnum
CREATE TYPE "tipo_tratta" AS ENUM ('TERRESTRE', 'FERROVIARIA', 'MARITTIMA');

-- CreateTable
CREATE TABLE "fir_transporters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fir_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordine" INTEGER NOT NULL,
    "tipo_tratta" "tipo_tratta" NOT NULL,
    "trasportatore_id" UUID,
    "denominazione" VARCHAR(255) NOT NULL,
    "partita_iva" VARCHAR(11),
    "codice_fiscale" VARCHAR(16),
    "numero_iscrizione_albo" VARCHAR(50),
    "mezzo" VARCHAR(100),
    "data_presa_in_carico" TIMESTAMP(3),

    CONSTRAINT "fir_transporters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fir_transporters_fir_id_idx" ON "fir_transporters"("fir_id");

-- AddForeignKey
ALTER TABLE "fir_transporters" ADD CONSTRAINT "fir_transporters_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
