-- Fase 2 pezzo 8 (D4, D5, D21): anagrafica e codice MUD delle unita' locali.
--
-- Cosa fa, su `rentri_unita_locali` (nessuna tabella nuova: la RLS della tabella resta quella di sempre):
--  1. aggiunge indirizzo, civico, CAP, comune, provincia e numero di addetti della sede (nullable,
--     inseriti a mano dalla pagina delle unita' locali: servono al blocco "unita' locale" del record AA);
--  2. aggiunge `progressivo_mud`, il codice dell'unita' locale nel file MUD (alfa 15, progressivo numerico),
--     con backfill: per ogni azienda la principale prende 1, cioe' il codice che il file ha sempre usato,
--     le altre seguono per data di creazione (poi id);
--  3. indice unico (tenant_id, progressivo_mud);
--  4. funzione + trigger BEFORE INSERT che assegnano alle sedi nuove il massimo dell'azienda + 1.
--
-- Perche' un trigger: il codice deve esistere per qualunque percorso di inserimento (create, upsert da
-- RENTRI, createMany) senza toccare i servizi RENTRI.
--
-- Note sul trigger:
--  - la funzione e' VOLATILE (scritto esplicitamente): cosi' un INSERT di piu' righe vede le righe
--    precedenti dello stesso comando e assegna codici consecutivi;
--  - il massimo si calcola sotto pg_advisory_xact_lock sulla chiave (azienda), per non assegnare lo
--    stesso codice a due inserimenti concorrenti;
--  - la funzione gira come chi inserisce: con la RLS vede solo le righe dell'azienda del contesto, che
--    coincide con NEW.tenant_id (altrimenti l'INSERT e' gia' rifiutato dalla policy); il ruolo di
--    sistema ha BYPASSRLS e il filtro su tenant_id tiene comunque corretto il calcolo;
--  - cambiare la principale NON cambia i codici;
--  - codice liberato: se si cancella la sede col codice piu' alto, la sede creata dopo riprende quel
--    codice. E' innocuo: una sede si cancella solo se il suo registro non ha movimenti, quindi non e'
--    mai stata dichiarata.
--
-- Eseguita da `wasteflow` (superuser): il backfill non e' soggetto a FORCE ROW LEVEL SECURITY.
-- Nessun GRANT: valgono i default privileges.
--
-- Ripristino a mano (in quest'ordine):
--   DROP TRIGGER rentri_unita_locali_progressivo_mud ON rentri_unita_locali;
--   DROP FUNCTION rentri_unita_locali_assegna_progressivo_mud();
--   DROP INDEX rentri_unita_locali_tenant_progressivo_mud_key;
--   ALTER TABLE rentri_unita_locali
--     DROP CONSTRAINT rentri_unita_locali_cap_check,
--     DROP CONSTRAINT rentri_unita_locali_provincia_check,
--     DROP CONSTRAINT rentri_unita_locali_numero_addetti_check,
--     DROP CONSTRAINT rentri_unita_locali_progressivo_mud_check,
--     DROP COLUMN indirizzo, DROP COLUMN civico, DROP COLUMN cap, DROP COLUMN comune,
--     DROP COLUMN provincia, DROP COLUMN numero_addetti, DROP COLUMN progressivo_mud;
-- I codici gia' scritti in file MUD presentati non vanno rinumerati a mano.

ALTER TABLE "rentri_unita_locali"
  ADD COLUMN "indirizzo" VARCHAR(255),
  ADD COLUMN "civico" VARCHAR(20),
  ADD COLUMN "cap" VARCHAR(5),
  ADD COLUMN "comune" VARCHAR(100),
  ADD COLUMN "provincia" VARCHAR(2),
  ADD COLUMN "numero_addetti" INTEGER,
  ADD COLUMN "progressivo_mud" INTEGER;

ALTER TABLE "rentri_unita_locali"
  ADD CONSTRAINT "rentri_unita_locali_cap_check" CHECK ("cap" ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "rentri_unita_locali_provincia_check" CHECK ("provincia" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "rentri_unita_locali_numero_addetti_check" CHECK ("numero_addetti" >= 0),
  ADD CONSTRAINT "rentri_unita_locali_progressivo_mud_check" CHECK ("progressivo_mud" > 0);

-- Backfill: la principale prende 1, le altre seguono per data di creazione, per azienda.
UPDATE "rentri_unita_locali" u
SET "progressivo_mud" = n.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "principale" DESC, "created_at", "id") AS rn
  FROM "rentri_unita_locali"
) n
WHERE u."id" = n."id";

CREATE UNIQUE INDEX "rentri_unita_locali_tenant_progressivo_mud_key"
  ON "rentri_unita_locali" ("tenant_id", "progressivo_mud");

CREATE FUNCTION "rentri_unita_locali_assegna_progressivo_mud"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW."progressivo_mud" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('ul-progressivo-mud|' || NEW."tenant_id"::text));
    SELECT COALESCE(MAX("progressivo_mud"), 0) + 1
      INTO NEW."progressivo_mud"
      FROM "rentri_unita_locali"
     WHERE "tenant_id" = NEW."tenant_id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rentri_unita_locali_progressivo_mud"
  BEFORE INSERT ON "rentri_unita_locali"
  FOR EACH ROW EXECUTE FUNCTION "rentri_unita_locali_assegna_progressivo_mud"();
