-- Fase 4 pezzo 3 (Task 3): legame fra movimento del registro, cliente, contratto, elenco e prezzo
-- (spec `2026-11-03-fase4-3-legame-movimento-prezzo-design`, §4; decisioni 4, 8, 11, 14, 15, 16).
-- Segue `20261103100000_listino_indici_seguiti` (in produzione, non si tocca).
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i quattro tipi enum; 3. il flag `fatturabile` sulle
-- causali (`causali_registro` NOT NULL DEFAULT false con il valore iniziale della decisione 15,
-- `causali_registro_azienda` NULL con backfill false per le PROPRIE e CHECK NOT VALID + VALIDATE);
-- 4. i tre unici additivi sul listino (bersagli delle chiavi composte); 5. le tre tabelle nuove
-- (`legami_movimento`, `righe_legame_movimento`, `impostazioni_fatturazione`) con chiave primaria e
-- CHECK; 6. indici e unici; 7. chiavi esterne (`<tabella>_tenant_id_fkey` a cascata verso `tenants`;
-- composite `<tabella>_<riferimento>_fkey`, tutte `NO ACTION` salvo righe -> testata, che cadono con
-- lei); 8. RLS ENABLE + FORCE con le policy `isolamento_azienda` e `sola_lettura`, stessa forma delle
-- migration del listino.
--
-- Nessuna colonna su `waste_movements` e nessun trigger: il legame segue il registro dal codice
-- applicativo. Le FK `NO ACTION` verso `righe_addebito`, `elenchi_addebiti`, `contratti_cliente`,
-- `clienti` e `codici_iva` rendono NON eliminabili gli oggetti del listino usati da un legame
-- (decisione 8, anche a cascata: il controllo `NO ACTION` e' a fine statement, quindi cancellare un
-- elenco o un contratto con una riga usata fallisce con 23503).
-- `legami_movimento_gerarchia_coerente` e' una scelta del piano oltre la spec: le chiavi composte
-- `(contratto_id, cliente_id, tenant_id)` e `(elenco_id, contratto_id, tenant_id)` non controllano
-- nulla se la colonna intermedia e' NULL (MATCH SIMPLE), quindi il CHECK impone cliente prima del
-- contratto e contratto prima dell'elenco.
-- Per `ESCLUSO` il CHECK impone `motivo_esclusione` sempre (scelta di piano: il database non
-- distingue la scelta dell'utente dal testo fisso della causale; il servizio scrive sempre un testo).
-- Gli insiemi chiusi `motivi` e `avvisi` sono ripetuti nel dominio (`domain/legami-movimento/codici.ts`).
--
-- E' additiva e sicura in deploy: tabelle e tipi nuovi e vuoti; le sole modifiche a tabelle esistenti
-- sono le due `ADD COLUMN fatturabile` e l'`UPDATE` di backfill (tabelle piccole), e i tre
-- `CREATE UNIQUE INDEX` additivi su tabelle del listino (nessun dato cambia, e (id, ...) e' gia'
-- unico per la sola `id`). Nessun `DROP`, nessun indice parziale. Nessun GRANT qui: `wasteflow_app` e
-- `wasteflow_sistema` li ricevono dai default privileges di `ops/db-ruoli.sh`. La esegue
-- `prisma migrate deploy` col ruolo proprietario (`wasteflow`).
--
-- Ripristino a mano (in quest'ordine; i legami contengono scelte dell'utente e prezzi congelati:
-- esportare prima `legami_movimento` e `righe_legame_movimento` se servono):
--   DROP TABLE righe_legame_movimento, legami_movimento, impostazioni_fatturazione;
--   DROP TYPE origine_quantita_legame, origine_riga_legame, fonte_cliente_legame, stato_legame_movimento;
--   DROP INDEX righe_addebito_id_elenco_id_tenant_id_key;
--   DROP INDEX elenchi_addebiti_id_contratto_id_tenant_id_key;
--   DROP INDEX contratti_cliente_id_cliente_id_tenant_id_key;
--   ALTER TABLE causali_registro_azienda DROP CONSTRAINT causali_registro_azienda_fatturabile_propria;
--   ALTER TABLE causali_registro_azienda DROP COLUMN fatturabile;
--   ALTER TABLE causali_registro DROP COLUMN fatturabile;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261103200000_legami_movimento';
-- Ripristino da migration fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.legami_movimento')` sia NULL, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261103200000_legami_movimento`, poi si rilancia il
-- deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi ----------------------------------------------------------------------

CREATE TYPE "stato_legame_movimento" AS ENUM ('DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO', 'ESCLUSO', 'ANNULLATO', 'FATTURATO', 'IMPORTATO_FATTURATO');
CREATE TYPE "fonte_cliente_legame" AS ENUM ('FIR', 'UTENTE');
CREATE TYPE "origine_riga_legame" AS ENUM ('PRINCIPALE', 'PROPOSTA', 'MANUALE');
CREATE TYPE "origine_quantita_legame" AS ENUM ('DA_MOVIMENTO', 'MANUALE');

-- 3. Flag `fatturabile` sulle causali (decisioni 4, 14, 15) ----------------------

ALTER TABLE "causali_registro" ADD COLUMN "fatturabile" BOOLEAN NOT NULL DEFAULT false;
UPDATE "causali_registro" SET "fatturabile" = true WHERE "codice" = 'INGRESSO_ESTERNO' AND "verso" = 'CARICO';

-- DEFAULT false: il backend vecchio (finestra di deploy, rollback del solo codice) inserisce una
-- PROPRIA senza la colonna e nasce non fatturabile, come le causali storiche (spec §4.1). Le righe
-- esistenti prendono false senza riscrittura e SENZA far scattare il trigger
-- `causali_registro_azienda_controlli`; l'unico UPDATE e' sulle DISATTIVAZIONE (a NULL), per le quali
-- il trigger salta il ramo PROPRIA (sovrapposizioni, immutabilita', versioni usate).
ALTER TABLE "causali_registro_azienda" ADD COLUMN "fatturabile" BOOLEAN DEFAULT false;
UPDATE "causali_registro_azienda" SET "fatturabile" = NULL WHERE "natura" = 'DISATTIVAZIONE';
ALTER TABLE "causali_registro_azienda" ADD CONSTRAINT "causali_registro_azienda_fatturabile_propria" CHECK ("natura" <> 'PROPRIA' OR "fatturabile" IS NOT NULL) NOT VALID;
ALTER TABLE "causali_registro_azienda" VALIDATE CONSTRAINT "causali_registro_azienda_fatturabile_propria";

-- 4. Unici additivi sul listino (bersagli delle chiavi composte) ----------------

CREATE UNIQUE INDEX "contratti_cliente_id_cliente_id_tenant_id_key" ON "contratti_cliente"("id", "cliente_id", "tenant_id");
CREATE UNIQUE INDEX "elenchi_addebiti_id_contratto_id_tenant_id_key" ON "elenchi_addebiti"("id", "contratto_id", "tenant_id");
CREATE UNIQUE INDEX "righe_addebito_id_elenco_id_tenant_id_key" ON "righe_addebito"("id", "elenco_id", "tenant_id");

-- 5. Tabelle -------------------------------------------------------------------

CREATE TABLE "legami_movimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    "movimento_originale_id" UUID NOT NULL,
    "movimento_vigente_id" UUID NOT NULL,
    "stato" "stato_legame_movimento" NOT NULL DEFAULT 'DA_COLLEGARE',
    "data_movimento" DATE NOT NULL,
    "cliente_id" UUID,
    "fonte_cliente" "fonte_cliente_legame",
    "contratto_id" UUID,
    "elenco_id" UUID,
    "motivi" TEXT[] DEFAULT ARRAY[]::text[],
    "avvisi" TEXT[] DEFAULT ARRAY[]::text[],
    "motivo_esclusione" VARCHAR(200),
    "confermato_il" TIMESTAMP(3),
    "confermato_da" UUID,
    "fatturato_il" TIMESTAMP(3),
    "riferimento_fattura" VARCHAR(50),
    "scostamento_dopo_fattura" BOOLEAN NOT NULL DEFAULT false,
    "scostamento_il" TIMESTAMP(3),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "creato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legami_movimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legami_movimento_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "legami_movimento_motivi_ammessi" CHECK ("motivi" IS NOT NULL AND "motivi" <@ ARRAY['SENZA_CLIENTE', 'SENZA_CONTRATTO', 'SEDE_SENZA_CONTRATTO', 'CONTRATTO_AMBIGUO', 'CONTRATTO_NON_ATTIVO', 'SENZA_ELENCO', 'ELENCO_SCADUTO', 'SENZA_RIGA_CER', 'RIGA_AMBIGUA', 'SENZA_PREZZO', 'SENZA_QUANTITA']::text[]),
    CONSTRAINT "legami_movimento_avvisi_ammessi" CHECK ("avvisi" IS NOT NULL AND "avvisi" <@ ARRAY['CLIENTE_NON_DA_FIR', 'QUANTITA_MANUALE_NON_DERIVATA', 'CAMBIO_CER_DA_CONFERMARE', 'PREZZO_MANUALE']::text[]),
    CONSTRAINT "legami_movimento_gerarchia_coerente" CHECK (("contratto_id" IS NULL OR "cliente_id" IS NOT NULL) AND ("elenco_id" IS NULL OR "contratto_id" IS NOT NULL)),
    CONSTRAINT "legami_movimento_completo_se_confermato" CHECK ("stato" NOT IN ('CONFERMATO', 'FATTURATO', 'IMPORTATO_FATTURATO') OR ("cliente_id" IS NOT NULL AND "contratto_id" IS NOT NULL AND "elenco_id" IS NOT NULL AND cardinality("motivi") = 0)),
    CONSTRAINT "legami_movimento_completo_se_proposto" CHECK ("stato" <> 'PROPOSTO' OR ("cliente_id" IS NOT NULL AND "contratto_id" IS NOT NULL AND "elenco_id" IS NOT NULL)),
    CONSTRAINT "legami_movimento_escluso_con_motivo" CHECK ("stato" <> 'ESCLUSO' OR "motivo_esclusione" IS NOT NULL),
    CONSTRAINT "legami_movimento_motivo_esclusione_ammesso" CHECK ("motivo_esclusione" IS NULL OR btrim("motivo_esclusione") <> ''),
    CONSTRAINT "legami_movimento_fatturato_coerente" CHECK (("stato" IN ('FATTURATO', 'IMPORTATO_FATTURATO')) = ("fatturato_il" IS NOT NULL)),
    CONSTRAINT "legami_movimento_scostamento_solo_se_fatturato" CHECK (NOT "scostamento_dopo_fattura" OR "stato" IN ('FATTURATO', 'IMPORTATO_FATTURATO'))
);

CREATE TABLE "righe_legame_movimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "legame_id" UUID NOT NULL,
    "elenco_id" UUID NOT NULL,
    "riga_addebito_id" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "origine" "origine_riga_legame" NOT NULL,
    "tipo" VARCHAR(4) NOT NULL,
    "descrizione" VARCHAR(45),
    "tipo_quantita" "tipo_quantita_addebito",
    "unita_misura" VARCHAR(3) NOT NULL,
    "quantita" DECIMAL(14,3),
    "quantita_origine" "origine_quantita_legame",
    "prezzo_speciale" BOOLEAN NOT NULL DEFAULT false,
    "prezzo" DECIMAL(14,6),
    "sconto" VARCHAR(20),
    "prezzo_manuale" BOOLEAN NOT NULL DEFAULT false,
    "codice_iva_id" UUID NOT NULL,
    "aliquota_iva" DECIMAL(5,2) NOT NULL,
    "natura_iva" VARCHAR(4),
    "congelata_il" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "righe_legame_movimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "righe_legame_movimento_speciale_senza_prezzo" CHECK (NOT "prezzo_speciale" OR "prezzo" IS NULL),
    CONSTRAINT "righe_legame_movimento_quantita_coerente" CHECK (("quantita" IS NULL) = ("quantita_origine" IS NULL)),
    CONSTRAINT "righe_legame_movimento_prezzo_manuale_ammesso" CHECK (NOT "prezzo_manuale" OR (NOT "prezzo_speciale" AND "prezzo" IS NOT NULL)),
    CONSTRAINT "righe_legame_movimento_quantita_manuale_positiva" CHECK ("quantita_origine" IS DISTINCT FROM 'MANUALE' OR "quantita" > 0),
    CONSTRAINT "righe_legame_movimento_prezzo_non_negativo" CHECK ("prezzo" IS NULL OR "prezzo" >= 0)
);

