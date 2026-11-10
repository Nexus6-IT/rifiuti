-- Fase 4.9a (Task T0): comunicazioni generate ai consorzi e agli osservatori (O.R.SO. per primo),
-- proposta P9 §4.2. Segue `20261108100000_righe_documento_centro_categoria`.
--
-- Cosa fa: 1. lock_timeout; 2. indice unico (id, tenant_id) su `rentri_unita_locali`, necessario
-- alla chiave esterna composta della sede (additivo, tabella piccola); 3. `comunicazioni_consorzi`
-- (testata con il file generato; il contenuto sta nel database perche' non c'e' storage a oggetti);
-- 4. `comunicazioni_consorzi_movimenti` (istantanea dei movimenti inclusi, in kg); 5. RLS ENABLE +
-- FORCE con `isolamento_azienda` e `sola_lettura`.
-- Additiva: nessun DROP, nessuna colonna toccata. Le chiavi esterne composte con `tenant_id`
-- impediscono per costruzione un riferimento fra aziende diverse. La riga del movimento usa la
-- chiave unica gia' esistente di `waste_movements` (id, registro_id, tenant_id, type) per non
-- aggiungere un indice a una tabella grande: l'istantanea conserva quindi registro e tipo.
SET LOCAL lock_timeout = '5s';

-- 2. Indice unico per la chiave esterna composta ------------------------------------------------

CREATE UNIQUE INDEX "rentri_unita_locali_id_tenant_id_key" ON "rentri_unita_locali"("id", "tenant_id");

-- 3. Testata ------------------------------------------------------------------------------------

CREATE TABLE "comunicazioni_consorzi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "consorzio" VARCHAR(20) NOT NULL,
    "unita_locale_id" UUID NOT NULL,
    "periodo_da" DATE NOT NULL,
    "periodo_a" DATE NOT NULL,
    "tracciato" VARCHAR(40) NOT NULL,
    "versione" VARCHAR(20) NOT NULL,
    "stato" VARCHAR(10) NOT NULL DEFAULT 'GENERATA',
    "hash_dati" VARCHAR(64) NOT NULL,
    "nome_file" VARCHAR(255) NOT NULL,
    "contenuto" TEXT NOT NULL,
    "generata_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generata_da" UUID,
    "inviata_il" TIMESTAMPTZ(3),
    "inviata_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comunicazioni_consorzi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comunicazioni_consorzi_stato_ammesso" CHECK ("stato" IN ('GENERATA', 'INVIATA')),
    CONSTRAINT "comunicazioni_consorzi_periodo_valido" CHECK ("periodo_a" >= "periodo_da"),
    CONSTRAINT "comunicazioni_consorzi_hash_formato" CHECK ("hash_dati" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "comunicazioni_consorzi_consorzio_non_vuoto" CHECK (length(btrim("consorzio")) > 0),
    CONSTRAINT "comunicazioni_consorzi_tracciato_non_vuoto" CHECK (length(btrim("tracciato")) > 0),
    CONSTRAINT "comunicazioni_consorzi_nome_file_non_vuoto" CHECK (length(btrim("nome_file")) > 0),
    -- Una comunicazione inviata ha data di invio; una generata no.
    CONSTRAINT "comunicazioni_consorzi_invio_coerente" CHECK (
      ("stato" = 'INVIATA' AND "inviata_il" IS NOT NULL)
      OR ("stato" = 'GENERATA' AND "inviata_il" IS NULL AND "inviata_da" IS NULL)
    )
);

CREATE UNIQUE INDEX "comunicazioni_consorzi_id_tenant_id_key"
  ON "comunicazioni_consorzi"("id", "tenant_id");
-- Generazione idempotente: stesso contenuto dati per la stessa sede, periodo e tracciato = stessa riga.
CREATE UNIQUE INDEX "comunicazioni_consorzi_idempotenza_key"
  ON "comunicazioni_consorzi"("tenant_id", "consorzio", "unita_locale_id", "periodo_da", "periodo_a", "tracciato", "versione", "hash_dati");
CREATE INDEX "comunicazioni_consorzi_elenco_idx"
  ON "comunicazioni_consorzi"("tenant_id", "consorzio", "periodo_da" DESC);
CREATE INDEX "comunicazioni_consorzi_unita_locale_idx"
  ON "comunicazioni_consorzi"("unita_locale_id");

ALTER TABLE "comunicazioni_consorzi" ADD CONSTRAINT "comunicazioni_consorzi_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comunicazioni_consorzi" ADD CONSTRAINT "comunicazioni_consorzi_unita_locale_fkey"
  FOREIGN KEY ("unita_locale_id", "tenant_id") REFERENCES "rentri_unita_locali"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 4. Istantanea dei movimenti inclusi ------------------------------------------------------------

CREATE TABLE "comunicazioni_consorzi_movimenti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "comunicazione_id" UUID NOT NULL,
    "movimento_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "movimento_tipo" "waste_movement_type" NOT NULL,
    "quantita_kg" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comunicazioni_consorzi_movimenti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comunicazioni_consorzi_movimenti_quantita_check" CHECK ("quantita_kg" >= 0)
);

CREATE UNIQUE INDEX "comunicazioni_consorzi_movimenti_unico_key"
  ON "comunicazioni_consorzi_movimenti"("comunicazione_id", "movimento_id");
CREATE INDEX "comunicazioni_consorzi_movimenti_movimento_idx"
  ON "comunicazioni_consorzi_movimenti"("movimento_id");
CREATE INDEX "comunicazioni_consorzi_movimenti_tenant_id_idx"
  ON "comunicazioni_consorzi_movimenti"("tenant_id");

ALTER TABLE "comunicazioni_consorzi_movimenti" ADD CONSTRAINT "comunicazioni_consorzi_movimenti_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Cancellare la comunicazione porta via la sua istantanea.
ALTER TABLE "comunicazioni_consorzi_movimenti" ADD CONSTRAINT "comunicazioni_consorzi_movimenti_comunicazione_fkey"
  FOREIGN KEY ("comunicazione_id", "tenant_id") REFERENCES "comunicazioni_consorzi"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "comunicazioni_consorzi_movimenti" ADD CONSTRAINT "comunicazioni_consorzi_movimenti_movimento_fkey"
  FOREIGN KEY ("movimento_id", "registro_id", "tenant_id", "movimento_tipo")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 5. RLS ----------------------------------------------------------------------------------------

ALTER TABLE "comunicazioni_consorzi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comunicazioni_consorzi" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "comunicazioni_consorzi"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "comunicazioni_consorzi" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "comunicazioni_consorzi_movimenti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comunicazioni_consorzi_movimenti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "comunicazioni_consorzi_movimenti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "comunicazioni_consorzi_movimenti" FOR SELECT TO wasteflow_lettura USING (true);
