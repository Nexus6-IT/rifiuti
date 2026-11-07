-- Fase 4 pezzo 4c (Task 29): mappature dell'export contabile per azienda e indice degli scostamenti
-- (spec `2026-11-05-fase4-4-valorizzazione-export-design`, §7.3).
-- Segue `20261106100000_tenant_feature_tolte`.
--
-- Cosa fa: 1. lock_timeout; 2. la tabella `mappature_export_contabile` (chiave primaria, CHECK,
-- unico per azienda+adattatore+tipo+chiave, chiave esterna verso `tenants`); 3. l'indice parziale
-- sui legami scostati dopo la fattura (seguito del Task 21: la lista degli scostamenti leggeva
-- tutta `legami_movimento` di tutte le aziende con una scansione sequenziale); 4. RLS ENABLE +
-- FORCE con `isolamento_azienda` e `sola_lettura`.
-- Additiva: nessun DROP, nessuna colonna toccata. L'indice parziale si scrive solo in SQL (Prisma
-- non conosce la clausola WHERE); il predicato NON contiene `scostamento_gestito_il` (I3 del
-- Task 21): una presa d'atto non sposta righe dentro e fuori dall'indice.
SET LOCAL lock_timeout = '5s';

-- 2. Tabella ---------------------------------------------------------------------------------

CREATE TABLE "mappature_export_contabile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "adattatore" VARCHAR(30) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "chiave_wasteflow" VARCHAR(100) NOT NULL,
    "valore" VARCHAR(50) NOT NULL,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "modificato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mappature_export_contabile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mappature_export_contabile_tipo_ammesso" CHECK ("tipo" IN ('CODICE_IVA', 'CONTO_RICAVI', 'CLIENTE', 'PAGAMENTO', 'REGISTRO')),
    CONSTRAINT "mappature_export_contabile_valore_non_vuoto" CHECK (length(btrim("valore")) > 0),
    CONSTRAINT "mappature_export_contabile_chiave_non_vuota" CHECK (length(btrim("chiave_wasteflow")) > 0),
    CONSTRAINT "mappature_export_contabile_adattatore_non_vuoto" CHECK (length(btrim("adattatore")) > 0),
    CONSTRAINT "mappature_export_contabile_versione_positiva" CHECK ("versione" >= 1)
);

CREATE UNIQUE INDEX "mappature_export_contabile_unico_key"
  ON "mappature_export_contabile"("tenant_id", "adattatore", "tipo", "chiave_wasteflow");

ALTER TABLE "mappature_export_contabile" ADD CONSTRAINT "mappature_export_contabile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Indice parziale degli scostamenti (seguito del Task 21) -----------------------------------

CREATE INDEX "legami_movimento_scostati_idx"
  ON "legami_movimento"("tenant_id", "documento_id")
  WHERE "stato" = 'FATTURATO' AND "scostamento_dopo_fattura";

-- 4. RLS -------------------------------------------------------------------------------------

ALTER TABLE "mappature_export_contabile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mappature_export_contabile" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "mappature_export_contabile"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "mappature_export_contabile" FOR SELECT TO wasteflow_lettura USING (true);
