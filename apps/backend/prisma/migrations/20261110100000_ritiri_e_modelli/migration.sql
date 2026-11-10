-- Fase 4 pezzo 7 (PR A, T1): ritiri programmati e modelli di stampa (proposta 4.7, §2).
-- Segue `20261108100000_righe_documento_centro_categoria`.
--
-- Cosa fa:
--   1. tre enum (`stato_ritiro`, `fascia_ritiro`, `ambito_modello_stampa`);
--   2. `UNIQUE (id, tenant_id)` su `produttori`, `trasportatori`, `destinatari` (additivo: serve alle
--      chiavi esterne composte dei ritiri);
--   3. la tabella `ritiri` (CHECK, chiavi esterne composte NO ACTION, unici, indici);
--   4. `firs.ritiro_id` (origine del FIR, campo C9): chiave esterna composta, indice di supporto,
--      indice unico parziale `firs_ritiro_attivo_key` (un solo FIR non annullato per ritiro) e
--      trigger `firs_ritiro_controlli` (INSERT solo su ritiro PROGRAMMATO, con `FOR SHARE`;
--      `ritiro_id` immutabile);
--   5. `company_templates`: `ambito`, `copie` (CHECK 1..4), `versione` e un solo modello
--      predefinito per ambito (indice unico parziale);
--   6. RLS ENABLE + FORCE su `ritiri` con `isolamento_azienda` e `sola_lettura`; niente DELETE ne'
--      TRUNCATE ai ruoli applicativi (se esistono: l'elenco duraturo sta in `ruoli-db.sql`).
-- Additiva: nessun DROP, nessuna colonna esistente toccata. `firs` e `company_templates` hanno gia'
-- la policy. Gli indici parziali e i trigger si scrivono solo in SQL (Prisma non conosce il WHERE).
--
-- Ripristino a mano: DROP TRIGGER firs_ritiro_controlli ON firs; DROP FUNCTION firs_ritiro_controlli();
-- DROP INDEX firs_ritiro_attivo_key, firs_tenant_ritiro_idx, company_templates_default_ambito_key;
-- ALTER TABLE firs DROP CONSTRAINT firs_ritiro_fkey; ALTER TABLE firs DROP COLUMN ritiro_id;
-- DROP TABLE ritiri; ALTER TABLE company_templates DROP COLUMN ambito, DROP COLUMN copie,
-- DROP COLUMN versione; DROP TYPE stato_ritiro, fascia_ritiro, ambito_modello_stampa; i tre
-- `*_id_tenant_id_key` si lasciano (innocui). Da migration fallita (P3009):
-- `npx prisma migrate resolve --rolled-back 20261110100000_ritiri_e_modelli`.
SET LOCAL lock_timeout = '5s';

-- 1. Enum -------------------------------------------------------------------------------------

CREATE TYPE "stato_ritiro" AS ENUM ('PROGRAMMATO', 'NON_ESEGUITO', 'ANNULLATO');
CREATE TYPE "fascia_ritiro" AS ENUM ('MATTINA', 'POMERIGGIO');
CREATE TYPE "ambito_modello_stampa" AS ENUM ('GENERALE', 'FIR', 'DISTINTA_RITIRI');

-- 2. Unici (id, tenant_id) sulle anagrafiche dei ruoli ----------------------------------------

CREATE UNIQUE INDEX "produttori_id_tenant_id_key" ON "produttori"("id", "tenant_id");
CREATE UNIQUE INDEX "trasportatori_id_tenant_id_key" ON "trasportatori"("id", "tenant_id");
CREATE UNIQUE INDEX "destinatari_id_tenant_id_key" ON "destinatari"("id", "tenant_id");

-- 3. Tabella dei ritiri -------------------------------------------------------------------------

CREATE TABLE "ritiri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "data_prevista" DATE NOT NULL,
    "fascia" "fascia_ritiro",
    "ordine_giro" SMALLINT,
    "produttore_id" UUID NOT NULL,
    "produttore_sede_id" UUID NOT NULL,
    "trasportatore_id" UUID NOT NULL,
    "destinatario_id" UUID NOT NULL,
    "destinatario_sede_id" UUID NOT NULL,
    "automezzo_id" UUID,
    "cer_code" VARCHAR(10) NOT NULL,
    "descrizione" VARCHAR(500) NOT NULL,
    "stato_fisico" VARCHAR(50),
    "caratteristiche_pericolo" TEXT,
    "numero_colli" INTEGER,
    "quantita_presunta" DECIMAL(10,2) NOT NULL,
    "unita" VARCHAR(10) NOT NULL DEFAULT 'KG',
    "tipo_operazione" "waste_operation_type" NOT NULL,
    "codice_operazione" VARCHAR(10),
    "provenienza" "provenienza_rifiuto",
    "tipo_tratta" "tipo_tratta",
    "annotazioni" TEXT,
    "note_interne" TEXT,
    "stato" "stato_ritiro" NOT NULL DEFAULT 'PROGRAMMATO',
    "motivo" VARCHAR(500),
    "serie_id" UUID,
    "chiave_idempotenza" UUID,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "creato_da" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "annullato_da" UUID,
    "annullato_il" TIMESTAMPTZ(3),

    CONSTRAINT "ritiri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ritiri_ordine_giro_positivo" CHECK ("ordine_giro" IS NULL OR "ordine_giro" > 0),
    CONSTRAINT "ritiri_quantita_positiva" CHECK ("quantita_presunta" > 0),
    CONSTRAINT "ritiri_numero_colli_non_negativo" CHECK ("numero_colli" IS NULL OR "numero_colli" >= 0),
    CONSTRAINT "ritiri_versione_positiva" CHECK ("versione" >= 1),
    -- Stato e motivo: NON_ESEGUITO e ANNULLATO vogliono un motivo non vuoto, PROGRAMMATO non ne ha.
    CONSTRAINT "ritiri_motivo_coerente" CHECK (
      ("stato" IN ('NON_ESEGUITO', 'ANNULLATO') AND "motivo" IS NOT NULL AND length(btrim("motivo")) > 0)
      OR ("stato" = 'PROGRAMMATO' AND "motivo" IS NULL)
    )
);

