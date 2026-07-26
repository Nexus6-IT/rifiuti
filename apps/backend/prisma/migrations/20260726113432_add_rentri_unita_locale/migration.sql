-- R2 multi-sede: tabella RentriUnitaLocale (figlia del tenant) + migrazione
-- del dato esistente da RentriCredential.numIscrSito (campo deprecato, non
-- rimosso: vedi commento nello schema.prisma).
--
-- NOTA su drift preesistente: `prisma migrate dev --create-only` ha proposto
-- anche DROP/ALTER/RENAME su tabelle non correlate (tenants, autorizzazioni_
-- impianto, firs, notifications, waste_movements) — drift già osservato in
-- precedenti migrazioni di questo progetto (vedi CLAUDE.md). Rimosso da qui:
-- non è oggetto di questa modifica e non va applicato a scatola chiusa.

-- CreateTable
CREATE TABLE "rentri_unita_locali" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "num_iscr_sito" VARCHAR(30) NOT NULL,
    "denominazione" VARCHAR(255) NOT NULL,
    "principale" BOOLEAN NOT NULL DEFAULT false,
    "attiva" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rentri_unita_locali_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rentri_unita_locali_tenant_id_idx" ON "rentri_unita_locali"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "rentri_unita_locali_tenant_id_num_iscr_sito_key" ON "rentri_unita_locali"("tenant_id", "num_iscr_sito");

-- AddForeignKey
ALTER TABLE "rentri_unita_locali" ADD CONSTRAINT "rentri_unita_locali_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vincolo applicativo "esattamente una sede principale per tenant": indice
-- unico PARZIALE (solo sulle righe con principale = true). Non esprimibile
-- nello schema.prisma (Prisma non supporta indici parziali dichiarativi), va
-- mantenuto manualmente qui.
CREATE UNIQUE INDEX "rentri_unita_locali_una_principale_per_tenant"
    ON "rentri_unita_locali" ("tenant_id")
    WHERE "principale" = true;

-- Migrazione del dato esistente: il numIscrSito già impostato su
-- RentriCredential diventa la PRIMA unità locale del tenant, marcata
-- principale. Nessuna perdita: il campo sorgente resta intatto (deprecato,
-- non rimosso).
INSERT INTO "rentri_unita_locali" ("tenant_id", "num_iscr_sito", "denominazione", "principale", "attiva", "updated_at")
SELECT rc."tenant_id", rc."num_iscr_sito", 'Sede principale', true, true, now()
FROM "rentri_credentials" rc
WHERE rc."num_iscr_sito" IS NOT NULL;
