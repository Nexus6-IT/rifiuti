-- eREGI E6 (M2): esportazioni XML del registro con la catena dei digest.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea l'enum `stato_esportazione_registro_rentri`;
--   2. aggiunge a `registri_rifiuti` le quattro colonne dell'eREGI scaricato da RENTRI (XML verbatim,
--      digest del `Reference URI="#eREGI-CS-0"`, `DataRichiesta`, data del download) con il CHECK
--      «tutte o nessuna» e un trigger che, con almeno un'esportazione, ne impedisce la modifica
--      (il digest dell'eREGI e' il primo `Ref` della catena: cambiarlo la romperebbe);
--   3. crea `esportazioni_registro_rentri`: una riga per file XML firmato generato (compresso gzip),
--      con intervallo di progressivi, digest della firma, impronta del certificato, stato e messaggi
--      della validazione; CHECK su intervallo, numero di registrazioni, coerenza firma/digest;
--   4. indici e chiavi esterne: azienda CASCADE; registro e precedente con FK composta NO ACTION
--      (controllo a fine statement: la cascata dell'azienda toglie registri ed esportazioni insieme,
--      con RESTRICT non passerebbe). La precedente e' legata anche al registro. Unici: una sola
--      esportazione per (registro, anno, progressivo_a) = idempotenza; una sola successiva per
--      esportazione; una sola «prima» per registro (indice parziale: Prisma non conosce il WHERE);
--   5. trigger: i dati del file non si modificano (cambiano solo stato, transazione, messaggi,
--      updated_at); il DELETE diretto e' vietato, la cascata dell'azienda passa;
--   6. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` in FONDO.
--
-- Additiva: la tabella nasce vuota, le colonne sono nullable, nessun backfill. Nessun GRANT:
-- `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges di `ops/db-ruoli.sh`.
--
-- Rollback (a mano, solo se non esistono esportazioni da conservare: ogni esportazione e' un file
-- firmato che vale come registro, controllare prima `SELECT count(*) FROM esportazioni_registro_rentri`):
--   DROP TABLE esportazioni_registro_rentri;
--   DROP FUNCTION esportazioni_registro_rentri_immutabile(), esportazioni_registro_rentri_no_delete();
--   DROP TYPE stato_esportazione_registro_rentri;
--   DROP TRIGGER registri_rifiuti_ereg_immutabile ON registri_rifiuti;
--   DROP FUNCTION registri_rifiuti_ereg_immutabile();
--   ALTER TABLE registri_rifiuti
--     DROP CONSTRAINT registri_rifiuti_ereg_completo_check,
--     DROP COLUMN ereg_xml, DROP COLUMN ereg_digest, DROP COLUMN ereg_data_richiesta,
--     DROP COLUMN ereg_scaricato_il;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261125100000_esportazioni_registro_rentri';

SET LOCAL lock_timeout = '5s';

-- 1. Enum.
CREATE TYPE "stato_esportazione_registro_rentri" AS ENUM (
  'GENERATA', 'IN_VALIDAZIONE', 'VALIDATA', 'VALIDATA_CON_AVVISI', 'RIFIUTATA',
  'VALIDAZIONE_NON_DISPONIBILE'
);

-- 2. eREGI sul registro.
ALTER TABLE "registri_rifiuti"
  ADD COLUMN "ereg_xml" TEXT,
  ADD COLUMN "ereg_digest" VARCHAR(100),
  ADD COLUMN "ereg_data_richiesta" TIMESTAMPTZ(3),
  ADD COLUMN "ereg_scaricato_il" TIMESTAMPTZ(3);

ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_ereg_completo_check"
  CHECK (
    ("ereg_xml" IS NULL AND "ereg_digest" IS NULL AND "ereg_data_richiesta" IS NULL AND "ereg_scaricato_il" IS NULL)
    OR ("ereg_xml" IS NOT NULL AND "ereg_digest" IS NOT NULL AND "ereg_data_richiesta" IS NOT NULL AND "ereg_scaricato_il" IS NOT NULL)
  );

