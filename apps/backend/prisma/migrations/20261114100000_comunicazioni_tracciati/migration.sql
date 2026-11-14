-- Fase 4.9c-f (PR A): fondamenta dei tracciati di comunicazione ai consorzi (CONOU, COBAT, O.R.SO.
-- dettagliata, O.R.R. Campania). Segue `20261113100100_pese_agenti`.
--
-- Cosa fa: 1. lock_timeout; 2. `dati_tracciato_movimento` (dati del tracciato per movimento,
-- agganciati alla RADICE della catena come `dati_consorzio_movimento`, ma in una tabella propria:
-- una riga di `dati_consorzio_movimento` e' una correzione manuale della marcatura); 3.
-- `anagrafica_comunicazioni_sede` (dati delle sedi delle ditte, controparti, che servono ai
-- tracciati: ATECO, ISTAT, codice ARPA, Albo, ...); 4. `configurazione_comunicazione_sede`
-- (configurazione per sede propria e consorzio); 5. RLS ENABLE + FORCE con `isolamento_azienda` e
-- `sola_lettura`.
-- Additiva: nessun DROP, nessuna colonna di tabelle esistenti toccata (non entra nell'`entry_hash` e
-- non tocca `waste_movements`, `fir`, `ditte`, `sedi_ditte`). Le chiavi esterne composte con
-- `tenant_id` impediscono per costruzione un riferimento fra aziende diverse.
SET LOCAL lock_timeout = '5s';

-- 2. Dati del tracciato per movimento -------------------------------------------------------------

CREATE TABLE "dati_tracciato_movimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    -- Copia di `registro_id` e `type` della radice: servono alla chiave esterna composta.
    "registro_id" UUID NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    -- Radice della catena (la ORDINARIA): rettifiche e annullamenti non cambiano la riga.
    "movimento_originale_id" UUID NOT NULL,
    "tracciato" VARCHAR(20) NOT NULL,
    "dati" JSONB NOT NULL,
    "versione_schema" SMALLINT NOT NULL,
    "modificato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dati_tracciato_movimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dati_tracciato_movimento_tracciato_ammesso" CHECK ("tracciato" IN ('CONOU', 'COBAT', 'ORR')),
    CONSTRAINT "dati_tracciato_movimento_dati_oggetto" CHECK (jsonb_typeof("dati") = 'object'),
    CONSTRAINT "dati_tracciato_movimento_versione_positiva" CHECK ("versione_schema" > 0)
);

CREATE UNIQUE INDEX "dati_tracciato_movimento_unico_key"
  ON "dati_tracciato_movimento"("tenant_id", "movimento_originale_id", "tracciato");
CREATE INDEX "dati_tracciato_movimento_tracciato_idx"
  ON "dati_tracciato_movimento"("tenant_id", "tracciato");

ALTER TABLE "dati_tracciato_movimento" ADD CONSTRAINT "dati_tracciato_movimento_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dati_tracciato_movimento" ADD CONSTRAINT "dati_tracciato_movimento_originale_fkey"
  FOREIGN KEY ("movimento_originale_id", "registro_id", "tenant_id", "verso")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 3. Dati delle sedi delle ditte per le comunicazioni ----------------------------------------------

CREATE TABLE "anagrafica_comunicazioni_sede" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sede_ditta_id" UUID NOT NULL,
    -- La sede e' di un comune (conferitore `C` di O.R.SO.).
    "e_comune" BOOLEAN NOT NULL DEFAULT false,
    -- Forzatura della risoluzione per nome del comune (ISTAT a 6 cifre).
    "codice_istat_comune" VARCHAR(6),
    -- `NN.NN.NN` oppure 6 cifre.
    "codice_ateco" VARCHAR(8),
    -- Codice ARPA dell'impianto (O.R.SO. `I`).
    "codice_orso" VARCHAR(9),
    "albo_data_iscrizione" DATE,
    "albo_classi" VARCHAR(30),
    "autorizzazione_data" DATE,
    "legale_rappresentante_cognome" VARCHAR(25),
    "legale_rappresentante_nome" VARCHAR(25),
    -- Equivale a `c9 LIKE '%E\C%'` di WinWaste: la sede non va nei file O.R.R.
    "esclusa_orr" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anagrafica_comunicazioni_sede_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "anagrafica_comunicazioni_sede_istat_formato" CHECK ("codice_istat_comune" IS NULL OR "codice_istat_comune" ~ '^[0-9]{6}$'),
    CONSTRAINT "anagrafica_comunicazioni_sede_ateco_formato" CHECK ("codice_ateco" IS NULL OR "codice_ateco" ~ '^([0-9]{2}\.[0-9]{2}\.[0-9]{2}|[0-9]{6})$'),
    CONSTRAINT "anagrafica_comunicazioni_sede_orso_formato" CHECK ("codice_orso" IS NULL OR "codice_orso" ~ '^[0-9]{1,9}$')
);

CREATE UNIQUE INDEX "anagrafica_comunicazioni_sede_unica_key"
  ON "anagrafica_comunicazioni_sede"("tenant_id", "sede_ditta_id");

ALTER TABLE "anagrafica_comunicazioni_sede" ADD CONSTRAINT "anagrafica_comunicazioni_sede_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "anagrafica_comunicazioni_sede" ADD CONSTRAINT "anagrafica_comunicazioni_sede_sede_fkey"
  FOREIGN KEY ("sede_ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 4. Configurazione per sede propria e consorzio ---------------------------------------------------

CREATE TABLE "configurazione_comunicazione_sede" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "unita_locale_id" UUID NOT NULL,
    "consorzio" VARCHAR(20) NOT NULL,
    -- Validata dallo schema Zod del consorzio (`domain/comunicazioni/configurazione-sede.ts`).
    "dati" JSONB NOT NULL,
    "versione_schema" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configurazione_comunicazione_sede_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configurazione_comunicazione_sede_consorzio_ammesso" CHECK ("consorzio" IN ('CONOU', 'COBAT', 'ORSO', 'ORR')),
    CONSTRAINT "configurazione_comunicazione_sede_dati_oggetto" CHECK (jsonb_typeof("dati") = 'object'),
    CONSTRAINT "configurazione_comunicazione_sede_versione_positiva" CHECK ("versione_schema" > 0)
);

CREATE UNIQUE INDEX "configurazione_comunicazione_sede_unica_key"
  ON "configurazione_comunicazione_sede"("tenant_id", "unita_locale_id", "consorzio");

ALTER TABLE "configurazione_comunicazione_sede" ADD CONSTRAINT "configurazione_comunicazione_sede_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "configurazione_comunicazione_sede" ADD CONSTRAINT "configurazione_comunicazione_sede_unita_locale_fkey"
  FOREIGN KEY ("unita_locale_id", "tenant_id") REFERENCES "rentri_unita_locali"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 5. RLS ----------------------------------------------------------------------------------------

ALTER TABLE "dati_tracciato_movimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dati_tracciato_movimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "dati_tracciato_movimento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "dati_tracciato_movimento" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "anagrafica_comunicazioni_sede" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "anagrafica_comunicazioni_sede" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "anagrafica_comunicazioni_sede"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "anagrafica_comunicazioni_sede" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "configurazione_comunicazione_sede" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configurazione_comunicazione_sede" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "configurazione_comunicazione_sede"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "configurazione_comunicazione_sede" FOR SELECT TO wasteflow_lettura USING (true);
