-- Fase 2 pezzo 6 (F2-6): soglie del deposito temporaneo (art. 185-bis D.Lgs. 152/2006).
--
-- Aggiunge la tabella soglie_deposito_temporaneo: per azienda (registro_id NULL) o per registro,
-- il criterio scelto (tempo o quantita'), la soglia in giorni (facoltativa: NULL = solo i tre mesi
-- di legge), le soglie in kg (conversione indicata dall'azienda dei 30 m3, 10 m3 di pericolosi) e
-- il preavviso. Nessuna riga = valori predefiniti del codice, quindi nessun backfill.
--
-- Additiva: nessuna tabella esistente cambia, il codice vecchio ignora la nuova.
--
-- Ripristino (a mano): DROP TABLE soglie_deposito_temporaneo; DROP TYPE criterio_deposito_temporaneo;
-- e togliere la riga di questa migration da _prisma_migrations. Prima controllare
-- `SELECT tenant_id, count(*) FROM soglie_deposito_temporaneo GROUP BY 1`.
--
-- Rinomina (convivenza con F2-10): se nel rebase il master contiene gia' 20261031110000, questa
-- cartella va rinominata 20261031120000_soglie_deposito_temporaneo (non e' mai stata applicata in
-- produzione) e i riferimenti in ops/README.md aggiornati.

-- 1. Enum.
CREATE TYPE "criterio_deposito_temporaneo" AS ENUM ('NON_SCELTO', 'TEMPORALE', 'QUANTITATIVO');

-- 2. Tabella. I CHECK ripetono i range di validaSoglie (domain/waste-movement/deposito-temporaneo.ts).
CREATE TABLE "soglie_deposito_temporaneo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID,
    "criterio" "criterio_deposito_temporaneo" NOT NULL,
    "giorni_max" SMALLINT,
    "kg_max_totale" DECIMAL(12,2) NOT NULL,
    "kg_max_pericolosi" DECIMAL(12,2) NOT NULL,
    "preavviso_giorni" SMALLINT NOT NULL,
    "preavviso_percentuale" SMALLINT NOT NULL,
    "note" VARCHAR(500),
    "impostato_da" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soglie_deposito_temporaneo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "soglie_deposito_temporaneo_giorni_max_check"
      CHECK ("giorni_max" IS NULL OR "giorni_max" BETWEEN 1 AND 92),
    CONSTRAINT "soglie_deposito_temporaneo_kg_totale_check"
      CHECK ("kg_max_totale" > 0 AND "kg_max_totale" <= 10000000),
    CONSTRAINT "soglie_deposito_temporaneo_kg_pericolosi_check"
      CHECK ("kg_max_pericolosi" > 0 AND "kg_max_pericolosi" <= "kg_max_totale"),
    CONSTRAINT "soglie_deposito_temporaneo_preavviso_giorni_check"
      CHECK ("preavviso_giorni" BETWEEN 0 AND 88
             AND ("giorni_max" IS NULL OR "preavviso_giorni" < "giorni_max")),
    CONSTRAINT "soglie_deposito_temporaneo_preavviso_percentuale_check"
      CHECK ("preavviso_percentuale" BETWEEN 0 AND 99)
);

-- 3. Indici e chiavi esterne (nomi uguali a quelli che genera Prisma).
CREATE UNIQUE INDEX "soglie_deposito_temporaneo_id_tenant_id_key"
  ON "soglie_deposito_temporaneo"("id", "tenant_id");
CREATE UNIQUE INDEX "soglie_deposito_temporaneo_tenant_id_registro_id_key"
  ON "soglie_deposito_temporaneo"("tenant_id", "registro_id");
CREATE INDEX "soglie_deposito_temporaneo_tenant_id_idx" ON "soglie_deposito_temporaneo"("tenant_id");

ALTER TABLE "soglie_deposito_temporaneo" ADD CONSTRAINT "soglie_deposito_temporaneo_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- MATCH SIMPLE: con registro_id NULL (soglie dell'azienda) la chiave composta non e' controllata.
ALTER TABLE "soglie_deposito_temporaneo" ADD CONSTRAINT "soglie_deposito_temporaneo_registro_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Una sola riga "azienda" per tenant: l'unico (tenant_id, registro_id) non basta, i NULL non collidono.
-- Solo SQL: Prisma non rappresenta gli indici parziali.
CREATE UNIQUE INDEX "soglie_deposito_temporaneo_una_per_azienda"
  ON "soglie_deposito_temporaneo"("tenant_id") WHERE "registro_id" IS NULL;

-- 4. RLS, in fondo (stessa forma di 20261028100000_giacenze_iniziali).
ALTER TABLE "soglie_deposito_temporaneo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "soglie_deposito_temporaneo" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "soglie_deposito_temporaneo"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "soglie_deposito_temporaneo" FOR SELECT TO wasteflow_lettura USING (true);
