-- Fase 4 pezzo 1 (4.1b): le cinque tabelle di agenti, clienti, contratti cliente, periodi di
-- fatturazione e allegati (D2, D3, D5, D8, D10, D12-D15, D22, D27-D29 del piano
-- `2026-11-01-fase4-1-contratto-cliente`). Seconda delle due migration di 4.1 (D30): dipende dalla
-- prima, `20261102200000_anagrafiche_fatturazione_cliente`, da cui prende le sei tabelle di
-- fatturazione come bersagli delle chiavi esterne composite.
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i due tipi enum (esigibilita' IVA, stato del
-- contratto); 3. le cinque tabelle con chiave primaria e CHECK (la rete di sicurezza: le regole
-- vere stanno in `domain/clienti` e `domain/contratti-cliente`); 4. indici e unici (i `*_id_
-- tenant_id_key` sono il bersaglio delle chiavi composite, quindi vengono prima); 5. chiavi
-- esterne: verso `tenants` `<tabella>_tenant_id_fkey` a cascata; composite `(id, tenant_id)`
-- `<tabella>_<riferimento>_fkey` sempre `NO ACTION` e mai `RESTRICT` (con `NO ACTION` il controllo
-- e' a fine statement, quindi la cancellazione a cascata di un tenant passa); periodi e allegati a
-- cascata sul contratto; 6. RLS ENABLE + FORCE con le policy `isolamento_azienda` e
-- `sola_lettura`, stessa forma di `20261031110000_ditte_sedi_controparti`.
--
-- E' additiva e sicura in deploy: solo `CREATE TYPE`, `CREATE TABLE` e `CREATE INDEX` su tabelle
-- nuove e vuote, nessun `ALTER` di tabelle esistenti (le chiavi esterne stanno sulle tabelle
-- nuove), nessun indice parziale. Nessun GRANT qui: `wasteflow_app` e `wasteflow_sistema` li
-- ricevono dai default privileges di `ops/db-ruoli.sh`. La esegue `prisma migrate deploy` col
-- ruolo proprietario (`wasteflow`).
--
-- Ripristino a mano (ripristinare questa PRIMA della `20261102200000_…`; vedi anche il paragrafo
-- "Clienti, agenti e contratti cliente" di `ops/README.md`):
--   DROP TABLE allegati_contratto_cliente, periodi_fatturazione_cliente, contratti_cliente,
--     clienti, agenti;
--   DROP TYPE stato_contratto_cliente, esigibilita_iva;
--   DELETE FROM _prisma_migrations
--     WHERE migration_name = '20261102200100_clienti_agenti_contratti_cliente';
-- Ripristino da migration fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.clienti')` sia NULL, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261102200100_clienti_agenti_contratti_cliente`, poi
-- si rilancia il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi ----------------------------------------------------------------------

CREATE TYPE "esigibilita_iva" AS ENUM ('IMMEDIATA', 'DIFFERITA', 'SCISSIONE');
CREATE TYPE "stato_contratto_cliente" AS ENUM ('BOZZA', 'ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO');

-- 3. Tabelle -------------------------------------------------------------------

CREATE TABLE "agenti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ditta_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "codice" VARCHAR(20),
    "note" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agenti_versione_positiva" CHECK ("versione" >= 1)
);

CREATE TABLE "clienti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ditta_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "codice" VARCHAR(20),
    "nome" VARCHAR(60),
    "cognome" VARCHAR(60),
    "codice_destinatario" VARCHAR(7),
    "pec_fatturazione" VARCHAR(255),
    "riferimento_amministrazione" VARCHAR(20),
    "iban" VARCHAR(34),
    "conto_corrente_id" UUID,
    "condizione_pagamento_id" UUID,
    "esigibilita_iva" "esigibilita_iva" NOT NULL DEFAULT 'IMMEDIATA',
    "registro_iva_id" UUID,
    "spese_incasso_id" UUID,
    "bollo_id" UUID,
    "agente_id" UUID,
    "ritenuta_percentuale" DECIMAL(5,2),
    "note" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clienti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clienti_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "clienti_ritenuta_ammessa" CHECK ("ritenuta_percentuale" IS NULL OR ("ritenuta_percentuale" > 0 AND "ritenuta_percentuale" <= 30))
);

