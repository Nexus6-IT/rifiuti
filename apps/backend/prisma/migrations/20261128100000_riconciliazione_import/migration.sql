-- Import WinWaste, I8 (piano import 3.6): riconciliazione di un lotto importato.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea gli enum `stato_rapporto_riconciliazione`, `tipo_campione_riconciliazione` e
--      `esito_campione_riconciliazione`;
--   2. crea `rapporti_riconciliazione`: una riga per VERSIONE del rapporto (insert-only per quanto
--      riguarda `esiti`, i lotti e l'impronta: ogni accettazione di una differenza o ricalcolo e' una
--      riga nuova con `versione + 1`; l'unica modifica ammessa e' APERTO -> CHIUSO, solo sull'ultima
--      versione). La prima versione e' la radice (`radice_id = id`);
--   3. crea `campioni_riconciliazione`: le righe scelte a caso (movimenti e FIR) con l'esito dato a mano.
--      Si legano alla radice, quindi valgono per tutte le versioni. L'esito si puo' dare o correggere
--      finche' il rapporto non e' chiuso;
--   4. crea `verbali_riconciliazione`: il PDF firmato e la sua impronta SHA-256 (insert-only);
--   5. trigger: immutabilita' dei rapporti e dei campioni dopo la chiusura, nessuna nuova versione dopo la
--      chiusura, nessun DELETE diretto (la cascata dell'azienda passa);
--   6. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` in FONDO.
--
-- Additiva: tre tabelle nuove e vuote, nessun backfill. Nessun GRANT: i ruoli li ricevono dai default
-- privileges di `ops/db-ruoli.sh` (le tabelle sono elencate in `prisma/sql/ruoli-db.sql`).
-- `lotti_import_ids` non ha chiave esterna (Postgres non la ammette su un array): i lotti non si
-- cancellano mai (`lotti_import` e' in `v_senza_cancellazione`), l'annullamento (I10) li lascia come
-- `ANNULLATO`.
--
-- Ripristino a mano (solo se non esistono rapporti da conservare: sono la traccia dello sblocco, I9):
--   DROP TABLE verbali_riconciliazione, campioni_riconciliazione, rapporti_riconciliazione;
--   DROP FUNCTION rapporti_riconciliazione_immutabile(), rapporti_riconciliazione_nuova_versione(),
--     riconciliazione_no_modifica(), riconciliazione_no_delete(), campioni_riconciliazione_immutabile();
--   DROP TYPE stato_rapporto_riconciliazione, tipo_campione_riconciliazione,
--     esito_campione_riconciliazione;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261128100000_riconciliazione_import';
--
-- Da migration fallita (P3009): lo script e' transazionale; se `to_regclass('public.rapporti_riconciliazione')`
-- e' NULL: `npx prisma migrate resolve --rolled-back 20261128100000_riconciliazione_import`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

-- 1. Enum.
CREATE TYPE "stato_rapporto_riconciliazione" AS ENUM ('APERTO', 'CHIUSO');
CREATE TYPE "tipo_campione_riconciliazione" AS ENUM ('MOVIMENTO', 'FIR');
CREATE TYPE "esito_campione_riconciliazione" AS ENUM ('CORRISPONDE', 'NON_CORRISPONDE');

-- 2. Rapporti (una riga per versione).
CREATE TABLE "rapporti_riconciliazione" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "radice_id" UUID NOT NULL,
  "versione" INTEGER NOT NULL,
  "lotti_import_ids" UUID[] NOT NULL,
  "esiti" JSONB NOT NULL,
  "hash_rapporto" CHAR(64) NOT NULL,
  "hash_sorgente" CHAR(64) NOT NULL,
  "stato" "stato_rapporto_riconciliazione" NOT NULL DEFAULT 'APERTO',
  "creato_da" UUID,
  "chiuso_da" UUID,
  "chiuso_il" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rapporti_riconciliazione_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rapporti_riconciliazione_versione_check" CHECK ("versione" >= 1),
  CONSTRAINT "rapporti_riconciliazione_radice_check" CHECK (("versione" = 1) = ("radice_id" = "id")),
  CONSTRAINT "rapporti_riconciliazione_lotti_check" CHECK (cardinality("lotti_import_ids") >= 1),
  CONSTRAINT "rapporti_riconciliazione_hash_check"
    CHECK ("hash_rapporto" ~ '^[0-9a-f]{64}$' AND "hash_sorgente" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "rapporti_riconciliazione_chiusura_check"
    CHECK (("stato" = 'CHIUSO') = ("chiuso_il" IS NOT NULL AND "chiuso_da" IS NOT NULL))
);

CREATE UNIQUE INDEX "rapporti_riconciliazione_id_tenant_id_key"
  ON "rapporti_riconciliazione"("id", "tenant_id");
CREATE UNIQUE INDEX "rapporti_riconciliazione_radice_versione_key"
  ON "rapporti_riconciliazione"("radice_id", "versione");
CREATE INDEX "rapporti_riconciliazione_tenant_id_idx" ON "rapporti_riconciliazione"("tenant_id");

ALTER TABLE "rapporti_riconciliazione"
  ADD CONSTRAINT "rapporti_riconciliazione_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- La radice e' la prima versione (si cita da sola: la FK si controlla a fine statement).
ALTER TABLE "rapporti_riconciliazione"
  ADD CONSTRAINT "rapporti_riconciliazione_radice_fkey"
  FOREIGN KEY ("radice_id", "tenant_id") REFERENCES "rapporti_riconciliazione"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 3. Campioni.
CREATE TABLE "campioni_riconciliazione" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rapporto_radice_id" UUID NOT NULL,
  "tipo" "tipo_campione_riconciliazione" NOT NULL,
  "riferimento_id" UUID NOT NULL,
  "legacy_key" VARCHAR(200),
  "esito" "esito_campione_riconciliazione",
  "nota" VARCHAR(500),
  "esito_da" UUID,
  "esito_il" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campioni_riconciliazione_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campioni_riconciliazione_esito_check" CHECK (("esito" IS NULL) = ("esito_il" IS NULL))
);

CREATE UNIQUE INDEX "campioni_riconciliazione_riferimento_key"
  ON "campioni_riconciliazione"("rapporto_radice_id", "tipo", "riferimento_id");
CREATE INDEX "campioni_riconciliazione_tenant_id_idx" ON "campioni_riconciliazione"("tenant_id");

ALTER TABLE "campioni_riconciliazione"
  ADD CONSTRAINT "campioni_riconciliazione_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campioni_riconciliazione"
  ADD CONSTRAINT "campioni_riconciliazione_rapporto_fkey"
  FOREIGN KEY ("rapporto_radice_id", "tenant_id") REFERENCES "rapporti_riconciliazione"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 4. Verbali firmati.
CREATE TABLE "verbali_riconciliazione" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rapporto_radice_id" UUID NOT NULL,
  "versione_rapporto" INTEGER NOT NULL,
  "nome_file" VARCHAR(255) NOT NULL,
  "mime" VARCHAR(100) NOT NULL,
  "dimensione" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "contenuto" BYTEA NOT NULL,
  "caricato_da" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verbali_riconciliazione_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verbali_riconciliazione_mime_check" CHECK ("mime" = 'application/pdf'),
  CONSTRAINT "verbali_riconciliazione_dimensione_check"
    CHECK ("dimensione" > 0 AND "dimensione" <= 10485760 AND "dimensione" = octet_length("contenuto")),
  CONSTRAINT "verbali_riconciliazione_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "verbali_riconciliazione_versione_check" CHECK ("versione_rapporto" >= 1)
);

CREATE UNIQUE INDEX "verbali_riconciliazione_sha256_key"
  ON "verbali_riconciliazione"("rapporto_radice_id", "sha256");
CREATE INDEX "verbali_riconciliazione_tenant_id_idx" ON "verbali_riconciliazione"("tenant_id");

ALTER TABLE "verbali_riconciliazione"
  ADD CONSTRAINT "verbali_riconciliazione_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verbali_riconciliazione"
  ADD CONSTRAINT "verbali_riconciliazione_rapporto_fkey"
  FOREIGN KEY ("rapporto_radice_id", "tenant_id") REFERENCES "rapporti_riconciliazione"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 5. Trigger. Fuori da Prisma (`migrate diff` non li confronta).

-- Un rapporto non si modifica: l'unica transizione e' APERTO -> CHIUSO (chiuso_da, chiuso_il), solo
-- sull'ultima versione della radice. CHIUSO e' terminale.
CREATE FUNCTION rapporti_riconciliazione_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.radice_id IS DISTINCT FROM OLD.radice_id
     OR NEW.versione IS DISTINCT FROM OLD.versione
     OR NEW.lotti_import_ids IS DISTINCT FROM OLD.lotti_import_ids
     OR NEW.esiti IS DISTINCT FROM OLD.esiti
     OR NEW.hash_rapporto IS DISTINCT FROM OLD.hash_rapporto
     OR NEW.hash_sorgente IS DISTINCT FROM OLD.hash_sorgente
     OR NEW.creato_da IS DISTINCT FROM OLD.creato_da
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rapporti_riconciliazione: dato immutabile (una modifica e'' una nuova versione)'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.stato = 'CHIUSO' THEN
    RAISE EXCEPTION 'rapporti_riconciliazione: un rapporto chiuso non cambia piu'''
      USING ERRCODE = '23514';
  END IF;
  IF NEW.stato = 'CHIUSO' AND EXISTS (
    SELECT 1 FROM rapporti_riconciliazione r
    WHERE r.radice_id = OLD.radice_id AND r.tenant_id = OLD.tenant_id AND r.versione > OLD.versione
  ) THEN
    RAISE EXCEPTION 'rapporti_riconciliazione: si chiude solo l''ultima versione'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "rapporti_riconciliazione_immutabile"
  BEFORE UPDATE ON "rapporti_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION rapporti_riconciliazione_immutabile();

-- Dopo la chiusura non nascono nuove versioni, e una nuova versione e' sempre la successiva (nessun
-- salto, nessun doppione: l'unico (radice, versione) lo garantisce).
CREATE FUNCTION rapporti_riconciliazione_nuova_versione() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ultima integer;
BEGIN
  IF NEW.versione = 1 THEN
    RETURN NEW;
  END IF;
  SELECT max(versione) INTO v_ultima FROM rapporti_riconciliazione
    WHERE radice_id = NEW.radice_id AND tenant_id = NEW.tenant_id;
  IF v_ultima IS NULL OR NEW.versione <> v_ultima + 1 THEN
    RAISE EXCEPTION 'rapporti_riconciliazione: la versione deve essere la successiva all''ultima'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rapporti_riconciliazione r
    WHERE r.radice_id = NEW.radice_id AND r.tenant_id = NEW.tenant_id AND r.stato = 'CHIUSO'
  ) THEN
    RAISE EXCEPTION 'rapporti_riconciliazione: il rapporto e'' chiuso, non si aggiungono versioni'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "rapporti_riconciliazione_nuova_versione"
  BEFORE INSERT ON "rapporti_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION rapporti_riconciliazione_nuova_versione();

-- I campioni: cambiano solo esito, nota, esito_da, esito_il, e solo finche' il rapporto non e' chiuso.
-- Il riferimento scelto non si tocca (la scelta e' riproducibile dal seme).
CREATE FUNCTION campioni_riconciliazione_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.rapporto_radice_id IS DISTINCT FROM OLD.rapporto_radice_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.riferimento_id IS DISTINCT FROM OLD.riferimento_id
     OR NEW.legacy_key IS DISTINCT FROM OLD.legacy_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'campioni_riconciliazione: il riferimento scelto non si modifica'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rapporti_riconciliazione r
    WHERE r.radice_id = OLD.rapporto_radice_id AND r.tenant_id = OLD.tenant_id AND r.stato = 'CHIUSO'
  ) THEN
    RAISE EXCEPTION 'campioni_riconciliazione: il rapporto e'' chiuso, l''esito non cambia piu'''
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "campioni_riconciliazione_immutabile"
  BEFORE UPDATE ON "campioni_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION campioni_riconciliazione_immutabile();

-- Il verbale non si modifica mai (UPDATE vietato per intero).
CREATE FUNCTION riconciliazione_no_modifica() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: insert-only, il verbale non si modifica', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "verbali_riconciliazione_no_update"
  BEFORE UPDATE ON "verbali_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION riconciliazione_no_modifica();

-- DELETE diretto vietato su tutte e tre (profondita' di trigger 1). La cascata dell'azienda e' un'azione
-- RI: il trigger gira a profondita' > 1 e passa, altrimenti l'azienda non si cancellerebbe.
-- NB: il bypass vale per OGNI DELETE a profondita' > 1: nessun trigger futuro deve cancellare righe di
-- queste tabelle.
CREATE FUNCTION riconciliazione_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION '%: non si cancella (e'' la traccia della riconciliazione)', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "rapporti_riconciliazione_no_delete"
  BEFORE DELETE ON "rapporti_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION riconciliazione_no_delete();
CREATE TRIGGER "campioni_riconciliazione_no_delete"
  BEFORE DELETE ON "campioni_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION riconciliazione_no_delete();
CREATE TRIGGER "verbali_riconciliazione_no_delete"
  BEFORE DELETE ON "verbali_riconciliazione"
  FOR EACH ROW EXECUTE FUNCTION riconciliazione_no_delete();

-- 6. RLS, in fondo (stessa forma della Fase 1).
ALTER TABLE "rapporti_riconciliazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rapporti_riconciliazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rapporti_riconciliazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "rapporti_riconciliazione" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "campioni_riconciliazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campioni_riconciliazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "campioni_riconciliazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "campioni_riconciliazione" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "verbali_riconciliazione" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verbali_riconciliazione" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "verbali_riconciliazione"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "verbali_riconciliazione" FOR SELECT TO wasteflow_lettura USING (true);
