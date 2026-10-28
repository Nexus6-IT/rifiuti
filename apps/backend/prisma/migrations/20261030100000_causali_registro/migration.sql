-- Fase 2 pezzo 5: causali del registro come dati (catalogo di sistema + personalizzazioni per azienda).
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea gli enum `ruolo_mud_causale` e `natura_causale_azienda`;
--   2. crea `causali_registro`: catalogo di sistema GLOBALE (niente tenant_id, niente RLS), chiave
--      (codice, verso), con i CHECK di coerenza verso/ruolo MUD/codice RENTRI/operazione;
--   3. toglie INSERT/UPDATE/DELETE/TRUNCATE a wasteflow_app e wasteflow_sistema su quella tabella
--      (la stessa regola sta in prisma/sql/ruoli-db.sql, che altrimenti la riconcederebbe a ogni
--      esecuzione di ops/db-ruoli.sh);
--   4. inserisce le 11 causali di oggi, con gli stessi codici (mapping RENTRI e ruolo MUD nei commenti);
--   5. segnala con un NOTICE i movimenti la cui coppia (causale, tipo) non e' nel catalogo;
--   6. crea `causali_registro_azienda`: causali PROPRIE (una riga per versione) e DISATTIVAZIONI di
--      causali di sistema, con CHECK, unici, chiavi esterne, indice parziale e il trigger
--      `causali_registro_azienda_controlli` (sovrapposizioni, immutabilita', versioni usate);
--   7. controlla che nessun movimento abbia gia' una causale `AZ_...` (il prefisso nasce qui) e poi
--      aggiunge a `waste_movements` la colonna `causale_azienda_id`, la chiave esterna composta
--      (NOT VALID + VALIDATE: la colonna e' tutta NULL), il CHECK
--      `waste_movements_causale_azienda_coerente` e l'indice;
--   8. RLS ENABLE + FORCE e policy `isolamento_azienda` / `sola_lettura` su
--      `causali_registro_azienda`, in FONDO (come la Fase 1).
--
-- Regola di immutabilita' del catalogo: `verso`, `ruolo_mud` e `operazione` di una riga di sistema
-- non cambiano mai. Un cambio futuro e' una NUOVA causale con un nuovo codice e la disattivazione
-- della vecchia (`attiva = false`). `codice_rentri` puo' essere corretto da una migration futura
-- SOLO finche' F2-9 non ha trasmesso nulla: dopo, una correzione cambierebbe il significato di
-- trasmissioni gia' fatte e va decisa in F2-9.
--
-- Nessun backfill: i movimenti esistenti non cambiano e il MUD degli anni passati resta identico.
--
-- Ripristino (a mano), in quest'ordine:
--   ALTER TABLE waste_movements DROP CONSTRAINT waste_movements_causale_azienda_coerente;
--   ALTER TABLE waste_movements DROP CONSTRAINT waste_movements_causale_azienda_fkey;
--   DROP INDEX waste_movements_causale_azienda_id_idx;
--   ALTER TABLE waste_movements DROP COLUMN causale_azienda_id;
--   DROP TABLE causali_registro_azienda;
--   DROP FUNCTION causali_registro_azienda_controlli();
--   DROP TABLE causali_registro;
--   DROP TYPE natura_causale_azienda; DROP TYPE ruolo_mud_causale;
-- Prima controllare `SELECT count(*) FROM causali_registro_azienda` e i movimenti con
-- `causale_azienda_id` non nullo (v. ops/README.md).

-- 1. Enum.
CREATE TYPE "ruolo_mud_causale" AS ENUM ('PRODOTTO', 'AVVIATO', 'RICEVUTO_DA_TERZI', 'ESCLUSO');
CREATE TYPE "natura_causale_azienda" AS ENUM ('PROPRIA', 'DISATTIVAZIONE');

-- 2. Catalogo di sistema (globale, senza RLS).
CREATE TABLE "causali_registro" (
    "codice" VARCHAR(100) NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    "descrizione" VARCHAR(200) NOT NULL,
    "ruolo_mud" "ruolo_mud_causale" NOT NULL,
    "codice_rentri" VARCHAR(5),
    "operazione" VARCHAR(1),
    "ordine" SMALLINT NOT NULL,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "causali_registro_pkey" PRIMARY KEY ("codice", "verso"),
    -- Il prefisso AZ_ e' riservato alle aziende: la collisione e' impossibile per costruzione.
    CONSTRAINT "causali_registro_codice_formato"
      CHECK ("codice" ~ '^[A-Z][A-Z0-9_]*$' AND "codice" !~ '^AZ_'),
    CONSTRAINT "causali_registro_ruolo_verso" CHECK (
      ("verso" = 'CARICO' AND "ruolo_mud" IN ('PRODOTTO', 'RICEVUTO_DA_TERZI', 'ESCLUSO'))
      OR ("verso" = 'SCARICO' AND "ruolo_mud" IN ('AVVIATO', 'ESCLUSO'))),
    -- TR e T*aT sono "CaricoScarico" nel contratto RENTRI: il registro non ha quel tipo di
    -- movimento (intermediari e trasportatori: Fase 4), quindi non sono ammessi.
    CONSTRAINT "causali_registro_codice_rentri_verso" CHECK (
      "codice_rentri" IS NULL
      OR ("verso" = 'CARICO' AND "codice_rentri" IN ('DT', 'NP', 'T*', 'RE'))
      OR ("verso" = 'SCARICO' AND "codice_rentri" IN ('I', 'aT', 'M'))),
    CONSTRAINT "causali_registro_operazione_coerente" CHECK (
      "operazione" IS NULL
      OR ("verso" = 'SCARICO' AND "ruolo_mud" = 'AVVIATO' AND "operazione" IN ('R', 'D')))
);

-- 3. Privilegi: il catalogo lo scrive solo la migration (owner). I default privileges di
-- ops/db-ruoli.sh hanno gia' dato CRUD ai due ruoli sulle tabelle nuove; qui si toglie. Solo se i
-- ruoli esistono (in sviluppo o nei test possono non esserci ancora).
DO $privilegi$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.causali_registro FROM %I', v_ruolo);
      EXECUTE format('GRANT SELECT ON TABLE public.causali_registro TO %I', v_ruolo);
    END IF;
  END LOOP;
END
$privilegi$;

-- 4. Le 11 causali di oggi. Descrizioni = etichette del frontend. Il ruolo MUD riproduce
-- esattamente le mappe di mud-regole.ts (le causali assenti dalle mappe sono ESCLUSO).
INSERT INTO "causali_registro"
  ("codice", "verso", "descrizione", "ruolo_mud", "codice_rentri", "operazione", "ordine")
VALUES
  -- DT: "prodotto o detenuto nell'unita' locale" (contratto RENTRI; WinWaste OPER 10 -> DT/C).
  ('PRODUZIONE_INTERNA', 'CARICO', 'Produzione interna', 'PRODOTTO', 'DT', NULL, 10),
  -- T* (DA CONFERMARE prima di F2-9): "ricevuto da terzi". Per un produttore puro, un rifiuto proprio
  -- prodotto altrove (cantiere, manutenzione) e portato nell'unita' locale sarebbe RE; oggi
  -- INGRESSO_ESTERNO copre entrambi i casi.
  ('INGRESSO_ESTERNO', 'CARICO', 'Ingresso da esterno', 'RICEVUTO_DA_TERZI', 'T*', NULL, 20),
  -- NULL: in RENTRI non esiste una causale di riclassificazione (sarebbe uno scarico e un carico
  -- con causali da decidere caso per caso).
  ('RICLASSIFICAZIONE', 'CARICO', 'Riclassificazione CER', 'ESCLUSO', NULL, NULL, 30),
  -- NULL: il caso "nuovo produttore" (NP) e' plausibile ma non certo per chi non e' un impianto
  -- autorizzato; F2-9 lo segnalera' come non trasmissibile finche' non e' deciso.
  ('RECUPERO_PARZIALE', 'CARICO', 'Recupero parziale', 'PRODOTTO', NULL, NULL, 40),
  -- NULL: per definizione non classificata.
  ('ALTRO_CARICO', 'CARICO', 'Altro carico', 'ESCLUSO', NULL, NULL, 50),
  -- aT per i quattro scarichi AVVIATO: il MUD di oggi li tratta tutti come consegna a terzi; I
  -- (scarico interno verso un proprio impianto) non e' coerente con quel ruolo. Chi avvia a
  -- recupero in un impianto proprio crea una causale aziendale con I e ruolo ESCLUSO.
  ('CONFERIMENTO_TRASPORTATORE', 'SCARICO', 'Conferimento a trasportatore', 'AVVIATO', 'aT', NULL, 10),
  ('AVVIO_RECUPERO', 'SCARICO', 'Avvio a recupero (R)', 'AVVIATO', 'aT', 'R', 20),
  ('AVVIO_SMALTIMENTO', 'SCARICO', 'Avvio a smaltimento (D)', 'AVVIATO', 'aT', 'D', 30),
  ('CESSIONE', 'SCARICO', 'Cessione a terzi', 'AVVIATO', 'aT', NULL, 40),
  ('RICLASSIFICAZIONE', 'SCARICO', 'Riclassificazione CER', 'ESCLUSO', NULL, NULL, 50),
  ('ALTRO_SCARICO', 'SCARICO', 'Altro scarico', 'ESCLUSO', NULL, NULL, 60);

-- 5. Dati storici fuori catalogo: restano ESCLUSO nel MUD come oggi. Solo un avviso, non fallisce.
DO $storici$
DECLARE
  v_fuori bigint;
BEGIN
  SELECT count(*) INTO v_fuori
  FROM "waste_movements" m
  WHERE NOT EXISTS (
    SELECT 1 FROM "causali_registro" c WHERE c."codice" = m."causale" AND c."verso" = m."type");
  RAISE NOTICE 'causali_registro: % movimenti con coppia (causale, tipo) fuori catalogo (restano ESCLUSO nel MUD)', v_fuori;
END
$storici$;

-- 6. Personalizzazioni per azienda.
CREATE TABLE "causali_registro_azienda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "natura" "natura_causale_azienda" NOT NULL,
    "codice" VARCHAR(100) NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    "causale_sistema_codice" VARCHAR(100),
    "descrizione" VARCHAR(200),
    "ruolo_mud" "ruolo_mud_causale",
    "codice_rentri" VARCHAR(5),
    "operazione" VARCHAR(1),
    "ordine" SMALLINT NOT NULL DEFAULT 100,
    "valida_dal" DATE,
    "valida_al" DATE,
    "creato_da" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "causali_registro_azienda_pkey" PRIMARY KEY ("id"),
    -- DISATTIVAZIONE: solo il riferimento alla causale di sistema, tutto il resto NULL.
    CONSTRAINT "causali_registro_azienda_natura_disattivazione" CHECK (
      "natura" <> 'DISATTIVAZIONE' OR (
        "causale_sistema_codice" = "codice"
        AND "descrizione" IS NULL AND "ruolo_mud" IS NULL AND "codice_rentri" IS NULL
        AND "operazione" IS NULL AND "valida_dal" IS NULL AND "valida_al" IS NULL)),
    -- PROPRIA: codice AZ_, descrizione, ruolo e inizio validita' obbligatori.
    CONSTRAINT "causali_registro_azienda_natura_propria" CHECK (
      "natura" <> 'PROPRIA' OR (
        "causale_sistema_codice" IS NULL
        AND "codice" ~ '^AZ_[A-Z0-9_]{2,40}$'
        AND "descrizione" IS NOT NULL AND "ruolo_mud" IS NOT NULL AND "valida_dal" IS NOT NULL
        AND ("valida_al" IS NULL OR "valida_al" >= "valida_dal"))),
    CONSTRAINT "causali_registro_azienda_ruolo_verso" CHECK (
      "ruolo_mud" IS NULL
      OR ("verso" = 'CARICO' AND "ruolo_mud" IN ('PRODOTTO', 'RICEVUTO_DA_TERZI', 'ESCLUSO'))
      OR ("verso" = 'SCARICO' AND "ruolo_mud" IN ('AVVIATO', 'ESCLUSO'))),
    CONSTRAINT "causali_registro_azienda_codice_rentri_verso" CHECK (
      "codice_rentri" IS NULL
      OR ("verso" = 'CARICO' AND "codice_rentri" IN ('DT', 'NP', 'T*', 'RE'))
      OR ("verso" = 'SCARICO' AND "codice_rentri" IN ('I', 'aT', 'M'))),
    CONSTRAINT "causali_registro_azienda_operazione_coerente" CHECK (
      "operazione" IS NULL
      OR ("verso" = 'SCARICO' AND COALESCE("ruolo_mud" = 'AVVIATO', false) AND "operazione" IN ('R', 'D')))
);

CREATE UNIQUE INDEX "causali_registro_azienda_id_tenant_id_key"
  ON "causali_registro_azienda"("id", "tenant_id");
CREATE UNIQUE INDEX "causali_registro_azienda_id_tenant_codice_verso_key"
  ON "causali_registro_azienda"("id", "tenant_id", "codice", "verso");
CREATE UNIQUE INDEX "causali_registro_azienda_versione_key"
  ON "causali_registro_azienda"("tenant_id", "codice", "verso", "valida_dal");
CREATE UNIQUE INDEX "causali_registro_azienda_disattivazione_key"
  ON "causali_registro_azienda"("tenant_id", "causale_sistema_codice", "verso");
CREATE INDEX "causali_registro_azienda_tenant_id_idx" ON "causali_registro_azienda"("tenant_id");
-- Al piu' una versione aperta (senza fine) per causale propria. Non esprimibile in Prisma.
CREATE UNIQUE INDEX "causali_registro_azienda_una_aperta"
  ON "causali_registro_azienda"("tenant_id", "codice", "verso")
  WHERE "natura" = 'PROPRIA' AND "valida_al" IS NULL;

ALTER TABLE "causali_registro_azienda" ADD CONSTRAINT "causali_registro_azienda_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- MATCH SIMPLE: le righe PROPRIE (causale_sistema_codice NULL) non sono controllate.
ALTER TABLE "causali_registro_azienda" ADD CONSTRAINT "causali_registro_azienda_sistema_fkey"
  FOREIGN KEY ("causale_sistema_codice", "verso") REFERENCES "causali_registro"("codice", "verso")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rete del database per le regole di versione (il percorso normale e' il servizio di gestione).
-- "Usata" = esiste un movimento con causale_azienda_id = OLD.id; "ultimo giorno d'uso" = massimo del
-- giorno italiano di quei movimenti (movement_date e' un timestamp senza fuso, in UTC).
CREATE FUNCTION "causali_registro_azienda_controlli"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_usi    bigint;
  v_ultimo date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
       OR NEW."natura" IS DISTINCT FROM OLD."natura"
       OR NEW."codice" IS DISTINCT FROM OLD."codice"
       OR NEW."verso" IS DISTINCT FROM OLD."verso"
       OR NEW."causale_sistema_codice" IS DISTINCT FROM OLD."causale_sistema_codice" THEN
      RAISE EXCEPTION 'causali_registro_azienda: tenant, natura, codice e verso non si cambiano';
    END IF;
  END IF;

  IF NEW."natura" = 'PROPRIA' THEN
    IF EXISTS (
      SELECT 1 FROM "causali_registro_azienda" x
      WHERE x."tenant_id" = NEW."tenant_id" AND x."natura" = 'PROPRIA'
        AND x."codice" = NEW."codice" AND x."verso" = NEW."verso" AND x."id" <> NEW."id"
        AND x."valida_dal" <= COALESCE(NEW."valida_al", 'infinity'::date)
        AND NEW."valida_dal" <= COALESCE(x."valida_al", 'infinity'::date)
    ) THEN
      RAISE EXCEPTION 'causali_registro_azienda: le versioni della causale % si sovrappongono', NEW."codice";
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT count(*),
             max((m."movement_date" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date)
        INTO v_usi, v_ultimo
      FROM "waste_movements" m
      WHERE m."causale_azienda_id" = OLD."id" AND m."tenant_id" = OLD."tenant_id";
      IF v_usi > 0 THEN
        IF NEW."ruolo_mud" IS DISTINCT FROM OLD."ruolo_mud"
           OR NEW."codice_rentri" IS DISTINCT FROM OLD."codice_rentri"
           OR NEW."operazione" IS DISTINCT FROM OLD."operazione"
           OR NEW."valida_dal" IS DISTINCT FROM OLD."valida_dal" THEN
          RAISE EXCEPTION 'causali_registro_azienda: la versione e'' gia'' usata nel registro, ruolo MUD, codice RENTRI, operazione e inizio validita'' non si cambiano';
        END IF;
        IF NEW."valida_al" IS NOT NULL AND NEW."valida_al" < v_ultimo THEN
          RAISE EXCEPTION 'causali_registro_azienda: la validita'' non puo'' finire prima dell''ultimo giorno d''uso (%)', v_ultimo;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "causali_registro_azienda_controlli"
  BEFORE INSERT OR UPDATE ON "causali_registro_azienda"
  FOR EACH ROW EXECUTE FUNCTION "causali_registro_azienda_controlli"();

-- 7. Riferimento facoltativo dal movimento. Il prefisso AZ_ nasce con questa migration: se esiste
-- gia' un movimento con quel prefisso, i dati non sono quelli attesi e ci si ferma.
DO $az$
DECLARE
  v_az bigint;
BEGIN
  SELECT count(*) INTO v_az FROM "waste_movements" WHERE "causale" LIKE 'AZ\_%';
  IF v_az > 0 THEN
    RAISE EXCEPTION 'causali_registro: % movimenti hanno gia'' una causale con prefisso AZ_ (riservato alle causali aziendali): verificare i dati prima di procedere', v_az;
  END IF;
END
$az$;

ALTER TABLE "waste_movements" ADD COLUMN "causale_azienda_id" UUID;

-- NoAction (come F2-3): la cancellazione a cascata di un'azienda toglie movimenti e causali nello
-- stesso statement; una versione usata non si cancella da sola.
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_causale_azienda_fkey"
  FOREIGN KEY ("causale_azienda_id", "tenant_id", "causale", "type")
  REFERENCES "causali_registro_azienda"("id", "tenant_id", "codice", "verso")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "waste_movements" VALIDATE CONSTRAINT "waste_movements_causale_azienda_fkey";

-- Una causale aziendale ha sempre il riferimento; una di sistema o storica non lo ha mai.
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_causale_azienda_coerente"
  CHECK (("causale" LIKE 'AZ\_%') = ("causale_azienda_id" IS NOT NULL));

CREATE INDEX "waste_movements_causale_azienda_id_idx" ON "waste_movements"("causale_azienda_id");

-- 8. RLS, in fondo (stessa forma della Fase 1). Nessun GRANT: arrivano dai default privileges.
ALTER TABLE "causali_registro_azienda" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "causali_registro_azienda" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "causali_registro_azienda"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "causali_registro_azienda" FOR SELECT TO wasteflow_lettura USING (true);