CREATE TABLE "contratti_cliente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "numero" VARCHAR(50) NOT NULL,
    "descrizione" VARCHAR(255) NOT NULL,
    "stato" "stato_contratto_cliente" NOT NULL DEFAULT 'BOZZA',
    "data_inizio" DATE NOT NULL,
    "data_fine" DATE,
    "cliente_id" UUID NOT NULL,
    "cliente_fatturazione_id" UUID,
    "sede_id" UUID,
    "categoria_id" UUID,
    "tipo_id" UUID,
    "condizione_pagamento_id" UUID,
    "conto_corrente_id" UUID,
    "agente_id" UUID,
    "spese_incasso_id" UUID,
    "bollo_id" UUID,
    "registro_iva_id" UUID,
    "testo_fatturazione_id" UUID,
    "annotazioni" VARCHAR(45)[] DEFAULT ARRAY[]::VARCHAR(45)[],
    "esigibilita_iva" "esigibilita_iva" NOT NULL DEFAULT 'IMMEDIATA',
    "ritenuta_percentuale" DECIMAL(5,2),
    "rinnovo_automatico" BOOLEAN NOT NULL DEFAULT false,
    "codice_rinnovo" VARCHAR(1),
    "codice_destinatario" VARCHAR(7),
    "riferimento_amministrazione" VARCHAR(20),
    "soglia_dal" DATE,
    "soglia_importo" DECIMAL(12,2),
    "soglia_iva_esclusa" BOOLEAN NOT NULL DEFAULT false,
    "data_stipula" DATE,
    "commessa" VARCHAR(12),
    "validita_quantita" INTEGER,
    "validita_unita" VARCHAR(1),
    "motivo_annullo_id" UUID,
    "motivo_annullo" VARCHAR(255),
    "annullato_il" TIMESTAMP(3),
    "incremento_istat" BOOLEAN NOT NULL DEFAULT false,
    "escludi_dichiarazione_intento" BOOLEAN NOT NULL DEFAULT false,
    "codice_cig" VARCHAR(15),
    "codice_cup" VARCHAR(15),
    "id_documento_pa" VARCHAR(20),
    "contratto_principale_id" UUID,
    "eliminato_il" TIMESTAMP(3),
    "eliminato_da" UUID,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratti_cliente_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contratti_cliente_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "contratti_cliente_eliminazione_coerente" CHECK ("eliminato_da" IS NULL OR "eliminato_il" IS NOT NULL),
    CONSTRAINT "contratti_cliente_ritenuta_ammessa" CHECK ("ritenuta_percentuale" IS NULL OR ("ritenuta_percentuale" > 0 AND "ritenuta_percentuale" <= 30)),
    CONSTRAINT "contratti_cliente_annullo_coerente" CHECK ("stato" <> 'ANNULLATO' OR ("motivo_annullo" IS NOT NULL AND "annullato_il" IS NOT NULL)),
    CONSTRAINT "contratti_cliente_date_coerenti" CHECK ("data_fine" IS NULL OR "data_fine" >= "data_inizio"),
    CONSTRAINT "contratti_cliente_non_allegato_a_se" CHECK ("contratto_principale_id" IS NULL OR "contratto_principale_id" <> "id"),
    CONSTRAINT "contratti_cliente_soglia_coerente" CHECK (("soglia_importo" IS NULL OR "soglia_importo" > 0) AND ("soglia_dal" IS NULL OR "soglia_importo" IS NOT NULL)),
    CONSTRAINT "contratti_cliente_validita_coerente" CHECK (("validita_quantita" IS NULL) = ("validita_unita" IS NULL) AND ("validita_quantita" IS NULL OR "validita_quantita" BETWEEN 1 AND 999) AND ("validita_unita" IS NULL OR "validita_unita" IN ('A', 'S', 'M', 'G'))),
    CONSTRAINT "contratti_cliente_codice_rinnovo_ammesso" CHECK ("codice_rinnovo" IS NULL OR "codice_rinnovo" IN ('S', 'N')),
    CONSTRAINT "contratti_cliente_annotazioni_ammesse" CHECK ("annotazioni" IS NOT NULL AND cardinality("annotazioni") <= 3)
);