CREATE TABLE "impostazioni_fatturazione" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fatturazione_da" DATE,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "modificato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "impostazioni_fatturazione_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "impostazioni_fatturazione_versione_positiva" CHECK ("versione" >= 1)
);

-- 6. Indici e unici (prima delle chiavi esterne composite, che li usano) --------

CREATE UNIQUE INDEX "legami_movimento_tenant_id_movimento_originale_id_key" ON "legami_movimento"("tenant_id", "movimento_originale_id");
CREATE UNIQUE INDEX "legami_movimento_id_elenco_id_tenant_id_key" ON "legami_movimento"("id", "elenco_id", "tenant_id");
CREATE INDEX "legami_movimento_tenant_id_stato_data_movimento_idx" ON "legami_movimento"("tenant_id", "stato", "data_movimento");
CREATE INDEX "legami_movimento_tenant_id_cliente_id_idx" ON "legami_movimento"("tenant_id", "cliente_id");
CREATE INDEX "legami_movimento_tenant_id_contratto_id_idx" ON "legami_movimento"("tenant_id", "contratto_id");
CREATE INDEX "legami_movimento_tenant_id_elenco_id_idx" ON "legami_movimento"("tenant_id", "elenco_id");
CREATE INDEX "legami_movimento_tenant_id_movimento_vigente_id_idx" ON "legami_movimento"("tenant_id", "movimento_vigente_id");
CREATE UNIQUE INDEX "righe_legame_movimento_legame_id_riga_addebito_id_key" ON "righe_legame_movimento"("legame_id", "riga_addebito_id");
CREATE INDEX "righe_legame_movimento_tenant_id_riga_addebito_id_idx" ON "righe_legame_movimento"("tenant_id", "riga_addebito_id");
CREATE INDEX "righe_legame_movimento_tenant_id_codice_iva_id_idx" ON "righe_legame_movimento"("tenant_id", "codice_iva_id");
CREATE UNIQUE INDEX "impostazioni_fatturazione_tenant_id_key" ON "impostazioni_fatturazione"("tenant_id");