-- 3. Tabella.
CREATE TABLE "esportazioni_registro_rentri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "registro_id" UUID NOT NULL,
  "anno" SMALLINT NOT NULL,
  "progressivo_da" INTEGER NOT NULL,
  "progressivo_a" INTEGER NOT NULL,
  "numero_registrazioni" INTEGER NOT NULL,
  "data_creazione" TIMESTAMPTZ(3) NOT NULL,
  "precedente_id" UUID,
  "digest_value" VARCHAR(100),
  "sha256_file" CHAR(64) NOT NULL,
  "xml" BYTEA NOT NULL,
  "firmato" BOOLEAN NOT NULL,
  "certificato_sha256" CHAR(64),
  "stato" "stato_esportazione_registro_rentri" NOT NULL DEFAULT 'GENERATA',
  "transazione_validazione_id" UUID,
  "messaggi" JSONB NOT NULL DEFAULT '[]',
  "creata_da" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "esportazioni_registro_rentri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "esportazioni_registro_rentri_anno_check" CHECK ("anno" BETWEEN 2000 AND 2100),
  CONSTRAINT "esportazioni_registro_rentri_progressivi_check"
    CHECK ("progressivo_da" >= 1 AND "progressivo_da" <= "progressivo_a"),
  CONSTRAINT "esportazioni_registro_rentri_numero_check"
    CHECK ("numero_registrazioni" = "progressivo_a" - "progressivo_da" + 1),
  CONSTRAINT "esportazioni_registro_rentri_firmato_check"
    CHECK ("firmato" = ("digest_value" IS NOT NULL)),
  CONSTRAINT "esportazioni_registro_rentri_certificato_check"
    CHECK (NOT "firmato" OR "certificato_sha256" IS NOT NULL),
  CONSTRAINT "esportazioni_registro_rentri_sha256_check"
    CHECK ("sha256_file" ~ '^[0-9a-f]{64}$' AND ("certificato_sha256" IS NULL OR "certificato_sha256" ~ '^[0-9a-f]{64}$'))
);

-- 4. Unici, indici e chiavi esterne.
CREATE UNIQUE INDEX "esportazioni_registro_rentri_id_tenant_id_key"
  ON "esportazioni_registro_rentri"("id", "tenant_id");
CREATE UNIQUE INDEX "esportazioni_registro_rentri_id_registro_tenant_key"
  ON "esportazioni_registro_rentri"("id", "registro_id", "tenant_id");
CREATE UNIQUE INDEX "esportazioni_registro_rentri_registro_anno_a_key"
  ON "esportazioni_registro_rentri"("registro_id", "anno", "progressivo_a");
CREATE UNIQUE INDEX "esportazioni_registro_rentri_precedente_id_key"
  ON "esportazioni_registro_rentri"("precedente_id");