CREATE TABLE "periodi_fatturazione_cliente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contratto_id" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "giorno_inizio" INTEGER NOT NULL,
    "mese_inizio" INTEGER NOT NULL,
    "giorno_fine" INTEGER NOT NULL,
    "mese_fine" INTEGER NOT NULL,

    CONSTRAINT "periodi_fatturazione_cliente_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "periodi_fatturazione_cliente_valori" CHECK ("ordine" BETWEEN 1 AND 12 AND "giorno_inizio" BETWEEN 1 AND 31 AND "giorno_fine" BETWEEN 1 AND 31 AND "mese_inizio" BETWEEN 1 AND 12 AND "mese_fine" BETWEEN 1 AND 12)
);

CREATE TABLE "allegati_contratto_cliente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contratto_id" UUID NOT NULL,
    "posizione" INTEGER NOT NULL,
    "nome_file" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "dimensione_byte" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "contenuto" BYTEA NOT NULL,
    "caricato_da" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegati_contratto_cliente_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allegati_contratto_cliente_valori" CHECK ("posizione" IN (1, 2) AND "mime_type" = 'application/pdf' AND "dimensione_byte" BETWEEN 1 AND 4194304)
);

-- 4. Indici e unici (prima delle chiavi esterne composite, che li usano) --------

CREATE INDEX "agenti_tenant_id_idx" ON "agenti"("tenant_id");
CREATE INDEX "agenti_sede_id_idx" ON "agenti"("sede_id");
CREATE UNIQUE INDEX "agenti_id_tenant_id_key" ON "agenti"("id", "tenant_id");
CREATE UNIQUE INDEX "agenti_tenant_id_ditta_id_key" ON "agenti"("tenant_id", "ditta_id");
CREATE UNIQUE INDEX "agenti_tenant_id_codice_key" ON "agenti"("tenant_id", "codice");
CREATE INDEX "clienti_tenant_id_idx" ON "clienti"("tenant_id");
CREATE INDEX "clienti_sede_id_idx" ON "clienti"("sede_id");
CREATE UNIQUE INDEX "clienti_id_tenant_id_key" ON "clienti"("id", "tenant_id");
CREATE UNIQUE INDEX "clienti_tenant_id_ditta_id_key" ON "clienti"("tenant_id", "ditta_id");
CREATE UNIQUE INDEX "clienti_tenant_id_codice_key" ON "clienti"("tenant_id", "codice");
CREATE INDEX "contratti_cliente_tenant_id_stato_idx" ON "contratti_cliente"("tenant_id", "stato");
CREATE INDEX "contratti_cliente_tenant_id_cliente_id_idx" ON "contratti_cliente"("tenant_id", "cliente_id");
CREATE INDEX "contratti_cliente_tenant_id_cliente_fatturazione_id_idx" ON "contratti_cliente"("tenant_id", "cliente_fatturazione_id");
CREATE INDEX "contratti_cliente_tenant_id_categoria_id_idx" ON "contratti_cliente"("tenant_id", "categoria_id");
CREATE INDEX "contratti_cliente_contratto_principale_id_idx" ON "contratti_cliente"("contratto_principale_id");
CREATE UNIQUE INDEX "contratti_cliente_id_tenant_id_key" ON "contratti_cliente"("id", "tenant_id");
CREATE UNIQUE INDEX "contratti_cliente_tenant_id_numero_key" ON "contratti_cliente"("tenant_id", "numero");
CREATE INDEX "periodi_fatturazione_cliente_tenant_id_idx" ON "periodi_fatturazione_cliente"("tenant_id");
CREATE UNIQUE INDEX "periodi_fatturazione_cliente_contratto_id_ordine_key" ON "periodi_fatturazione_cliente"("contratto_id", "ordine");
CREATE INDEX "allegati_contratto_cliente_tenant_id_idx" ON "allegati_contratto_cliente"("tenant_id");
CREATE UNIQUE INDEX "allegati_contratto_cliente_id_tenant_id_key" ON "allegati_contratto_cliente"("id", "tenant_id");
CREATE UNIQUE INDEX "allegati_contratto_cliente_contratto_id_posizione_key" ON "allegati_contratto_cliente"("contratto_id", "posizione");

-- 5. Chiavi esterne -------------------------------------------------------------