CREATE UNIQUE INDEX "ritiri_id_tenant_id_key" ON "ritiri"("id", "tenant_id");
-- La chiave del client copre le N righe di una ripetizione (una per data).
CREATE UNIQUE INDEX "ritiri_idempotenza_key" ON "ritiri"("tenant_id", "chiave_idempotenza", "data_prevista");
CREATE INDEX "ritiri_tenant_data_idx" ON "ritiri"("tenant_id", "data_prevista");
CREATE INDEX "ritiri_tenant_mezzo_data_idx" ON "ritiri"("tenant_id", "automezzo_id", "data_prevista", "ordine_giro");
CREATE INDEX "ritiri_tenant_produttore_idx" ON "ritiri"("tenant_id", "produttore_id");

ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_produttore_fkey" FOREIGN KEY ("produttore_id", "tenant_id") REFERENCES "produttori"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_produttore_sede_fkey" FOREIGN KEY ("produttore_sede_id", "tenant_id") REFERENCES "sedi_ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_trasportatore_fkey" FOREIGN KEY ("trasportatore_id", "tenant_id") REFERENCES "trasportatori"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_destinatario_fkey" FOREIGN KEY ("destinatario_id", "tenant_id") REFERENCES "destinatari"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_destinatario_sede_fkey" FOREIGN KEY ("destinatario_sede_id", "tenant_id") REFERENCES "sedi_ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_automezzo_fkey" FOREIGN KEY ("automezzo_id", "tenant_id") REFERENCES "automezzi"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 4. Origine del FIR (campo C9) -----------------------------------------------------------------

ALTER TABLE "firs" ADD COLUMN "ritiro_id" UUID;
ALTER TABLE "firs" ADD CONSTRAINT "firs_ritiro_fkey" FOREIGN KEY ("ritiro_id", "tenant_id") REFERENCES "ritiri"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Supporto alla chiave esterna (i controlli sul ritiro non scandiscono `firs`) e alla lista.
CREATE INDEX "firs_tenant_ritiro_idx" ON "firs"("tenant_id", "ritiro_id");
-- Un solo FIR non annullato per ritiro: segue da solo lo stato del FIR, anche quando l'annullamento
-- arriva da RENTRI. Due generazioni concorrenti: la seconda riceve 23505.
CREATE UNIQUE INDEX "firs_ritiro_attivo_key" ON "firs"("tenant_id", "ritiro_id")
  WHERE "ritiro_id" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE FUNCTION firs_ritiro_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_ritiro";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."ritiro_id" IS NOT NULL THEN
      -- FOR SHARE: va in conflitto con il FOR UPDATE di annullo/modifica/non eseguito del ritiro,
      -- che quindi si serializzano con questo INSERT (o il ritiro e' annullato senza FIR, o il FIR
      -- nasce e l'annullo risponde 409).
      SELECT "stato" INTO v_stato FROM "ritiri"
        WHERE "id" = NEW."ritiro_id" AND "tenant_id" = NEW."tenant_id" FOR SHARE;
      IF v_stato IS DISTINCT FROM 'PROGRAMMATO' THEN
        RAISE EXCEPTION 'RITIRO_NON_PROGRAMMATO';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."ritiro_id" IS DISTINCT FROM OLD."ritiro_id" THEN
    RAISE EXCEPTION 'firs: il ritiro di origine non si modifica';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER firs_ritiro_controlli BEFORE INSERT OR UPDATE ON "firs"
  FOR EACH ROW EXECUTE FUNCTION firs_ritiro_controlli();

-- 5. Modelli di stampa --------------------------------------------------------------------------

ALTER TABLE "company_templates"
  ADD COLUMN "ambito" "ambito_modello_stampa" NOT NULL DEFAULT 'GENERALE',
  ADD COLUMN "copie" SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN "versione" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_copie_ammesse" CHECK ("copie" BETWEEN 1 AND 4);
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_versione_positiva" CHECK ("versione" >= 1);

-- Prima dell'indice: se un'azienda avesse piu' predefiniti (nessun codice li usa), resta l'ultimo.
UPDATE "company_templates" t SET "is_default" = false
 WHERE t."is_default" AND EXISTS (
   SELECT 1 FROM "company_templates" a
    WHERE a."tenant_id" = t."tenant_id" AND a."ambito" = t."ambito" AND a."is_default"
      AND (a."updated_at", a."id") > (t."updated_at", t."id"));
CREATE UNIQUE INDEX "company_templates_default_ambito_key" ON "company_templates"("tenant_id", "ambito")
  WHERE "is_default";

-- 6. RLS e privilegi ----------------------------------------------------------------------------

ALTER TABLE "ritiri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ritiri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "ritiri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "ritiri" FOR SELECT TO wasteflow_lettura USING (true);

-- Un ritiro non si cancella (si annulla con motivo). Come nelle migration delle pese: il REVOKE
-- vale solo se i ruoli esistono gia'; l'elenco duraturo e' `v_senza_cancellazione` in `ruoli-db.sql`.
DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "ritiri" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