-- 7. Chiavi esterne -------------------------------------------------------------

ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_originale_fkey" FOREIGN KEY ("movimento_originale_id", "registro_id", "tenant_id", "verso") REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_vigente_fkey" FOREIGN KEY ("movimento_vigente_id", "registro_id", "tenant_id", "verso") REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_cliente_fkey" FOREIGN KEY ("cliente_id", "tenant_id") REFERENCES "clienti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_contratto_fkey" FOREIGN KEY ("contratto_id", "cliente_id", "tenant_id") REFERENCES "contratti_cliente"("id", "cliente_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_elenco_fkey" FOREIGN KEY ("elenco_id", "contratto_id", "tenant_id") REFERENCES "elenchi_addebiti"("id", "contratto_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_legame_movimento" ADD CONSTRAINT "righe_legame_movimento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "righe_legame_movimento" ADD CONSTRAINT "righe_legame_movimento_legame_fkey" FOREIGN KEY ("legame_id", "elenco_id", "tenant_id") REFERENCES "legami_movimento"("id", "elenco_id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "righe_legame_movimento" ADD CONSTRAINT "righe_legame_movimento_riga_addebito_fkey" FOREIGN KEY ("riga_addebito_id", "elenco_id", "tenant_id") REFERENCES "righe_addebito"("id", "elenco_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_legame_movimento" ADD CONSTRAINT "righe_legame_movimento_codice_iva_fkey" FOREIGN KEY ("codice_iva_id", "tenant_id") REFERENCES "codici_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "impostazioni_fatturazione" ADD CONSTRAINT "impostazioni_fatturazione_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. RLS, in fondo --------------------------------------------------------------

ALTER TABLE "legami_movimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legami_movimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "legami_movimento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "legami_movimento" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "righe_legame_movimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "righe_legame_movimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "righe_legame_movimento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "righe_legame_movimento" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "impostazioni_fatturazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "impostazioni_fatturazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "impostazioni_fatturazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "impostazioni_fatturazione" FOR SELECT TO wasteflow_lettura USING (true);
