-- Fase 4.9b (Task T8): marcatura dei movimenti per consorzio (CONOU, COBAT, Corepla), proposta P9 §4.1,
-- decisione D3 = a (regole per azienda + correzione sul singolo movimento). Segue
-- `20261110120000_fir_presa_in_carico`.
--
-- Cosa fa: 1. lock_timeout; 2. `regole_consorzio` (regole per azienda su CER, verso, causale e registro);
-- 3. `dati_consorzio_movimento` (correzione manuale sul singolo movimento, agganciata alla RADICE
-- della catena come `legami_movimento`, cosi' segue rettifiche e annullamenti); 4. RLS ENABLE + FORCE
-- con `isolamento_azienda` e `sola_lettura`.
-- Additiva: nessun DROP, nessuna colonna di tabelle esistenti toccata (non entra nell'`entry_hash` e non
-- tocca `waste_movements`). Le chiavi esterne composte con `tenant_id` impediscono per costruzione un
-- riferimento fra aziende diverse.
SET LOCAL lock_timeout = '5s';

-- 2. Regole per azienda --------------------------------------------------------------------------

CREATE TABLE "regole_consorzio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "consorzio" VARCHAR(20) NOT NULL,
    -- NULL = sia carichi sia scarichi.
    "verso" "waste_movement_type",
    -- Le sole cifre del CER: prefisso di 2 o 4 cifre (capitolo, sottocapitolo) oppure codice esatto di 6.
    "cer_prefisso" VARCHAR(4),
    "cer_esatto" VARCHAR(6),
    "causale_codice" VARCHAR(100),
    "registro_id" UUID,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "valida_dal" DATE NOT NULL DEFAULT CURRENT_DATE,
    "creata_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regole_consorzio_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regole_consorzio_consorzio_ammesso" CHECK ("consorzio" IN ('CONOU', 'COBAT', 'COREPLA')),
    CONSTRAINT "regole_consorzio_cer_prefisso_formato" CHECK ("cer_prefisso" IS NULL OR "cer_prefisso" ~ '^([0-9]{2}|[0-9]{4})$'),
    CONSTRAINT "regole_consorzio_cer_esatto_formato" CHECK ("cer_esatto" IS NULL OR "cer_esatto" ~ '^[0-9]{6}$'),
    -- Una regola indica il CER in un solo modo: prefisso oppure codice esatto.
    CONSTRAINT "regole_consorzio_cer_uno_solo" CHECK (("cer_prefisso" IS NULL) <> ("cer_esatto" IS NULL)),
    CONSTRAINT "regole_consorzio_causale_non_vuota" CHECK ("causale_codice" IS NULL OR length(btrim("causale_codice")) > 0)
);

CREATE UNIQUE INDEX "regole_consorzio_id_tenant_id_key" ON "regole_consorzio"("id", "tenant_id");
CREATE INDEX "regole_consorzio_tenant_id_consorzio_idx" ON "regole_consorzio"("tenant_id", "consorzio");
CREATE INDEX "regole_consorzio_registro_idx" ON "regole_consorzio"("registro_id");

ALTER TABLE "regole_consorzio" ADD CONSTRAINT "regole_consorzio_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regole_consorzio" ADD CONSTRAINT "regole_consorzio_registro_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 3. Correzione sul singolo movimento --------------------------------------------------------------

CREATE TABLE "dati_consorzio_movimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    -- Copia di `registro_id` e `type` della radice: servono alla chiave esterna composta.
    "registro_id" UUID NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    -- Radice della catena (la ORDINARIA): rettifiche e annullamenti non cambiano la riga.
    "movimento_originale_id" UUID NOT NULL,
    "consorzio" VARCHAR(20) NOT NULL,
    -- false = marcatura manuale (il movimento e' del consorzio anche senza regola);
    -- true = esclusione manuale (non e' del consorzio anche se una regola lo prenderebbe).
    "escluso" BOOLEAN NOT NULL DEFAULT false,
    -- Dati specifici del tracciato (4.9c/4.9d), validati dal suo schema.
    "dati" JSONB,
    "versione_schema" SMALLINT,
    "creato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dati_consorzio_movimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dati_consorzio_movimento_consorzio_ammesso" CHECK ("consorzio" IN ('CONOU', 'COBAT', 'COREPLA')),
    CONSTRAINT "dati_consorzio_movimento_schema_coerente" CHECK (("dati" IS NULL) = ("versione_schema" IS NULL))
);

CREATE UNIQUE INDEX "dati_consorzio_movimento_unico_key"
  ON "dati_consorzio_movimento"("tenant_id", "movimento_originale_id", "consorzio");
CREATE INDEX "dati_consorzio_movimento_consorzio_idx"
  ON "dati_consorzio_movimento"("tenant_id", "consorzio");

ALTER TABLE "dati_consorzio_movimento" ADD CONSTRAINT "dati_consorzio_movimento_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dati_consorzio_movimento" ADD CONSTRAINT "dati_consorzio_movimento_originale_fkey"
  FOREIGN KEY ("movimento_originale_id", "registro_id", "tenant_id", "verso")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 4. RLS ----------------------------------------------------------------------------------------

ALTER TABLE "regole_consorzio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regole_consorzio" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "regole_consorzio"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "regole_consorzio" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "dati_consorzio_movimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dati_consorzio_movimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "dati_consorzio_movimento"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "dati_consorzio_movimento" FOR SELECT TO wasteflow_lettura USING (true);
