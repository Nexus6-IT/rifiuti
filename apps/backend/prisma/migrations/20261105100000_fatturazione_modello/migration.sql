-- Fase 4 pezzo 4a (Task 6): fatturazione per periodo, modello dati
-- (spec `2026-11-05-fase4-4-valorizzazione-export-design`, §4; decisioni 3, 12, 13; scelte di piano P1, P2, P5, P8).
-- Segue `20261104100000_legami_avvisi_e_causali` (in produzione, non si tocca).
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i cinque tipi enum; 3. le colonne additive
-- (`impostazioni_fatturazione.definitive_attive`, `legami_movimento.documento_id` e le tre della
-- presa d'atto dello scostamento, `spese_accessorie.codice_iva_id`, `registri_iva.suffisso_numero`);
-- 4. i due unici additivi sui legami (bersagli delle chiavi composte delle righe di documento);
-- 5. le nove tabelle nuove con chiave primaria e CHECK; 6. indici e unici (anche i parziali e
-- `NULLS NOT DISTINCT`, che Prisma non conosce); 7. chiavi esterne; 8. i CHECK sulle tabelle
-- esistenti, `NOT VALID` poi `VALIDATE`; 9. funzioni e trigger (immutabilita' dei documenti, sonda
-- della numerazione); 10. RLS ENABLE + FORCE con `isolamento_azienda` e `sola_lettura`.
--
-- Le nove tabelle: `cedente_fatturazione`, `numerazioni_fattura`, `elaborazioni_fatturazione`,
-- `documenti_fattura`, `righe_documento_fattura`, `riepiloghi_iva_documento`,
-- `rate_documento_fattura`, `marcatori_addebiti_fatturati`, `contatori_file_fatturapa`.
-- Nessuna colonna su `waste_movements`. Nessun GRANT: `wasteflow_app` e `wasteflow_sistema` li
-- ricevono dai default privileges di `ops/db-ruoli.sh`.
--
-- E' additiva e sicura in deploy: tabelle e tipi nuovi e vuoti; colonne nuove nullable o con default;
-- i due `CREATE UNIQUE INDEX` additivi su tabelle dei legami (su `id`, gia' unico). Nessun `DROP`.
-- Il `VALIDATE` del CHECK `legami_movimento_documento_se_fatturato` passa solo se non esistono legami
-- `FATTURATO` (in produzione non ce ne sono: la 4.3 non li crea, li crea la definitiva di questo
-- pezzo, spenta finche' `definitive_attive` e' false); con un legame `FATTURATO` fallisce e nomina il
-- vincolo. La query di controllo da lanciare prima del deploy e' in `ops/README.md`.
--
-- Eccezioni dichiarate alla regola «niente trigger»: `documenti_fattura_immutabile` e
-- `figlie_documento_immutabili` (spec §4.12), fail-closed: nel documento non in bozza una colonna
-- cambia solo se e' nell'elenco esplicito delle permesse; una colonna aggiunta domani e' immutabile
-- senza toccare il trigger. Le figlie seguono lo stato della testata.
--
-- La sonda `fatturazione_violazioni_numerazione()` e' `SECURITY INVOKER` (con la RLS FORCE un
-- proprietario non superuser vedrebbe zero righe, quindi `DEFINER` non servirebbe): il `REVOKE
-- EXECUTE ... FROM PUBLIC` sta qui, il `GRANT EXECUTE` al solo `wasteflow_sistema` (BYPASSRLS) sta
-- in `prisma/sql/ruoli-db.sql`, perche' il ruolo puo' non esistere quando la migration gira.
--
-- Ripristino a mano: vedi `ops/README.md` (sezione 4.4a). Ripristino da migration fallita (P3009):
-- la migration e' transazionale, quindi si controlla che `SELECT to_regclass('public.documenti_fattura')`
-- sia NULL, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261105100000_fatturazione_modello`, poi si rilancia il deploy.

SET LOCAL lock_timeout = '5s';

-- 2. Tipi ----------------------------------------------------------------------

CREATE TYPE "stato_elaborazione_fatturazione" AS ENUM ('IN_CODA', 'IN_CORSO', 'ANTEPRIMA_PRONTA', 'IN_DEFINITIVA', 'DEFINITIVA', 'FALLITA', 'SCARTATA');
CREATE TYPE "stato_documento_fattura" AS ENUM ('BOZZA', 'DEFINITIVO', 'ANNULLATO');
CREATE TYPE "raggruppamento_fatturazione" AS ENUM ('PER_CONTRATTO', 'PER_ELENCO');
CREATE TYPE "tipo_riga_documento_fattura" AS ENUM ('MOVIMENTO', 'FASCIA_SPECIALE', 'FISSO', 'MINIMO', 'SPESA_INCASSO', 'BOLLO', 'STORNO', 'QUANTITA_MOVIMENTI');
CREATE TYPE "tipo_marcatore_addebito" AS ENUM ('SCADENZA_FISSO', 'PERIODO_CANONE', 'CONGUAGLIO', 'ACCONTO_FATTURATO', 'ACCONTO_DETRATTO');

-- 3. Colonne additive ------------------------------------------------------------

-- Interruttore delle definitive (decisione 13): spento di default; un'azienda senza riga e' spenta.
ALTER TABLE "impostazioni_fatturazione" ADD COLUMN "definitive_attive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "legami_movimento" ADD COLUMN "documento_id" UUID;
ALTER TABLE "legami_movimento" ADD COLUMN "scostamento_gestito_il" TIMESTAMP(3);
ALTER TABLE "legami_movimento" ADD COLUMN "scostamento_gestito_da" UUID;
ALTER TABLE "legami_movimento" ADD COLUMN "scostamento_nota" VARCHAR(200);

ALTER TABLE "spese_accessorie" ADD COLUMN "codice_iva_id" UUID;
ALTER TABLE "registri_iva" ADD COLUMN "suffisso_numero" VARCHAR(10);

-- 4. Unici additivi sui legami (bersagli delle chiavi composte delle righe di documento) ----

CREATE UNIQUE INDEX "legami_movimento_id_tenant_id_key" ON "legami_movimento"("id", "tenant_id");
CREATE UNIQUE INDEX "righe_legame_movimento_id_legame_id_tenant_id_key" ON "righe_legame_movimento"("id", "legame_id", "tenant_id");

-- 5. Tabelle -------------------------------------------------------------------

CREATE TABLE "cedente_fatturazione" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "regime_fiscale" VARCHAR(4) NOT NULL,
    "rea_ufficio" VARCHAR(2),
    "capitale_sociale" DECIMAL(15,2),
    "socio_unico" VARCHAR(2),
    "stato_liquidazione" VARCHAR(2) NOT NULL DEFAULT 'LN',
    "registro_iva_predefinito_id" UUID,
    "id_trasmittente_codice" VARCHAR(28),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "modificato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cedente_fatturazione_pkey" PRIMARY KEY ("id"),
    -- L'elenco esplicito di `REGIMI_FISCALI` (domain/fatturazione/costanti-fiscali.ts): RF03 non esiste.
    CONSTRAINT "cedente_fatturazione_regime_ammesso" CHECK ("regime_fiscale" IN ('RF01', 'RF02', 'RF04', 'RF05', 'RF06', 'RF07', 'RF08', 'RF09', 'RF10', 'RF11', 'RF12', 'RF13', 'RF14', 'RF15', 'RF16', 'RF17', 'RF18', 'RF19', 'RF20')),
    CONSTRAINT "cedente_fatturazione_socio_unico_ammesso" CHECK ("socio_unico" IS NULL OR "socio_unico" IN ('SU', 'SM')),
    CONSTRAINT "cedente_fatturazione_stato_liquidazione_ammesso" CHECK ("stato_liquidazione" IN ('LN', 'LS')),
    CONSTRAINT "cedente_fatturazione_versione_positiva" CHECK ("versione" >= 1)
);

CREATE TABLE "numerazioni_fattura" (
    "tenant_id" UUID NOT NULL,
    "registro_iva_id" UUID NOT NULL,
    "anno" SMALLINT NOT NULL,
    "ultimo_numero" INTEGER NOT NULL DEFAULT 0,
    "ultima_data" DATE,
    "numero_partenza" INTEGER NOT NULL DEFAULT 0,
    "data_partenza" DATE,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "numerazioni_fattura_pkey" PRIMARY KEY ("tenant_id", "registro_iva_id", "anno"),
    CONSTRAINT "numerazioni_fattura_numeri_coerenti" CHECK ("numero_partenza" >= 0 AND "ultimo_numero" >= "numero_partenza"),
    CONSTRAINT "numerazioni_fattura_versione_positiva" CHECK ("versione" >= 1)
);

CREATE TABLE "elaborazioni_fatturazione" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stato" "stato_elaborazione_fatturazione" NOT NULL DEFAULT 'IN_CODA',
    "periodo_dal" DATE NOT NULL,
    "periodo_al" DATE NOT NULL,
    "data_documento" DATE NOT NULL,
    "filtri" JSONB NOT NULL DEFAULT '{}',
    "raggruppamento" "raggruppamento_fatturazione" NOT NULL,
    "includi_arretrati" BOOLEAN NOT NULL DEFAULT false,
    "impronta" VARCHAR(64),
    "riepilogo" JSONB,
    "errori_generali" TEXT[] DEFAULT ARRAY[]::text[],
    "esito" JSONB,
    "job_id" VARCHAR(100),
    "avviata_da" UUID,
    "definita_da" UUID,
    "definita_il" TIMESTAMP(3),
    "errore_tecnico" VARCHAR(200),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elaborazioni_fatturazione_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "elaborazioni_fatturazione_periodo_ordinato" CHECK ("periodo_al" >= "periodo_dal"),
    CONSTRAINT "elaborazioni_fatturazione_errori_ammessi" CHECK ("errori_generali" IS NOT NULL AND "errori_generali" <@ ARRAY['CEDENTE_INCOMPLETO', 'DATA_ANTERIORE_ULTIMA_FATTURA', 'DATA_FUTURA', 'LEGAMI_SENZA_CONTRATTO']::text[]),
    CONSTRAINT "elaborazioni_fatturazione_versione_positiva" CHECK ("versione" >= 1)
);

CREATE TABLE "documenti_fattura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "elaborazione_id" UUID,
    "stato" "stato_documento_fattura" NOT NULL DEFAULT 'BOZZA',
    "emesso_il" TIMESTAMP(3),
    "tipo_documento" VARCHAR(4) NOT NULL,
    "registro_iva_id" UUID NOT NULL,
    "anno" SMALLINT NOT NULL,
    "numero" INTEGER,
    "numero_testo" VARCHAR(20),
    "data_documento" DATE NOT NULL,
    "cliente_id" UUID NOT NULL,
    "cliente_fatturazione_id" UUID NOT NULL,
    "contratto_id" UUID NOT NULL,
    "elenco_id" UUID,
    "periodo_dal" DATE NOT NULL,
    "periodo_al" DATE NOT NULL,
    "formato_trasmissione" VARCHAR(5) NOT NULL,
    "codice_destinatario" VARCHAR(7),
    "pec_destinatario" VARCHAR(255),
    "esigibilita_iva" "esigibilita_iva" NOT NULL,
    "totale_imponibile" DECIMAL(14,2) NOT NULL,
    "totale_iva" DECIMAL(14,2) NOT NULL,
    "totale_documento" DECIMAL(14,2) NOT NULL,
    "netto_a_pagare" DECIMAL(14,2) NOT NULL,
    "bollo_dovuto" BOOLEAN NOT NULL DEFAULT false,
    "importo_bollo" DECIMAL(6,2),
    "fotografia" JSONB NOT NULL,
    "documento_origine_id" UUID,
    "errori" TEXT[] DEFAULT ARRAY[]::text[],
    "avvisi" TEXT[] DEFAULT ARRAY[]::text[],
    "escluso_da_definitiva" BOOLEAN NOT NULL DEFAULT false,
    "xml" BYTEA,
    "xml_sha256" VARCHAR(64),
    "xml_generato_il" TIMESTAMP(3),
    "progressivo_file" VARCHAR(5),
    "definito_da" UUID,
    "definito_il" TIMESTAMP(3),
    "annullato_da" UUID,
    "annullato_il" TIMESTAMP(3),
    "motivo_annullo" VARCHAR(200),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documenti_fattura_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documenti_fattura_numero_se_non_bozza" CHECK (("stato" = 'BOZZA') = ("numero" IS NULL)),
    CONSTRAINT "documenti_fattura_senza_errori_se_non_bozza" CHECK ("stato" = 'BOZZA' OR cardinality("errori") = 0),
    CONSTRAINT "documenti_fattura_annullato_con_motivo" CHECK ("stato" <> 'ANNULLATO' OR ("motivo_annullo" IS NOT NULL AND btrim("motivo_annullo") <> '')),
    CONSTRAINT "documenti_fattura_storno_con_origine" CHECK ("tipo_documento" <> 'TD04' OR "documento_origine_id" IS NOT NULL),
    CONSTRAINT "documenti_fattura_emesso_se_non_bozza" CHECK ("emesso_il" IS NULL OR "stato" <> 'BOZZA'),
    CONSTRAINT "documenti_fattura_tipo_ammesso" CHECK ("tipo_documento" IN ('TD01', 'TD04', 'TD24')),
    CONSTRAINT "documenti_fattura_formato_ammesso" CHECK ("formato_trasmissione" IN ('FPR12', 'FPA12')),
    -- Gli insiemi chiusi sono ripetuti nel dominio (`domain/fatturazione/codici.ts`: ERRORI_DOCUMENTO, AVVISI_DOCUMENTO).
    CONSTRAINT "documenti_fattura_errori_ammessi" CHECK ("errori" IS NOT NULL AND "errori" <@ ARRAY['CONTRATTO_SOSPESO', 'SENZA_REGISTRO_IVA', 'CLIENTE_SENZA_DATI_FISCALI', 'SEDE_CLIENTE_INCOMPLETA', 'DATI_PA_INCOMPLETI', 'SENZA_CONDIZIONE_PAGAMENTO', 'PAGAMENTO_SENZA_BANCA', 'PAGAMENTO_NON_AMMESSO', 'SPESA_SENZA_CODICE_IVA', 'RIGA_LEGAME_INCOMPLETA', 'FAMIGLIA_NON_CALCOLATA', 'PREZZO_SPECIALE_NON_VALIDO', 'UM_NON_UNIVOCA', 'CANONE_PERIODO_SOVRAPPOSTO', 'NATURA_NON_AMMESSA', 'IMPORTI_NON_COERENTI', 'TOTALE_NON_POSITIVO', 'RITENUTA_NON_GESTITA']::text[]),
    CONSTRAINT "documenti_fattura_avvisi_ammessi" CHECK ("avvisi" IS NOT NULL AND "avvisi" <@ ARRAY['MOVIMENTI_DA_COLLEGARE_ESCLUSI', 'MOVIMENTI_SOSPESI', 'ARRETRATI_PRESENTI', 'BOLLO_NON_ADDEBITATO', 'DESTINATARIO_ASSENTE', 'FPA_DA_FIRMARE', 'DATA_OLTRE_TERMINE_DIFFERITA']::text[]),
    CONSTRAINT "documenti_fattura_versione_positiva" CHECK ("versione" >= 1)
);

CREATE TABLE "righe_documento_fattura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "numero_linea" INTEGER NOT NULL,
    "tipo_riga" "tipo_riga_documento_fattura" NOT NULL,
    "legame_id" UUID,
    "riga_legame_id" UUID,
    "movimento_fatturato_id" UUID,
    "riga_addebito_id" UUID,
    "descrizione" VARCHAR(1000) NOT NULL,
    "data_movimento" DATE,
    "cer_code" VARCHAR(10),
    "numero_fir" VARCHAR(50),
    "quantita" DECIMAL(14,3),
    "unita_misura" VARCHAR(10),
    "prezzo_unitario" DECIMAL(14,6) NOT NULL,
    "sconto" VARCHAR(20),
    "importo_lordo" DECIMAL(14,2) NOT NULL,
    "importo_sconto" DECIMAL(14,2) NOT NULL,
    "prezzo_totale" DECIMAL(14,2) NOT NULL,
    "codice_iva_id" UUID NOT NULL,
    "aliquota_iva" DECIMAL(5,2) NOT NULL,
    "natura_iva" VARCHAR(4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "righe_documento_fattura_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "righe_documento_fattura_linea_positiva" CHECK ("numero_linea" >= 1),
    -- La FK composta verso la riga del legame non controlla nulla con `legame_id` nullo (MATCH SIMPLE).
    CONSTRAINT "righe_documento_fattura_riga_legame_con_legame" CHECK ("riga_legame_id" IS NULL OR "legame_id" IS NOT NULL)
);

CREATE TABLE "riepiloghi_iva_documento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "aliquota" DECIMAL(5,2) NOT NULL,
    "natura" VARCHAR(4),
    "imponibile" DECIMAL(14,2) NOT NULL,
    "imposta" DECIMAL(14,2) NOT NULL,
    "esigibilita" "esigibilita_iva" NOT NULL,
    "riferimento_normativo" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riepiloghi_iva_documento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_documento_fattura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "modalita" VARCHAR(4) NOT NULL,
    "data_scadenza" DATE NOT NULL,
    "importo" DECIMAL(14,2) NOT NULL,
    "istituto" VARCHAR(80),
    "iban" VARCHAR(34),
    "abi" VARCHAR(5),
    "cab" VARCHAR(5),
    "bic" VARCHAR(11),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_documento_fattura_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rate_documento_fattura_ordine_positivo" CHECK ("ordine" >= 1)
);

CREATE TABLE "marcatori_addebiti_fatturati" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "riga_addebito_id" UUID NOT NULL,
    "tipo" "tipo_marcatore_addebito" NOT NULL,
    "chiave_competenza" VARCHAR(25) NOT NULL,
    "documento_id" UUID NOT NULL,
    "riga_documento_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marcatori_addebiti_fatturati_pkey" PRIMARY KEY ("id"),
    -- `AAAA-MM-GG` oppure `AAAA-MM-GG/AAAA-MM-GG` (mese 01-12, giorno 01-31).
    CONSTRAINT "marcatori_addebiti_fatturati_chiave_ammessa" CHECK ("chiave_competenza" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(/[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]))?$')
);

CREATE TABLE "contatori_file_fatturapa" (
    "tenant_id" UUID NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contatori_file_fatturapa_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "contatori_file_fatturapa_ultimo_non_negativo" CHECK ("ultimo" >= 0)
);

-- 6. Indici e unici (prima delle chiavi esterne composite, che li usano) --------

CREATE UNIQUE INDEX "cedente_fatturazione_tenant_id_key" ON "cedente_fatturazione"("tenant_id");

CREATE UNIQUE INDEX "elaborazioni_fatturazione_id_tenant_id_key" ON "elaborazioni_fatturazione"("id", "tenant_id");
CREATE INDEX "elaborazioni_fatturazione_tenant_id_stato_created_at_idx" ON "elaborazioni_fatturazione"("tenant_id", "stato", "created_at");
-- Al massimo una elaborazione per azienda in corso o in definitiva (clausola solo in SQL).
CREATE UNIQUE INDEX "elaborazioni_fatturazione_una_attiva" ON "elaborazioni_fatturazione"("tenant_id") WHERE "stato" IN ('IN_CORSO', 'IN_DEFINITIVA');

CREATE UNIQUE INDEX "documenti_fattura_id_tenant_id_key" ON "documenti_fattura"("id", "tenant_id");
CREATE UNIQUE INDEX "documenti_fattura_tenant_id_progressivo_file_key" ON "documenti_fattura"("tenant_id", "progressivo_file");
-- Un numero annullato (decisione 3) si riusa: l'unico vale solo per i DEFINITIVO (clausole solo in SQL).
CREATE UNIQUE INDEX "documenti_fattura_numero_definitivo" ON "documenti_fattura"("tenant_id", "registro_iva_id", "anno", "numero") WHERE "stato" = 'DEFINITIVO';
CREATE UNIQUE INDEX "documenti_fattura_un_storno" ON "documenti_fattura"("tenant_id", "documento_origine_id") WHERE "tipo_documento" = 'TD04' AND "stato" <> 'ANNULLATO';
CREATE INDEX "documenti_fattura_tenant_id_stato_data_documento_idx" ON "documenti_fattura"("tenant_id", "stato", "data_documento");
CREATE INDEX "documenti_fattura_tenant_id_cliente_fatturazione_id_idx" ON "documenti_fattura"("tenant_id", "cliente_fatturazione_id");
CREATE INDEX "documenti_fattura_tenant_id_elaborazione_id_idx" ON "documenti_fattura"("tenant_id", "elaborazione_id");

CREATE UNIQUE INDEX "righe_documento_fattura_id_documento_id_tenant_id_key" ON "righe_documento_fattura"("id", "documento_id", "tenant_id");
CREATE UNIQUE INDEX "righe_documento_fattura_documento_id_numero_linea_key" ON "righe_documento_fattura"("documento_id", "numero_linea");
CREATE INDEX "righe_documento_fattura_tenant_id_legame_id_idx" ON "righe_documento_fattura"("tenant_id", "legame_id");
CREATE INDEX "righe_documento_fattura_tenant_id_riga_addebito_id_idx" ON "righe_documento_fattura"("tenant_id", "riga_addebito_id");
CREATE INDEX "righe_documento_fattura_tenant_id_codice_iva_id_idx" ON "righe_documento_fattura"("tenant_id", "codice_iva_id");

-- Natura nulla = nessuna natura: due riepiloghi senza natura alla stessa aliquota sono lo stesso (NULLS NOT DISTINCT).
CREATE UNIQUE INDEX "riepiloghi_iva_documento_documento_id_aliquota_natura_key" ON "riepiloghi_iva_documento"("documento_id", "aliquota", "natura") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "rate_documento_fattura_documento_id_ordine_key" ON "rate_documento_fattura"("documento_id", "ordine");

CREATE UNIQUE INDEX "marcatori_addebiti_fatturati_unico_key" ON "marcatori_addebiti_fatturati"("tenant_id", "riga_addebito_id", "tipo", "chiave_competenza");
CREATE INDEX "marcatori_addebiti_fatturati_tenant_id_documento_id_idx" ON "marcatori_addebiti_fatturati"("tenant_id", "documento_id");

CREATE INDEX "legami_movimento_tenant_id_documento_id_idx" ON "legami_movimento"("tenant_id", "documento_id");
CREATE INDEX "spese_accessorie_tenant_id_codice_iva_id_idx" ON "spese_accessorie"("tenant_id", "codice_iva_id");

-- 7. Chiavi esterne -------------------------------------------------------------
-- `<tabella>_tenant_id_fkey` a cascata verso `tenants`; le composite sono `NO ACTION` (rendono "in uso"
-- cliente, contratto, elenco, registro IVA, listino e codici IVA), salvo le figlie del documento che
-- cadono con lui (e il trigger lo permette solo per le bozze).

ALTER TABLE "cedente_fatturazione" ADD CONSTRAINT "cedente_fatturazione_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cedente_fatturazione" ADD CONSTRAINT "cedente_fatturazione_registro_iva_fkey" FOREIGN KEY ("registro_iva_predefinito_id", "tenant_id") REFERENCES "registri_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "numerazioni_fattura" ADD CONSTRAINT "numerazioni_fattura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "numerazioni_fattura" ADD CONSTRAINT "numerazioni_fattura_registro_iva_fkey" FOREIGN KEY ("registro_iva_id", "tenant_id") REFERENCES "registri_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "elaborazioni_fatturazione" ADD CONSTRAINT "elaborazioni_fatturazione_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_elaborazione_fkey" FOREIGN KEY ("elaborazione_id", "tenant_id") REFERENCES "elaborazioni_fatturazione"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_registro_iva_fkey" FOREIGN KEY ("registro_iva_id", "tenant_id") REFERENCES "registri_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_cliente_fkey" FOREIGN KEY ("cliente_id", "tenant_id") REFERENCES "clienti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_cliente_fatturazione_fkey" FOREIGN KEY ("cliente_fatturazione_id", "tenant_id") REFERENCES "clienti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_contratto_fkey" FOREIGN KEY ("contratto_id", "cliente_id", "tenant_id") REFERENCES "contratti_cliente"("id", "cliente_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Con `elenco_id` nullo la chiave non si controlla (MATCH SIMPLE).
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_elenco_fkey" FOREIGN KEY ("elenco_id", "contratto_id", "tenant_id") REFERENCES "elenchi_addebiti"("id", "contratto_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "documenti_fattura" ADD CONSTRAINT "documenti_fattura_origine_fkey" FOREIGN KEY ("documento_origine_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_legame_fkey" FOREIGN KEY ("legame_id", "tenant_id") REFERENCES "legami_movimento"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_riga_legame_fkey" FOREIGN KEY ("riga_legame_id", "legame_id", "tenant_id") REFERENCES "righe_legame_movimento"("id", "legame_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_riga_addebito_fkey" FOREIGN KEY ("riga_addebito_id", "tenant_id") REFERENCES "righe_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_documento_fattura" ADD CONSTRAINT "righe_documento_fattura_codice_iva_fkey" FOREIGN KEY ("codice_iva_id", "tenant_id") REFERENCES "codici_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "riepiloghi_iva_documento" ADD CONSTRAINT "riepiloghi_iva_documento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "riepiloghi_iva_documento" ADD CONSTRAINT "riepiloghi_iva_documento_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "rate_documento_fattura" ADD CONSTRAINT "rate_documento_fattura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rate_documento_fattura" ADD CONSTRAINT "rate_documento_fattura_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "marcatori_addebiti_fatturati" ADD CONSTRAINT "marcatori_addebiti_fatturati_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marcatori_addebiti_fatturati" ADD CONSTRAINT "marcatori_addebiti_fatturati_riga_addebito_fkey" FOREIGN KEY ("riga_addebito_id", "tenant_id") REFERENCES "righe_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "marcatori_addebiti_fatturati" ADD CONSTRAINT "marcatori_addebiti_fatturati_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "marcatori_addebiti_fatturati" ADD CONSTRAINT "marcatori_addebiti_fatturati_riga_documento_fkey" FOREIGN KEY ("riga_documento_id", "documento_id", "tenant_id") REFERENCES "righe_documento_fattura"("id", "documento_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "contatori_file_fatturapa" ADD CONSTRAINT "contatori_file_fatturapa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 8. CHECK sulle tabelle esistenti, NOT VALID poi VALIDATE -------------------------
-- Il primo fallisce (nominando il vincolo) se esiste un legame FATTURATO senza documento: in
-- produzione non ce ne sono. `IMPORTATO_FATTURATO` resta senza documento.

ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_documento_se_fatturato" CHECK (("stato" = 'FATTURATO') = ("documento_id" IS NOT NULL)) NOT VALID;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_gestito_se_scostamento" CHECK ("scostamento_gestito_il" IS NULL OR "scostamento_dopo_fattura") NOT VALID;
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "spese_accessorie" ADD CONSTRAINT "spese_accessorie_codice_iva_fkey" FOREIGN KEY ("codice_iva_id", "tenant_id") REFERENCES "codici_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "legami_movimento" VALIDATE CONSTRAINT "legami_movimento_documento_se_fatturato";
ALTER TABLE "legami_movimento" VALIDATE CONSTRAINT "legami_movimento_gestito_se_scostamento";
ALTER TABLE "legami_movimento" VALIDATE CONSTRAINT "legami_movimento_documento_fkey";
ALTER TABLE "spese_accessorie" VALIDATE CONSTRAINT "spese_accessorie_codice_iva_fkey";

-- 9. Funzioni e trigger -----------------------------------------------------------

-- Immutabilita' della testata (spec §4.12), fail-closed. DELETE ammesso solo per le bozze. UPDATE di
-- una bozza libero (lo usano ricalcolo e definitiva, che la porta a DEFINITIVO). UPDATE di un
-- documento non in bozza: ammesse solo le colonne dell'elenco `v_permesse`; ogni altra colonna,
-- anche una aggiunta domani, e' respinta dal confronto jsonb. Poi le regole puntuali.
CREATE FUNCTION documenti_fattura_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_permesse text[] := ARRAY['stato', 'annullato_il', 'annullato_da', 'motivo_annullo', 'emesso_il',
                             'xml', 'xml_sha256', 'xml_generato_il', 'progressivo_file',
                             'versione', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.stato <> 'BOZZA' THEN
      RAISE EXCEPTION 'documenti_fattura: un documento non in bozza non si cancella';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.stato = 'BOZZA' THEN
    IF NEW.stato NOT IN ('BOZZA', 'DEFINITIVO') THEN
      RAISE EXCEPTION 'documenti_fattura: una bozza diventa solo definitiva';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_permesse) IS DISTINCT FROM (to_jsonb(OLD) - v_permesse) THEN
    RAISE EXCEPTION 'documenti_fattura: documento non in bozza immutabile';
  END IF;
  IF NEW.stato <> OLD.stato THEN
    -- Solo DEFINITIVO -> ANNULLATO, e solo se non emesso (decisioni 3 e 12). L'annullo non scrive
    -- l'emissione: un annullato non diventa «emesso» e non consuma un progressivo_file.
    -- (Il divieto di annullare un TD04, decisione 18, e «solo l'ultimo numero» restano al servizio:
    -- 409 ANNULLO_NON_AMMESSO, Task 20.)
    IF NOT (OLD.stato = 'DEFINITIVO' AND NEW.stato = 'ANNULLATO') THEN
      RAISE EXCEPTION 'documenti_fattura: transizione di stato non ammessa';
    END IF;
    IF OLD.emesso_il IS NOT NULL THEN
      RAISE EXCEPTION 'documenti_fattura: un documento emesso non si annulla';
    END IF;
    IF NEW.emesso_il IS DISTINCT FROM OLD.emesso_il OR NEW.xml IS DISTINCT FROM OLD.xml
       OR NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256
       OR NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il
       OR NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file THEN
      RAISE EXCEPTION 'documenti_fattura: l''annullo non scrive i dati di emissione';
    END IF;
  ELSIF OLD.stato = 'ANNULLATO' THEN
    -- Un annullato resta com'e': passano solo versione e updated_at (le permesse dell'elenco).
    IF NEW.emesso_il IS DISTINCT FROM OLD.emesso_il OR NEW.xml IS DISTINCT FROM OLD.xml
       OR NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256
       OR NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il
       OR NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file
       OR NEW.annullato_il IS DISTINCT FROM OLD.annullato_il
       OR NEW.annullato_da IS DISTINCT FROM OLD.annullato_da
       OR NEW.motivo_annullo IS DISTINCT FROM OLD.motivo_annullo THEN
      RAISE EXCEPTION 'documenti_fattura: un documento annullato non si modifica';
    END IF;
  ELSIF NEW.annullato_il IS DISTINCT FROM OLD.annullato_il
     OR NEW.annullato_da IS DISTINCT FROM OLD.annullato_da
     OR NEW.motivo_annullo IS DISTINCT FROM OLD.motivo_annullo THEN
    RAISE EXCEPTION 'documenti_fattura: i dati dell''annullo si scrivono solo con l''annullo';
  END IF;
  -- Da null a valore una sola volta.
  IF OLD.emesso_il IS NOT NULL AND NEW.emesso_il IS DISTINCT FROM OLD.emesso_il THEN
    RAISE EXCEPTION 'documenti_fattura: emesso_il gia'' scritto';
  END IF;
  IF OLD.xml IS NOT NULL AND NEW.xml IS DISTINCT FROM OLD.xml THEN
    RAISE EXCEPTION 'documenti_fattura: xml gia'' scritto';
  END IF;
  IF OLD.xml_sha256 IS NOT NULL AND NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256 THEN
    RAISE EXCEPTION 'documenti_fattura: xml_sha256 gia'' scritto';
  END IF;
  IF OLD.xml_generato_il IS NOT NULL AND NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il THEN
    RAISE EXCEPTION 'documenti_fattura: xml_generato_il gia'' scritto';
  END IF;
  IF OLD.progressivo_file IS NOT NULL AND NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file THEN
    RAISE EXCEPTION 'documenti_fattura: progressivo_file gia'' scritto';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER documenti_fattura_immutabile BEFORE UPDATE OR DELETE ON "documenti_fattura"
  FOR EACH ROW EXECUTE FUNCTION documenti_fattura_immutabile();

-- Le figlie (righe, riepiloghi, rate) seguono lo stato della testata: si inseriscono, si modificano e
-- si cancellano solo se il documento e' in bozza (I1 della revisione: anche l'INSERT, perche' una
-- riga in piu' cambia il contenuto fiscale di un documento emesso). ORDINE DI CREAZIONE, anche per
-- il TD04 di storno (Task 19 e 20): testata in BOZZA (numero nullo) -> figlie -> UPDATE della
-- testata a DEFINITIVO con numero e data (consentito una volta sola: dopo, tutto e' bloccato).
-- Lettura semplice, nessun lock (ordine dei lock della spec §8): in READ COMMITTED una scrittura
-- concorrente alla promozione puo' ancora vedere BOZZA, quindi chi scrive le figlie blocca prima la
-- testata `FOR UPDATE` (ultimo passo dell'ordine dei lock: Task 17 e 19). Testata assente =
-- cancellazione a cascata in corso (o FK che fara' fallire l'INSERT): passa.
CREATE FUNCTION figlie_documento_immutabili() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_documento_fattura";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT d.stato INTO v_stato FROM "documenti_fattura" d
      WHERE d.id = NEW.documento_id AND d.tenant_id = NEW.tenant_id;
  ELSE
    SELECT d.stato INTO v_stato FROM "documenti_fattura" d
      WHERE d.id = OLD.documento_id AND d.tenant_id = OLD.tenant_id;
  END IF;
  IF v_stato IS NOT NULL AND v_stato <> 'BOZZA' THEN
    RAISE EXCEPTION '%: le righe di un documento non in bozza sono immutabili', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.documento_id IS DISTINCT FROM OLD.documento_id THEN
      RAISE EXCEPTION '%: una riga non cambia documento', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$fn$;

CREATE TRIGGER figlie_documento_immutabili BEFORE INSERT OR UPDATE OR DELETE ON "righe_documento_fattura"
  FOR EACH ROW EXECUTE FUNCTION figlie_documento_immutabili();
CREATE TRIGGER figlie_documento_immutabili BEFORE INSERT OR UPDATE OR DELETE ON "riepiloghi_iva_documento"
  FOR EACH ROW EXECUTE FUNCTION figlie_documento_immutabili();
CREATE TRIGGER figlie_documento_immutabili BEFORE INSERT OR UPDATE OR DELETE ON "rate_documento_fattura"
  FOR EACH ROW EXECUTE FUNCTION figlie_documento_immutabili();

-- Sonda della numerazione senza buchi (spec §4.6; la legge `system-health`). Per ogni azienda con
-- una numerazione conta le violazioni dell'invariante «i numeri dei DEFINITIVO di (registro, anno)
-- sono esattamente numero_partenza+1 .. ultimo_numero»: numeri mancanti, doppi o fuori intervallo,
-- piu' i definitivi di una coppia senza riga di numerazione. Solo conteggi per azienda, nessun dato
-- personale. SECURITY INVOKER: la legge solo chi aggira la RLS (`wasteflow_sistema`).
CREATE FUNCTION fatturazione_violazioni_numerazione() RETURNS TABLE (tenant_id uuid, violazioni integer)
LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
  SELECT t.azienda, sum(t.v)::integer
  FROM (
    SELECT n.tenant_id AS azienda,
           ( (n.ultimo_numero - n.numero_partenza)
             - (SELECT count(DISTINCT d.numero) FROM documenti_fattura d
                 WHERE d.tenant_id = n.tenant_id AND d.registro_iva_id = n.registro_iva_id
                   AND d.anno = n.anno AND d.stato = 'DEFINITIVO'
                   AND d.numero BETWEEN n.numero_partenza + 1 AND n.ultimo_numero)
             + (SELECT count(*) - count(DISTINCT d.numero) FROM documenti_fattura d
                 WHERE d.tenant_id = n.tenant_id AND d.registro_iva_id = n.registro_iva_id
                   AND d.anno = n.anno AND d.stato = 'DEFINITIVO'
                   AND d.numero BETWEEN n.numero_partenza + 1 AND n.ultimo_numero)
             + (SELECT count(*) FROM documenti_fattura d
                 WHERE d.tenant_id = n.tenant_id AND d.registro_iva_id = n.registro_iva_id
                   AND d.anno = n.anno AND d.stato = 'DEFINITIVO'
                   AND (d.numero <= n.numero_partenza OR d.numero > n.ultimo_numero))
           )::bigint AS v
    FROM numerazioni_fattura n
    UNION ALL
    SELECT d.tenant_id AS azienda, count(*)::bigint AS v
    FROM documenti_fattura d
    WHERE d.stato = 'DEFINITIVO'
      AND NOT EXISTS (SELECT 1 FROM numerazioni_fattura n
                       WHERE n.tenant_id = d.tenant_id AND n.registro_iva_id = d.registro_iva_id
                         AND n.anno = d.anno)
    GROUP BY d.tenant_id
  ) t
  GROUP BY t.azienda
$fn$;

REVOKE EXECUTE ON FUNCTION fatturazione_violazioni_numerazione() FROM PUBLIC;

-- 10. RLS, in fondo ---------------------------------------------------------------

ALTER TABLE "cedente_fatturazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cedente_fatturazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "cedente_fatturazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "cedente_fatturazione" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "numerazioni_fattura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "numerazioni_fattura" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "numerazioni_fattura"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "numerazioni_fattura" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "elaborazioni_fatturazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "elaborazioni_fatturazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "elaborazioni_fatturazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "elaborazioni_fatturazione" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "documenti_fattura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documenti_fattura" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "documenti_fattura"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "documenti_fattura" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "righe_documento_fattura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "righe_documento_fattura" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "righe_documento_fattura"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "righe_documento_fattura" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "riepiloghi_iva_documento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "riepiloghi_iva_documento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "riepiloghi_iva_documento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "riepiloghi_iva_documento" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "rate_documento_fattura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_documento_fattura" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rate_documento_fattura"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "rate_documento_fattura" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "marcatori_addebiti_fatturati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marcatori_addebiti_fatturati" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "marcatori_addebiti_fatturati"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "marcatori_addebiti_fatturati" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "contatori_file_fatturapa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contatori_file_fatturapa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "contatori_file_fatturapa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "contatori_file_fatturapa" FOR SELECT TO wasteflow_lettura USING (true);
