-- Fase 4 pezzo 4.5a: emissione SDI tramite provider, modello dati (piano
-- `docs/superpowers/plans/2026-11-18-sdi-provider.md`, §4.2). Segue `20261118100000_movimenti_sede_controparte`.
--
-- Cosa fa: due tipi enum e quattro tabelle nuove e vuote, tutte con `tenant_id`, RLS ENABLE + FORCE e le due
-- policy standard (`isolamento_azienda`, `sola_lettura`):
--   1. `configurazioni_sdi`: una per azienda (provider, ambiente, credenziali CIFRATE, hash del token del
--      webhook, segreto del webhook cifrato, `invio_attivo` spento di default). Un CHECK impone che
--      `invio_attivo` abbia una verifica riuscita alle spalle.
--   2. `trasmissioni_sdi`: un tentativo di invio di un documento. Unico parziale = una sola trasmissione
--      «viva» per documento (presidio contro il doppio invio). Trigger di transizione: rifiuta le
--      transizioni fuori dalla macchina a stati e ogni modifica di `nome_file`, `xml_sha256`,
--      `documento_id`, `direzione`, `provider`, `ambiente`.
--   3. `notifiche_sdi`: ricevute e notifiche, SOLO INSERIMENTO (REVOKE di UPDATE/DELETE/TRUNCATE ai ruoli
--      applicativi, anche in `prisma/sql/ruoli-db.sql`).
--   4. `eventi_sdi_ricevuti`: inbox del webhook (idempotente); dopo l'inserimento si possono cambiare solo
--      `elaborato_il` e `esito_elaborazione`.
--
-- Lo stato SDI sta in tabelle SEPARATE: il trigger `documenti_fattura_immutabile` e' fail-closed e una colonna
-- nuova sulla testata sarebbe immutabile sul DEFINITIVO. NESSUNA colonna e nessun trigger toccano
-- `documenti_fattura`.
--
-- E' additiva e sicura in deploy: tipi e tabelle nuovi e vuoti, nessun DROP, nessun dato esistente cambia.
-- Nessun GRANT qui: `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges di
-- `ops/db-ruoli.sh` (la REVOKE di `notifiche_sdi` e' fatta anche qui, se i ruoli esistono).
--
-- Ripristino a mano (in quest'ordine):
--   DROP TABLE eventi_sdi_ricevuti, notifiche_sdi, trasmissioni_sdi, configurazioni_sdi;
--   DROP FUNCTION trasmissioni_sdi_transizioni(), eventi_sdi_ricevuti_solo_elaborazione();
--   DROP TYPE stato_trasmissione_sdi, direzione_trasmissione_sdi;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261119100000_sdi_trasmissioni';

SET LOCAL lock_timeout = '5s';

-- Tipi ---------------------------------------------------------------------------

CREATE TYPE "stato_trasmissione_sdi" AS ENUM (
  'DA_INVIARE', 'IN_INVIO', 'INVIATA', 'INCERTA', 'ERRORE_INVIO', 'CONSEGNATA', 'NON_CONSEGNATA',
  'SCARTATA', 'ACCETTATA', 'RIFIUTATA', 'DECORSI_TERMINI', 'NON_RECAPITABILE'
);
CREATE TYPE "direzione_trasmissione_sdi" AS ENUM ('EMESSA', 'RICEVUTA');

-- Tabelle -------------------------------------------------------------------------

CREATE TABLE "configurazioni_sdi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "ambiente" VARCHAR(12) NOT NULL DEFAULT 'SANDBOX',
    "credenziali_cifrate" TEXT,
    "id_configurazione_provider" VARCHAR(100),
    "webhook_token_sha256" CHAR(64) NOT NULL,
    "webhook_segreto_cifrato" TEXT,
    "firma_dal_provider" BOOLEAN NOT NULL DEFAULT false,
    "invio_attivo" BOOLEAN NOT NULL DEFAULT false,
    "onboarding" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "verificata_il" TIMESTAMP(3),
    "ultimo_esito_verifica" VARCHAR(300),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "modificato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configurazioni_sdi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configurazioni_sdi_provider_ammesso" CHECK ("provider" IN ('fake', 'openapi', 'invoicetronic')),
    CONSTRAINT "configurazioni_sdi_ambiente_ammesso" CHECK ("ambiente" IN ('SANDBOX', 'PRODUZIONE')),
    CONSTRAINT "configurazioni_sdi_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "configurazioni_sdi_token_sha256" CHECK ("webhook_token_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "configurazioni_sdi_invio_se_verificata" CHECK (NOT "invio_attivo" OR "verificata_il" IS NOT NULL)
);

CREATE TABLE "trasmissioni_sdi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "direzione" "direzione_trasmissione_sdi" NOT NULL DEFAULT 'EMESSA',
    "provider" VARCHAR(20) NOT NULL,
    "ambiente" VARCHAR(12) NOT NULL,
    "nome_file" VARCHAR(60) NOT NULL,
    "xml_sha256" CHAR(64) NOT NULL,
    "stato" "stato_trasmissione_sdi" NOT NULL DEFAULT 'DA_INVIARE',
    "id_provider" VARCHAR(100),
    "id_sdi" VARCHAR(50),
    "file_firmato" BYTEA,
    "file_firmato_sha256" CHAR(64),
    "tentativi" INTEGER NOT NULL DEFAULT 0,
    "prossimo_tentativo_il" TIMESTAMP(3),
    "ultimo_errore_codice" VARCHAR(50),
    "ultimo_errore_messaggio" VARCHAR(500),
    "richiesta_da" UUID,
    "inviata_il" TIMESTAMP(3),
    "chiusa_il" TIMESTAMP(3),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trasmissioni_sdi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trasmissioni_sdi_provider_ammesso" CHECK ("provider" IN ('fake', 'openapi', 'invoicetronic')),
    CONSTRAINT "trasmissioni_sdi_ambiente_ammesso" CHECK ("ambiente" IN ('SANDBOX', 'PRODUZIONE')),
    CONSTRAINT "trasmissioni_sdi_sha256_hex" CHECK ("xml_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "trasmissioni_sdi_tentativi_non_negativi" CHECK ("tentativi" >= 0),
    CONSTRAINT "trasmissioni_sdi_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "trasmissioni_sdi_provider_se_inviata" CHECK (
      "stato" NOT IN ('INVIATA', 'CONSEGNATA', 'NON_CONSEGNATA', 'SCARTATA', 'ACCETTATA', 'RIFIUTATA', 'DECORSI_TERMINI', 'NON_RECAPITABILE')
      OR "id_provider" IS NOT NULL),
    CONSTRAINT "trasmissioni_sdi_errore_se_errore_invio" CHECK ("stato" <> 'ERRORE_INVIO' OR "ultimo_errore_codice" IS NOT NULL),
    CONSTRAINT "trasmissioni_sdi_firmato_coerente" CHECK (("file_firmato" IS NULL) = ("file_firmato_sha256" IS NULL))
);

CREATE TABLE "notifiche_sdi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trasmissione_id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "esito_committente" VARCHAR(4),
    "codici_errore" TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    "data_ricezione_sdi" TIMESTAMP(3),
    "ricevuta_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file" BYTEA,
    "file_sha256" CHAR(64),
    "fonte" VARCHAR(10) NOT NULL,
    "chiave_dedup" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifiche_sdi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifiche_sdi_tipo_ammesso" CHECK ("tipo" IN ('RC', 'NS', 'MC', 'NE', 'DT', 'AT', 'SE', 'ERRORE_PROVIDER')),
    CONSTRAINT "notifiche_sdi_esito_solo_ne" CHECK ("esito_committente" IS NULL OR ("tipo" = 'NE' AND "esito_committente" IN ('EC01', 'EC02'))),
    CONSTRAINT "notifiche_sdi_fonte_ammessa" CHECK ("fonte" IN ('WEBHOOK', 'POLLING', 'INVIO')),
    CONSTRAINT "notifiche_sdi_file_coerente" CHECK (("file" IS NULL) = ("file_sha256" IS NULL)),
    CONSTRAINT "notifiche_sdi_chiave_non_vuota" CHECK (btrim("chiave_dedup") <> '')
);

CREATE TABLE "eventi_sdi_ricevuti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "id_evento_provider" VARCHAR(100) NOT NULL,
    "corpo" JSONB NOT NULL,
    "ricevuto_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elaborato_il" TIMESTAMP(3),
    "esito_elaborazione" VARCHAR(200),

    CONSTRAINT "eventi_sdi_ricevuti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eventi_sdi_ricevuti_provider_ammesso" CHECK ("provider" IN ('fake', 'openapi', 'invoicetronic'))
);

-- Indici e unici (prima delle chiavi esterne composite, che li usano) -------------------

CREATE UNIQUE INDEX "configurazioni_sdi_tenant_id_key" ON "configurazioni_sdi"("tenant_id");
CREATE UNIQUE INDEX "configurazioni_sdi_webhook_token_sha256_key" ON "configurazioni_sdi"("webhook_token_sha256");

CREATE UNIQUE INDEX "trasmissioni_sdi_id_tenant_id_key" ON "trasmissioni_sdi"("id", "tenant_id");
-- Una sola trasmissione «viva» per documento: presidio contro il doppio invio. Prisma non conosce il WHERE:
-- l'indice vive solo in SQL (come `documenti_fattura_numero_definitivo`).
CREATE UNIQUE INDEX "trasmissioni_sdi_una_viva" ON "trasmissioni_sdi"("tenant_id", "documento_id") WHERE "stato" NOT IN ('ERRORE_INVIO', 'SCARTATA');
CREATE INDEX "trasmissioni_sdi_tenant_id_stato_prossimo_tentativo_il_idx" ON "trasmissioni_sdi"("tenant_id", "stato", "prossimo_tentativo_il");
CREATE INDEX "trasmissioni_sdi_tenant_id_documento_id_idx" ON "trasmissioni_sdi"("tenant_id", "documento_id");

CREATE UNIQUE INDEX "notifiche_sdi_tenant_id_trasmissione_id_chiave_dedup_key" ON "notifiche_sdi"("tenant_id", "trasmissione_id", "chiave_dedup");
CREATE INDEX "notifiche_sdi_tenant_id_trasmissione_id_idx" ON "notifiche_sdi"("tenant_id", "trasmissione_id");

CREATE UNIQUE INDEX "eventi_sdi_ricevuti_tenant_id_provider_id_evento_provider_key" ON "eventi_sdi_ricevuti"("tenant_id", "provider", "id_evento_provider");
CREATE INDEX "eventi_sdi_ricevuti_tenant_id_elaborato_il_idx" ON "eventi_sdi_ricevuti"("tenant_id", "elaborato_il");

-- Chiavi esterne -----------------------------------------------------------------------

ALTER TABLE "configurazioni_sdi" ADD CONSTRAINT "configurazioni_sdi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trasmissioni_sdi" ADD CONSTRAINT "trasmissioni_sdi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trasmissioni_sdi" ADD CONSTRAINT "trasmissioni_sdi_documento_fkey" FOREIGN KEY ("documento_id", "tenant_id") REFERENCES "documenti_fattura"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "notifiche_sdi" ADD CONSTRAINT "notifiche_sdi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifiche_sdi" ADD CONSTRAINT "notifiche_sdi_trasmissione_fkey" FOREIGN KEY ("trasmissione_id", "tenant_id") REFERENCES "trasmissioni_sdi"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "eventi_sdi_ricevuti" ADD CONSTRAINT "eventi_sdi_ricevuti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigger ------------------------------------------------------------------------------
-- Stessa eccezione dichiarata alla regola «niente trigger» della 4.4a: la macchina a stati e il congelamento
-- dei dati dell'invio devono valere anche per chi scrive in SQL.
--
-- Stati «dopo l'invio»: INVIATA e le notifiche. Lo stato e' CALCOLATO dall'insieme delle notifiche, quindi fra
-- gli stati dopo l'invio (esclusa INVIATA, mai ripresa) e' ammesso ogni passaggio; SCARTATA e ERRORE_INVIO sono
-- terminali; non si torna mai a uno stato precedente all'invio.

CREATE FUNCTION trasmissioni_sdi_transizioni() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_dopo_invio "stato_trasmissione_sdi"[] := ARRAY['CONSEGNATA', 'NON_CONSEGNATA', 'ACCETTATA', 'RIFIUTATA', 'DECORSI_TERMINI', 'NON_RECAPITABILE', 'SCARTATA']::"stato_trasmissione_sdi"[];
  v_ammessa boolean;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.documento_id IS DISTINCT FROM OLD.documento_id
     OR NEW.direzione IS DISTINCT FROM OLD.direzione
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
     OR NEW.nome_file IS DISTINCT FROM OLD.nome_file
     OR NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256 THEN
    RAISE EXCEPTION 'la trasmissione SDI % non cambia documento, provider, nome file ne impronta dell''XML', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.stato = OLD.stato THEN
    -- Una trasmissione chiusa per errore o scarto non si modifica piu'.
    IF OLD.stato IN ('ERRORE_INVIO', 'SCARTATA') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'la trasmissione SDI % e'' chiusa (%): non si modifica', OLD.id, OLD.stato
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_ammessa := CASE OLD.stato
    WHEN 'DA_INVIARE' THEN NEW.stato = 'IN_INVIO'
    WHEN 'IN_INVIO' THEN NEW.stato IN ('INVIATA', 'DA_INVIARE', 'ERRORE_INVIO', 'INCERTA')
    WHEN 'INCERTA' THEN NEW.stato IN ('INVIATA', 'DA_INVIARE')
    WHEN 'INVIATA' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'CONSEGNATA' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'NON_CONSEGNATA' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'ACCETTATA' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'RIFIUTATA' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'DECORSI_TERMINI' THEN NEW.stato = ANY (v_dopo_invio)
    WHEN 'NON_RECAPITABILE' THEN NEW.stato = ANY (v_dopo_invio)
    ELSE false
  END;
  IF NOT v_ammessa THEN
    RAISE EXCEPTION 'transizione SDI non ammessa: % -> % (trasmissione %)', OLD.stato, NEW.stato, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trasmissioni_sdi_transizioni BEFORE UPDATE ON trasmissioni_sdi
  FOR EACH ROW EXECUTE FUNCTION trasmissioni_sdi_transizioni();

CREATE FUNCTION eventi_sdi_ricevuti_solo_elaborazione() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.id_evento_provider IS DISTINCT FROM OLD.id_evento_provider
     OR NEW.corpo IS DISTINCT FROM OLD.corpo
     OR NEW.ricevuto_il IS DISTINCT FROM OLD.ricevuto_il THEN
    RAISE EXCEPTION 'l''evento SDI % e'' un dato grezzo: si aggiorna solo l''esito di elaborazione', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER eventi_sdi_ricevuti_solo_elaborazione BEFORE UPDATE ON eventi_sdi_ricevuti
  FOR EACH ROW EXECUTE FUNCTION eventi_sdi_ricevuti_solo_elaborazione();

-- RLS, in fondo --------------------------------------------------------------------------

ALTER TABLE "configurazioni_sdi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configurazioni_sdi" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "configurazioni_sdi"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "configurazioni_sdi" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "trasmissioni_sdi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trasmissioni_sdi" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "trasmissioni_sdi"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "trasmissioni_sdi" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "notifiche_sdi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifiche_sdi" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "notifiche_sdi"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "notifiche_sdi" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "eventi_sdi_ricevuti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eventi_sdi_ricevuti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "eventi_sdi_ricevuti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "eventi_sdi_ricevuti" FOR SELECT TO wasteflow_lettura USING (true);

-- Privilegi: `notifiche_sdi` e' di solo inserimento (le ricevute sono documentazione fiscale). La REVOKE
-- vale se i ruoli esistono gia'; altrimenti la applica `ops/db-ruoli.sh` (`v_solo_inserimento`).
DO $privilegi$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "notifiche_sdi" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$privilegi$;
