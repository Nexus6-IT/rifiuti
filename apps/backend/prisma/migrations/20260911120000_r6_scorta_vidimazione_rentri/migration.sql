-- R6: scorta di numeri FIR pre-vidimati dall'ente RENTRI, letta a lotti da
-- un job periodico e consumata atomicamente all'emissione.
-- Vedi docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md.
--
-- Additiva: nessun DROP, nessuna colonna NOT NULL senza default su una
-- tabella già popolata (regola di progetto: migrazioni forward-only).

-- AlterTable: blocco predefinito + soglia di scorta, per unità locale.
ALTER TABLE "rentri_unita_locali"
    ADD COLUMN "codice_blocco_predefinito" VARCHAR(50),
    ADD COLUMN "dimensione_scorta_desiderata" INTEGER;

-- CreateEnum
CREATE TYPE "RentriNumeroVidimatoStato" AS ENUM ('DISPONIBILE', 'USATO', 'ANNULLATO');

-- CreateTable
CREATE TABLE "rentri_numeri_vidimati" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "num_iscr_sito" VARCHAR(30) NOT NULL,
    "codice_blocco" VARCHAR(50) NOT NULL,
    "progressivo" INTEGER NOT NULL,
    "numero_fir" VARCHAR(100) NOT NULL,
    "qr_code_bytes" TEXT NOT NULL,
    "stato" "RentriNumeroVidimatoStato" NOT NULL DEFAULT 'DISPONIBILE',
    "fir_id" UUID,
    "data_vidimazione" TIMESTAMP(3) NOT NULL,
    "data_consumo" TIMESTAMP(3),

    CONSTRAINT "rentri_numeri_vidimati_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rentri_numeri_vidimati_tenant_id_codice_blocco_progressivo_key"
    ON "rentri_numeri_vidimati"("tenant_id", "codice_blocco", "progressivo");

-- CreateIndex: guida sia il conteggio disponibili sia il consumo atomico
-- (WHERE tenant_id = ... AND stato = 'DISPONIBILE' [AND num_iscr_sito = ...]).
CREATE INDEX "rentri_numeri_vidimati_tenant_id_num_iscr_sito_stato_idx"
    ON "rentri_numeri_vidimati"("tenant_id", "num_iscr_sito", "stato");

-- AddForeignKey
ALTER TABLE "rentri_numeri_vidimati" ADD CONSTRAINT "rentri_numeri_vidimati_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