-- Una sola «prima» esportazione per registro (la catena non si biforca all'origine). Prisma non conosce il WHERE.
CREATE UNIQUE INDEX "esportazioni_registro_rentri_prima_key"
  ON "esportazioni_registro_rentri"("registro_id") WHERE "precedente_id" IS NULL;
CREATE INDEX "esportazioni_registro_rentri_tenant_id_idx"
  ON "esportazioni_registro_rentri"("tenant_id");
CREATE INDEX "esportazioni_registro_rentri_registro_creata_idx"
  ON "esportazioni_registro_rentri"("registro_id", "created_at");

ALTER TABLE "esportazioni_registro_rentri"
  ADD CONSTRAINT "esportazioni_registro_rentri_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esportazioni_registro_rentri"
  ADD CONSTRAINT "esportazioni_registro_rentri_registro_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "esportazioni_registro_rentri"
  ADD CONSTRAINT "esportazioni_registro_rentri_precedente_fkey"
  FOREIGN KEY ("precedente_id", "registro_id", "tenant_id")
  REFERENCES "esportazioni_registro_rentri"("id", "registro_id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 5. Trigger. Fuori da Prisma (`migrate diff` non li confronta).
-- Il file e la catena non si toccano: cambiano solo stato, transazione di validazione, messaggi e
-- updated_at.
CREATE FUNCTION esportazioni_registro_rentri_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.registro_id IS DISTINCT FROM OLD.registro_id
     OR NEW.anno IS DISTINCT FROM OLD.anno
     OR NEW.progressivo_da IS DISTINCT FROM OLD.progressivo_da
     OR NEW.progressivo_a IS DISTINCT FROM OLD.progressivo_a
     OR NEW.numero_registrazioni IS DISTINCT FROM OLD.numero_registrazioni
     OR NEW.data_creazione IS DISTINCT FROM OLD.data_creazione
     OR NEW.precedente_id IS DISTINCT FROM OLD.precedente_id
     OR NEW.digest_value IS DISTINCT FROM OLD.digest_value
     OR NEW.sha256_file IS DISTINCT FROM OLD.sha256_file
     OR NEW.xml IS DISTINCT FROM OLD.xml
     OR NEW.firmato IS DISTINCT FROM OLD.firmato
     OR NEW.certificato_sha256 IS DISTINCT FROM OLD.certificato_sha256
     OR NEW.creata_da IS DISTINCT FROM OLD.creata_da
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'esportazioni_registro_rentri: dato immutabile (il file firmato e la catena non si modificano)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "esportazioni_registro_rentri_immutabile"
  BEFORE UPDATE ON "esportazioni_registro_rentri"
  FOR EACH ROW EXECUTE FUNCTION esportazioni_registro_rentri_immutabile();

-- DELETE diretto vietato (profondita' di trigger 1). La cascata dell'azienda e' un'azione RI: il
-- trigger gira a profondita' > 1 e deve passare, altrimenti l'azienda non si cancellerebbe.
-- NB: il bypass vale per OGNI DELETE a profondita' > 1: nessun trigger futuro deve cancellare righe
-- di questa tabella.
CREATE FUNCTION esportazioni_registro_rentri_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'esportazioni_registro_rentri: non si cancella (e un file firmato della catena)'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "esportazioni_registro_rentri_no_delete"
  BEFORE DELETE ON "esportazioni_registro_rentri"
  FOR EACH ROW EXECUTE FUNCTION esportazioni_registro_rentri_no_delete();

-- L'eREGI del registro non cambia piu' dopo la prima esportazione: il suo digest e' il `Ref` iniziale
-- di tutta la catena. Scatta solo se l'UPDATE nomina una delle tre colonne; `ereg_scaricato_il` resta libera.
CREATE FUNCTION registri_rifiuti_ereg_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.ereg_xml IS DISTINCT FROM OLD.ereg_xml
      OR NEW.ereg_digest IS DISTINCT FROM OLD.ereg_digest
      OR NEW.ereg_data_richiesta IS DISTINCT FROM OLD.ereg_data_richiesta)
     AND EXISTS (
       SELECT 1 FROM esportazioni_registro_rentri e
       WHERE e.registro_id = OLD.id AND e.tenant_id = OLD.tenant_id
     ) THEN
    RAISE EXCEPTION 'registri_rifiuti: eREGI immutabile (esiste almeno un''esportazione che ne cita il digest)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "registri_rifiuti_ereg_immutabile"
  BEFORE UPDATE OF "ereg_xml", "ereg_digest", "ereg_data_richiesta" ON "registri_rifiuti"
  FOR EACH ROW EXECUTE FUNCTION registri_rifiuti_ereg_immutabile();

-- 6. RLS, in fondo (stessa forma della Fase 1).
ALTER TABLE "esportazioni_registro_rentri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "esportazioni_registro_rentri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "esportazioni_registro_rentri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "esportazioni_registro_rentri" FOR SELECT TO wasteflow_lettura USING (true);
