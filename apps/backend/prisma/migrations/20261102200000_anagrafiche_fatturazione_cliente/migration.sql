-- Fase 4 pezzo 1 (4.1a): le sei tabelle di fatturazione scelte dal cliente e dal contratto
-- (D6, D21, D23, D24, D25, D26 del piano `2026-11-01-fase4-1-contratto-cliente`): condizioni di
-- pagamento, conti correnti del gestore, spese accessorie (incasso e bollo), registri IVA
-- sezionali, testi di fatturazione, codifiche del contratto (categorie, tipi, motivi di annullo).
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i due tipi enum; 3. le sei tabelle con chiave
-- primaria, unici e CHECK (la rete di sicurezza: le regole vere stanno in `domain/clienti`);
-- 4. chiavi esterne verso `tenants` (a cascata); 5. indici; 6. RLS ENABLE + FORCE con le policy
-- `isolamento_azienda` e `sola_lettura`, stessa forma di `20261031110000_ditte_sedi_controparti`.
-- Il collegamento a clienti e contratti arriva con la migration successiva (4.1b).
--
-- E' additiva e sicura in deploy: solo `CREATE TYPE`, `CREATE TABLE` e `CREATE INDEX` su tabelle
-- nuove e vuote, nessun `ALTER` di tabelle esistenti, nessun indice parziale. Nessun GRANT qui:
-- `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges di `ops/db-ruoli.sh`.
-- La esegue `prisma migrate deploy` col ruolo proprietario (`wasteflow`).
--
-- Ripristino a mano (da fare DOPO il ripristino della migration `20261102200100_clienti_agenti_
-- contratti_cliente` (4.1b), se e' applicata: ripristinare prima quella):
--   DROP TABLE codifiche_contratto, testi_fatturazione, registri_iva, spese_accessorie,
--     conti_correnti, condizioni_pagamento;
--   DROP TYPE genere_codifica_contratto, tipo_spesa_accessoria;
--   DELETE FROM _prisma_migrations
--     WHERE migration_name = '20261102200000_anagrafiche_fatturazione_cliente';
-- Ripristino da migration fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.condizioni_pagamento')` sia NULL, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261102200000_anagrafiche_fatturazione_cliente`, poi
-- si rilancia il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi -------------------------------------------------------------------------------------

CREATE TYPE "tipo_spesa_accessoria" AS ENUM ('INCASSO', 'BOLLO');
CREATE TYPE "genere_codifica_contratto" AS ENUM ('CATEGORIA', 'TIPO', 'MOTIVO_ANNULLO');

-- 3. Tabelle ----------------------------------------------------------------------------------

CREATE TABLE "condizioni_pagamento" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "codice" VARCHAR(10) NOT NULL,
  "descrizione" VARCHAR(100) NOT NULL,
  "modalita" VARCHAR(4) NOT NULL,
  "giorni_rate" INTEGER[],
  "fine_mese" BOOLEAN NOT NULL DEFAULT false,
  "attiva" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "condizioni_pagamento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "condizioni_pagamento_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "condizioni_pagamento_modalita_ammessa" CHECK ("modalita" IN ('MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19', 'MP23')),
  CONSTRAINT "condizioni_pagamento_rate_ammesse" CHECK ("giorni_rate" IS NOT NULL AND cardinality("giorni_rate") BETWEEN 1 AND 8),
  CONSTRAINT "condizioni_pagamento_codice_non_vuoto" CHECK (btrim("codice") <> '')
);

CREATE TABLE "conti_correnti" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "codice" VARCHAR(10) NOT NULL,
  "descrizione" VARCHAR(100) NOT NULL,
  "banca" VARCHAR(80) NOT NULL,
  "iban" VARCHAR(34) NOT NULL,
  "bic" VARCHAR(11),
  "attivo" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conti_correnti_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conti_correnti_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "conti_correnti_codice_non_vuoto" CHECK (btrim("codice") <> '')
);

CREATE TABLE "spese_accessorie" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "tipo" "tipo_spesa_accessoria" NOT NULL,
  "codice" VARCHAR(10) NOT NULL,
  "descrizione" VARCHAR(100) NOT NULL,
  "importo" DECIMAL(10,2) NOT NULL,
  "attiva" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "spese_accessorie_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "spese_accessorie_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "spese_accessorie_importo_non_negativo" CHECK ("importo" >= 0),
  CONSTRAINT "spese_accessorie_codice_non_vuoto" CHECK (btrim("codice") <> '')
);

CREATE TABLE "registri_iva" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "codice" VARCHAR(2) NOT NULL,
  "descrizione" VARCHAR(60) NOT NULL,
  "ricevute_split" BOOLEAN NOT NULL DEFAULT false,
  "attivo" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "registri_iva_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registri_iva_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "registri_iva_codice_due_cifre" CHECK ("codice" ~ '^(0[1-9]|[1-9][0-9])$')
);

CREATE TABLE "testi_fatturazione" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "codice" VARCHAR(3) NOT NULL,
  "titolo" VARCHAR(60) NOT NULL,
  "righe" VARCHAR(60)[],
  "attivo" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "testi_fatturazione_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "testi_fatturazione_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "testi_fatturazione_righe_ammesse" CHECK ("righe" IS NOT NULL AND cardinality("righe") BETWEEN 1 AND 16),
  CONSTRAINT "testi_fatturazione_codice_alfanumerico" CHECK ("codice" ~ '^[A-Za-z0-9]{1,3}$')
);

CREATE TABLE "codifiche_contratto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "genere" "genere_codifica_contratto" NOT NULL,
  "codice" VARCHAR(3) NOT NULL,
  "descrizione" VARCHAR(60) NOT NULL,
  "attiva" BOOLEAN NOT NULL DEFAULT true,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "codifiche_contratto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "codifiche_contratto_versione_positiva" CHECK ("versione" >= 1),
  CONSTRAINT "codifiche_contratto_codice_alfanumerico" CHECK ("codice" ~ '^[A-Za-z0-9]{1,3}$')
);

-- 4. Chiavi esterne ---------------------------------------------------------------------------

ALTER TABLE "condizioni_pagamento" ADD CONSTRAINT "condizioni_pagamento_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conti_correnti" ADD CONSTRAINT "conti_correnti_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spese_accessorie" ADD CONSTRAINT "spese_accessorie_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "registri_iva" ADD CONSTRAINT "registri_iva_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testi_fatturazione" ADD CONSTRAINT "testi_fatturazione_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "codifiche_contratto" ADD CONSTRAINT "codifiche_contratto_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Indici -----------------------------------------------------------------------------------

CREATE UNIQUE INDEX "condizioni_pagamento_id_tenant_id_key" ON "condizioni_pagamento"("id", "tenant_id");
CREATE UNIQUE INDEX "condizioni_pagamento_tenant_id_codice_key" ON "condizioni_pagamento"("tenant_id", "codice");
CREATE INDEX "condizioni_pagamento_tenant_id_idx" ON "condizioni_pagamento"("tenant_id");
CREATE UNIQUE INDEX "conti_correnti_id_tenant_id_key" ON "conti_correnti"("id", "tenant_id");
CREATE UNIQUE INDEX "conti_correnti_tenant_id_codice_key" ON "conti_correnti"("tenant_id", "codice");
CREATE UNIQUE INDEX "conti_correnti_tenant_id_iban_key" ON "conti_correnti"("tenant_id", "iban");
CREATE INDEX "conti_correnti_tenant_id_idx" ON "conti_correnti"("tenant_id");
CREATE UNIQUE INDEX "spese_accessorie_id_tenant_id_key" ON "spese_accessorie"("id", "tenant_id");
CREATE UNIQUE INDEX "spese_accessorie_tenant_id_tipo_codice_key" ON "spese_accessorie"("tenant_id", "tipo", "codice");
CREATE INDEX "spese_accessorie_tenant_id_idx" ON "spese_accessorie"("tenant_id");
CREATE UNIQUE INDEX "registri_iva_id_tenant_id_key" ON "registri_iva"("id", "tenant_id");
CREATE UNIQUE INDEX "registri_iva_tenant_id_codice_key" ON "registri_iva"("tenant_id", "codice");
CREATE INDEX "registri_iva_tenant_id_idx" ON "registri_iva"("tenant_id");
CREATE UNIQUE INDEX "testi_fatturazione_id_tenant_id_key" ON "testi_fatturazione"("id", "tenant_id");
CREATE UNIQUE INDEX "testi_fatturazione_tenant_id_codice_key" ON "testi_fatturazione"("tenant_id", "codice");
CREATE INDEX "testi_fatturazione_tenant_id_idx" ON "testi_fatturazione"("tenant_id");
CREATE UNIQUE INDEX "codifiche_contratto_id_tenant_id_key" ON "codifiche_contratto"("id", "tenant_id");
CREATE UNIQUE INDEX "codifiche_contratto_tenant_id_genere_codice_key" ON "codifiche_contratto"("tenant_id", "genere", "codice");
CREATE INDEX "codifiche_contratto_tenant_id_idx" ON "codifiche_contratto"("tenant_id");

-- 6. RLS, in fondo ----------------------------------------------------------------------------

ALTER TABLE "condizioni_pagamento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "condizioni_pagamento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "condizioni_pagamento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "condizioni_pagamento" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "conti_correnti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conti_correnti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "conti_correnti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "conti_correnti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "spese_accessorie" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spese_accessorie" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "spese_accessorie"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "spese_accessorie" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "registri_iva" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registri_iva" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "registri_iva"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "registri_iva" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "testi_fatturazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "testi_fatturazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "testi_fatturazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "testi_fatturazione" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "codifiche_contratto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "codifiche_contratto" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "codifiche_contratto"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "codifiche_contratto" FOR SELECT TO wasteflow_lettura USING (true);
