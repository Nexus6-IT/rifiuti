-- Fase 2 pezzo 9 (F2-9): trasmissione del registro cronologico a RENTRI.
--
-- Cosa: la tabella `movimenti_trasmissione_rentri` (una riga per movimento trasmesso o in via di
-- trasmissione; nessuna riga = non trasmesso) e due colonne/vincoli su `registri_rifiuti`
-- (`invio_rentri_automatico_dal`, formato e unicita' per azienda dell'`identificativo_rentri`).
-- Perche': il programma deve poter dire per ogni annotazione se e' su RENTRI, senza mai
-- ritrasmettere per errore (una TRASMESSA e' immutabile e non si cancella).
-- Additiva: nessun backfill, la tabella nasce vuota, nessun invio retroattivo. Nessun GRANT:
-- `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges di `ops/db-ruoli.sh`.
--
-- Ordine: enum; lock_timeout; controllo di `identificativo_rentri` esistenti, CHECK, unico e colonna
-- su `registri_rifiuti`; tabella con CHECK; unici e indici; FK; funzioni e trigger; RLS.
--
-- Ripristino (a mano, solo per un database SENZA trasmissioni: vedi ops/README.md):
--   DROP TABLE movimenti_trasmissione_rentri;
--   DROP TYPE stato_trasmissione_rentri, origine_trasmissione_rentri;
--   ALTER TABLE registri_rifiuti
--     DROP CONSTRAINT registri_rifiuti_tenant_identificativo_rentri_key,
--     DROP CONSTRAINT registri_rifiuti_identificativo_rentri_check,
--     DROP COLUMN invio_rentri_automatico_dal;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261101100000_trasmissione_registro_rentri';

-- 1. Enum.
CREATE TYPE "stato_trasmissione_rentri" AS ENUM (
  'DA_TRASMETTERE', 'IN_INVIO', 'ATTESA_ESITO', 'TRASMESSA', 'RIFIUTATA',
  'NON_TRASMISSIBILE', 'INCERTA', 'GIA_SU_RENTRI'
);
CREATE TYPE "origine_trasmissione_rentri" AS ENUM ('MANUALE', 'AUTOMATICA', 'CORREZIONE', 'DICHIARATA');

-- 2. Registri: lock_timeout breve, controllo dei dati esistenti, poi colonna, CHECK e unico.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  n_valorizzati integer;
  n_fuori_formato integer;
BEGIN
  SELECT count(*) INTO n_valorizzati FROM "registri_rifiuti" WHERE "identificativo_rentri" IS NOT NULL;
  SELECT count(*) INTO n_fuori_formato FROM "registri_rifiuti"
    WHERE "identificativo_rentri" IS NOT NULL AND "identificativo_rentri" !~ '^R[0-9A-Z]{10}$';
  RAISE NOTICE 'registri_rifiuti con identificativo_rentri valorizzato: % (attesi 0)', n_valorizzati;
  IF n_fuori_formato > 0 THEN
    RAISE EXCEPTION 'F2-9: % registri hanno un identificativo_rentri fuori formato (atteso R + 10 caratteri maiuscoli alfanumerici): correggerli a mano prima della migration', n_fuori_formato;
  END IF;
END $$;

ALTER TABLE "registri_rifiuti"
  ADD COLUMN "invio_rentri_automatico_dal" TIMESTAMPTZ(3);

ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_identificativo_rentri_check"
  CHECK ("identificativo_rentri" IS NULL OR "identificativo_rentri" ~ '^R[0-9A-Z]{10}$');

-- Per azienda, non globale: un unico globale farebbe scoprire l'identificativo di un'altra azienda.
ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_tenant_identificativo_rentri_key"
  UNIQUE ("tenant_id", "identificativo_rentri");

-- 3. Tabella.
CREATE TABLE "movimenti_trasmissione_rentri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "movimento_id" UUID NOT NULL,
  "registro_id" UUID NOT NULL,
  "tipo" "waste_movement_type" NOT NULL,
  "stato" "stato_trasmissione_rentri" NOT NULL DEFAULT 'DA_TRASMETTERE',
  "origine" "origine_trasmissione_rentri" NOT NULL,
  "bloccato_invio" BOOLEAN NOT NULL DEFAULT false,
  "motivo_blocco" VARCHAR(500),
  "identificativo_rentri" VARCHAR(20),
  "transazione_id" UUID,
  "lotto_id" UUID,
  "prenotato_il" TIMESTAMPTZ(3),
  "trasmesso_il" TIMESTAMPTZ(3),
  "tentativi" INTEGER NOT NULL DEFAULT 0,
  "ultimo_errore" VARCHAR(1000),
  "messaggi" JSONB NOT NULL DEFAULT '[]',
  "accodato_da" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "movimenti_trasmissione_rentri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimenti_trasmissione_rentri_bloccato_coerente_check"
    CHECK ("stato" NOT IN ('TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA') OR "bloccato_invio"),
  CONSTRAINT "movimenti_trasmissione_rentri_coda_sbloccata_check"
    CHECK ("stato" <> 'DA_TRASMETTERE' OR NOT "bloccato_invio"),
  CONSTRAINT "movimenti_trasmissione_rentri_motivo_blocco_check"
    CHECK (NOT "bloccato_invio" OR "motivo_blocco" IS NOT NULL),
  CONSTRAINT "movimenti_trasmissione_rentri_attesa_transazione_check"
    CHECK ("stato" <> 'ATTESA_ESITO' OR "transazione_id" IS NOT NULL),
  CONSTRAINT "movimenti_trasmissione_rentri_identificativo_check"
    CHECK ("identificativo_rentri" IS NULL OR "identificativo_rentri" ~ '^M[0-9A-Z]{19}$')
);

-- 4. Unici e indici.
CREATE UNIQUE INDEX "movimenti_trasmissione_rentri_movimento_id_key"
  ON "movimenti_trasmissione_rentri"("movimento_id");
-- Ridondante a livello SQL (movimento_id e' gia' unico): serve a Prisma per la relazione 1:1 sui
-- campi esatti della FK composta.
CREATE UNIQUE INDEX "movimenti_trasmissione_rentri_movimento_chiave_key"
  ON "movimenti_trasmissione_rentri"("movimento_id", "registro_id", "tenant_id", "tipo");
CREATE UNIQUE INDEX "movimenti_trasmissione_rentri_id_tenant_id_key"
  ON "movimenti_trasmissione_rentri"("id", "tenant_id");
CREATE INDEX "movimenti_trasmissione_rentri_tenant_id_idx"
  ON "movimenti_trasmissione_rentri"("tenant_id");
CREATE INDEX "movimenti_trasmissione_rentri_registro_stato_idx"
  ON "movimenti_trasmissione_rentri"("registro_id", "stato");
CREATE INDEX "movimenti_trasmissione_rentri_transazione_id_idx"
  ON "movimenti_trasmissione_rentri"("transazione_id");

-- 5. FK. La composta lega la riga al movimento e fa coincidere registro, azienda e tipo; NO ACTION
-- (controllo a fine statement) come le altre FK composte verso waste_movements.
ALTER TABLE "movimenti_trasmissione_rentri"
  ADD CONSTRAINT "movimenti_trasmissione_rentri_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movimenti_trasmissione_rentri"
  ADD CONSTRAINT "movimenti_trasmissione_rentri_movimento_fkey"
  FOREIGN KEY ("movimento_id", "registro_id", "tenant_id", "tipo")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 6. Trigger. Fuori da Prisma (`migrate diff` non li confronta).
-- Immutabilita': una riga TRASMESSA o GIA_SU_RENTRI non cambia stato, blocco o movimento, e il suo
-- identificativo puo' solo passare da NULL a un valore. Sempre: movimento, registro, tipo e azienda
-- non cambiano.
CREATE FUNCTION movimenti_trasmissione_rentri_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.movimento_id IS DISTINCT FROM OLD.movimento_id
     OR NEW.registro_id IS DISTINCT FROM OLD.registro_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'movimenti_trasmissione_rentri: movimento, registro, tipo e azienda non si modificano'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.stato IN ('TRASMESSA', 'GIA_SU_RENTRI') THEN
    IF NEW.stato IS DISTINCT FROM OLD.stato
       OR NEW.bloccato_invio IS DISTINCT FROM OLD.bloccato_invio THEN
      RAISE EXCEPTION 'movimenti_trasmissione_rentri: una riga % non cambia stato ne si sblocca', OLD.stato
        USING ERRCODE = '23514';
    END IF;
    IF NEW.identificativo_rentri IS DISTINCT FROM OLD.identificativo_rentri
       AND OLD.identificativo_rentri IS NOT NULL THEN
      RAISE EXCEPTION 'movimenti_trasmissione_rentri: l''identificativo di una riga % passa solo da NULL a un valore', OLD.stato
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "movimenti_trasmissione_rentri_immutabile"
  BEFORE UPDATE ON "movimenti_trasmissione_rentri"
  FOR EACH ROW EXECUTE FUNCTION movimenti_trasmissione_rentri_immutabile();

-- Cancellazione: una riga che ha trasmesso (o e' in volo, incerta, dichiarata) non si cancella con
-- un DELETE diretto (profondita' di trigger 1). La cancellazione a cascata di un'azienda e' un'azione
-- RI: il trigger gira a profondita' > 1 e deve passare, altrimenti l'azienda non si cancellerebbe.
CREATE FUNCTION movimenti_trasmissione_rentri_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stato NOT IN ('DA_TRASMETTERE', 'RIFIUTATA', 'NON_TRASMISSIBILE')
     AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'movimenti_trasmissione_rentri: una riga % non si cancella', OLD.stato
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "movimenti_trasmissione_rentri_no_delete"
  BEFORE DELETE ON "movimenti_trasmissione_rentri"
  FOR EACH ROW EXECUTE FUNCTION movimenti_trasmissione_rentri_no_delete();

-- 7. RLS, in fondo (stessa forma della Fase 1).
ALTER TABLE "movimenti_trasmissione_rentri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movimenti_trasmissione_rentri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "movimenti_trasmissione_rentri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "movimenti_trasmissione_rentri" FOR SELECT TO wasteflow_lettura USING (true);
