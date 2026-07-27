-- CreateTable
CREATE TABLE "fir_allegati_rentri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fir_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rentri_allegato_id" INTEGER NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "caricato_da" UUID NOT NULL,
    "caricato_alle" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fir_allegati_rentri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fir_allegati_rentri_fir_id_idx" ON "fir_allegati_rentri"("fir_id");

-- CreateIndex
CREATE UNIQUE INDEX "fir_allegati_rentri_fir_id_rentri_allegato_id_key" ON "fir_allegati_rentri"("fir_id", "rentri_allegato_id");

-- AddForeignKey
ALTER TABLE "fir_allegati_rentri" ADD CONSTRAINT "fir_allegati_rentri_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fir_allegati_rentri" ADD CONSTRAINT "fir_allegati_rentri_caricato_da_fkey" FOREIGN KEY ("caricato_da") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