ALTER TABLE "agenti" ADD CONSTRAINT "agenti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agenti" ADD CONSTRAINT "agenti_ditta_fkey" FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "agenti" ADD CONSTRAINT "agenti_sede_fkey" FOREIGN KEY ("sede_id", "ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "ditta_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_ditta_fkey" FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_sede_fkey" FOREIGN KEY ("sede_id", "ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "ditta_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_conto_corrente_fkey" FOREIGN KEY ("conto_corrente_id", "tenant_id") REFERENCES "conti_correnti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_condizione_pagamento_fkey" FOREIGN KEY ("condizione_pagamento_id", "tenant_id") REFERENCES "condizioni_pagamento"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_registro_iva_fkey" FOREIGN KEY ("registro_iva_id", "tenant_id") REFERENCES "registri_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_spese_incasso_fkey" FOREIGN KEY ("spese_incasso_id", "tenant_id") REFERENCES "spese_accessorie"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_bollo_fkey" FOREIGN KEY ("bollo_id", "tenant_id") REFERENCES "spese_accessorie"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_agente_fkey" FOREIGN KEY ("agente_id", "tenant_id") REFERENCES "agenti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_cliente_fkey" FOREIGN KEY ("cliente_id", "tenant_id") REFERENCES "clienti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_cliente_fatturazione_fkey" FOREIGN KEY ("cliente_fatturazione_id", "tenant_id") REFERENCES "clienti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_sede_fkey" FOREIGN KEY ("sede_id", "tenant_id") REFERENCES "sedi_ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_categoria_fkey" FOREIGN KEY ("categoria_id", "tenant_id") REFERENCES "codifiche_contratto"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_tipo_fkey" FOREIGN KEY ("tipo_id", "tenant_id") REFERENCES "codifiche_contratto"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_motivo_annullo_fkey" FOREIGN KEY ("motivo_annullo_id", "tenant_id") REFERENCES "codifiche_contratto"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_condizione_pagamento_fkey" FOREIGN KEY ("condizione_pagamento_id", "tenant_id") REFERENCES "condizioni_pagamento"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_conto_corrente_fkey" FOREIGN KEY ("conto_corrente_id", "tenant_id") REFERENCES "conti_correnti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_agente_fkey" FOREIGN KEY ("agente_id", "tenant_id") REFERENCES "agenti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_spese_incasso_fkey" FOREIGN KEY ("spese_incasso_id", "tenant_id") REFERENCES "spese_accessorie"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_bollo_fkey" FOREIGN KEY ("bollo_id", "tenant_id") REFERENCES "spese_accessorie"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_registro_iva_fkey" FOREIGN KEY ("registro_iva_id", "tenant_id") REFERENCES "registri_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_testo_fatturazione_fkey" FOREIGN KEY ("testo_fatturazione_id", "tenant_id") REFERENCES "testi_fatturazione"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "contratti_cliente" ADD CONSTRAINT "contratti_cliente_contratto_principale_fkey" FOREIGN KEY ("contratto_principale_id", "tenant_id") REFERENCES "contratti_cliente"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "periodi_fatturazione_cliente" ADD CONSTRAINT "periodi_fatturazione_cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "periodi_fatturazione_cliente" ADD CONSTRAINT "periodi_fatturazione_cliente_contratto_fkey" FOREIGN KEY ("contratto_id", "tenant_id") REFERENCES "contratti_cliente"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "allegati_contratto_cliente" ADD CONSTRAINT "allegati_contratto_cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegati_contratto_cliente" ADD CONSTRAINT "allegati_contratto_cliente_contratto_fkey" FOREIGN KEY ("contratto_id", "tenant_id") REFERENCES "contratti_cliente"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- 6. RLS, in fondo --------------------------------------------------------------

ALTER TABLE "agenti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "agenti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "agenti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "clienti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clienti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "clienti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "clienti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "contratti_cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contratti_cliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "contratti_cliente"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "contratti_cliente" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "periodi_fatturazione_cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodi_fatturazione_cliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "periodi_fatturazione_cliente"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "periodi_fatturazione_cliente" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "allegati_contratto_cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allegati_contratto_cliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "allegati_contratto_cliente"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "allegati_contratto_cliente" FOR SELECT TO wasteflow_lettura USING (true);
