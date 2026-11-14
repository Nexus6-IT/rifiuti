-- Fase 4 pezzo 8b, D11 (2/2): agenti di pesa e letture firmate (D1-D4 del piano
-- `2026-11-13-fase4-8b-agente-pesa`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale):
--   1. `SET LOCAL lock_timeout = '5s'` (si tocca `pesate`, `strumenti_pesa`, `tenants`);
--   2. enum `stato_agente_pesa`; tabelle `agenti_pesa` e `letture_pesa` con indici, unici, CHECK e
--      chiavi esterne composte con `tenant_id` (NO ACTION; la cascata da `tenants` cancella tutto);
--   3. colonne nuove: `strumenti_pesa.agente_id`, `pesate.lettura_id` (+ unico `pesate_lettura_id_key`
--      e CHECK `pesate_lettura_check`), `tenants.pese_simulazione_ammessa` (default false);
--   4. funzioni e trigger (NON `SECURITY DEFINER`: le SELECT interne passano dalla RLS di chi scrive):
--      `letture_pesa` non si aggiorna ne' si cancella mai (vale anche per il proprietario);
--      `agenti_pesa_controlli` governa le transizioni e le colonne che si scrivono una volta sola;
--      `pesate_da_lettura` impone che una pesata con `lettura_id` copi i valori della lettura;
--   5. REVOKE dei privilegi per `wasteflow_app` e `wasteflow_sistema` SE esistono (la prima
--      `migrate deploy` in CI precede `ops/db-ruoli.sh`); stesso elenco in `prisma/sql/ruoli-db.sql`;
--   6. RLS ENABLE + FORCE e policy `isolamento_azienda` / `sola_lettura` sulle due tabelle nuove.
--
-- Mai `FOR SHARE`/`FOR UPDATE` su `letture_pesa` (richiedono UPDATE): la concorrenza sull'uso di una
-- lettura si governa con l'advisory lock `lettura-pesa|<id>` e l'unico `pesate_lettura_id_key`.
--
-- Ripristino a mano (additiva): DROP TRIGGER pesate_da_lettura ON pesate;
-- ALTER TABLE pesate DROP CONSTRAINT pesate_lettura_check, DROP COLUMN lettura_id;
-- ALTER TABLE strumenti_pesa DROP COLUMN agente_id; DROP TABLE letture_pesa, agenti_pesa;
-- DROP FUNCTION pesate_da_lettura(), agenti_pesa_controlli(), letture_pesa_immutabile();
-- DROP TYPE stato_agente_pesa; ALTER TABLE tenants DROP COLUMN pese_simulazione_ammessa.
-- Il valore `SIMULATA` di `fonte_pesata` non si toglie.
-- Ripristino da migration fallita (P3009): transazionale; se `to_regclass('public.agenti_pesa')` e'
-- NULL: `npx prisma migrate resolve --rolled-back 20261113100100_pese_agenti`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

-- Precondizione: `pesate_lettura_check` (piu' sotto) impone che una pesata STRUMENTO abbia
-- `lettura_id` (FILE resta ammessa senza lettura). Nessuna API di 4.8a ne scrive (in produzione sono 0, verificato il 13/11), ma righe
-- inserite a mano o da seed su un DB di collaudo farebbero fallire la migration con un errore
-- oscuro (P3009): meglio dirlo chiaro e subito. La migration gira col proprietario (nessuna RLS).
DO $pre$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM pesate WHERE fonte = 'STRUMENTO';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'pese 4.8b: esistono % pesate con fonte STRUMENTO senza lettura firmata: violerebbero pesate_lettura_check. Verificare/ripulire prima di rilasciare (piano 4.8b, Task 0, D13).', v_n;
  END IF;
END
$pre$;

-- 2. Enum e tabelle ----------------------------------------------------------------------------

CREATE TYPE "stato_agente_pesa" AS ENUM ('IN_ATTESA', 'ATTIVO', 'REVOCATO');

CREATE TABLE "agenti_pesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID,
    "descrizione" VARCHAR(255) NOT NULL,
    "stato" "stato_agente_pesa" NOT NULL DEFAULT 'IN_ATTESA',
    "codice_sha256" VARCHAR(64),
    "codice_scade_il" TIMESTAMPTZ(3),
    "token_sha256" VARCHAR(64),
    "chiave_pubblica" VARCHAR(44),
    "impronta_chiave" VARCHAR(64),
    "abbinato_il" TIMESTAMPTZ(3),
    "nome_host" VARCHAR(100),
    "versione_agente" VARCHAR(30),
    "ultimo_contatto_il" TIMESTAMPTZ(3),
    "ultimo_ip" VARCHAR(45),
    "scarto_orologio_ms" INTEGER,
    "coda_in_attesa" INTEGER,
    "letture_scartate" INTEGER,
    "ultima_sequenza" BIGINT,
    "creato_da" UUID NOT NULL,
    "revocato_da" UUID,
    "revocato_il" TIMESTAMPTZ(3),
    "motivo_revoca" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agenti_pesa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "letture_pesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "agente_id" UUID NOT NULL,
    "strumento_id" UUID NOT NULL,
    "chiave_idempotenza" UUID NOT NULL,
    "sequenza" BIGINT NOT NULL,
    "peso_kg" DECIMAL(10,2) NOT NULL,
    "stabile" BOOLEAN NOT NULL,
    "alibi_id" VARCHAR(40),
    "ora_strumento" TIMESTAMPTZ(3),
    "ora_agente" TIMESTAMPTZ(3) NOT NULL,
    "ora_ricezione" TIMESTAMPTZ(3) NOT NULL,
    "driver" VARCHAR(30) NOT NULL,
    "simulata" BOOLEAN NOT NULL,
    "payload" TEXT NOT NULL,
    "firma" VARCHAR(88) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letture_pesa_pkey" PRIMARY KEY ("id")
);

-- Indici e unici
CREATE UNIQUE INDEX "agenti_pesa_codice_sha256_key" ON "agenti_pesa"("codice_sha256");
CREATE UNIQUE INDEX "agenti_pesa_token_sha256_key" ON "agenti_pesa"("token_sha256");
CREATE UNIQUE INDEX "agenti_pesa_id_tenant_id_key" ON "agenti_pesa"("id", "tenant_id");
CREATE INDEX "agenti_pesa_tenant_id_idx" ON "agenti_pesa"("tenant_id");

CREATE UNIQUE INDEX "letture_pesa_id_tenant_id_key" ON "letture_pesa"("id", "tenant_id");
CREATE UNIQUE INDEX "letture_pesa_agente_id_chiave_idempotenza_key" ON "letture_pesa"("agente_id", "chiave_idempotenza");
CREATE UNIQUE INDEX "letture_pesa_agente_id_sequenza_key" ON "letture_pesa"("agente_id", "sequenza");
CREATE UNIQUE INDEX "letture_pesa_strumento_id_alibi_id_key" ON "letture_pesa"("strumento_id", "alibi_id");
CREATE INDEX "letture_pesa_tenant_id_idx" ON "letture_pesa"("tenant_id");
CREATE INDEX "letture_pesa_strumento_id_ora_agente_idx" ON "letture_pesa"("strumento_id", "ora_agente" DESC);

-- 3. Colonne nuove -----------------------------------------------------------------------------

ALTER TABLE "strumenti_pesa" ADD COLUMN "agente_id" UUID;
CREATE INDEX "strumenti_pesa_agente_id_idx" ON "strumenti_pesa"("agente_id");

ALTER TABLE "pesate" ADD COLUMN "lettura_id" UUID;
CREATE UNIQUE INDEX "pesate_lettura_id_key" ON "pesate"("lettura_id");

-- Metadata-only in PostgreSQL 16 (default costante).
ALTER TABLE "tenants" ADD COLUMN "pese_simulazione_ammessa" BOOLEAN NOT NULL DEFAULT false;

-- Chiavi esterne (composte con tenant_id: stessa azienda imposta dal database)
ALTER TABLE "agenti_pesa" ADD CONSTRAINT "agenti_pesa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agenti_pesa" ADD CONSTRAINT "agenti_pesa_registro_fkey" FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "letture_pesa" ADD CONSTRAINT "letture_pesa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "letture_pesa" ADD CONSTRAINT "letture_pesa_agente_fkey" FOREIGN KEY ("agente_id", "tenant_id") REFERENCES "agenti_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "letture_pesa" ADD CONSTRAINT "letture_pesa_strumento_fkey" FOREIGN KEY ("strumento_id", "tenant_id") REFERENCES "strumenti_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "strumenti_pesa" ADD CONSTRAINT "strumenti_pesa_agente_fkey" FOREIGN KEY ("agente_id", "tenant_id") REFERENCES "agenti_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_lettura_fkey" FOREIGN KEY ("lettura_id", "tenant_id") REFERENCES "letture_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CHECK -----------------------------------------------------------------------------------------

ALTER TABLE "agenti_pesa" ADD CONSTRAINT "agenti_pesa_stato_check" CHECK (
  btrim("descrizione") <> ''
  AND ("codice_sha256" IS NULL) = ("codice_scade_il" IS NULL)
  AND ("codice_sha256" IS NULL OR "codice_sha256" ~ '^[0-9a-f]{64}$')
  AND ("token_sha256" IS NULL OR "token_sha256" ~ '^[0-9a-f]{64}$')
  AND ("impronta_chiave" IS NULL OR "impronta_chiave" ~ '^[0-9a-f]{64}$')
  AND ("chiave_pubblica" IS NULL OR "chiave_pubblica" ~ '^[A-Za-z0-9+/]{43}=$')
  AND ("stato" <> 'IN_ATTESA' OR (
    "token_sha256" IS NULL AND "chiave_pubblica" IS NULL AND "abbinato_il" IS NULL))
  AND ("stato" <> 'ATTIVO' OR (
    "token_sha256" IS NOT NULL AND "chiave_pubblica" IS NOT NULL
    AND "impronta_chiave" IS NOT NULL AND "abbinato_il" IS NOT NULL
    AND "codice_sha256" IS NULL AND "codice_scade_il" IS NULL))
  AND ("stato" <> 'REVOCATO' OR (
    "revocato_da" IS NOT NULL AND "revocato_il" IS NOT NULL
    AND "motivo_revoca" IS NOT NULL AND btrim("motivo_revoca") <> ''
    AND "codice_sha256" IS NULL AND "codice_scade_il" IS NULL))
  AND ("stato" = 'REVOCATO' OR (
    "revocato_da" IS NULL AND "revocato_il" IS NULL AND "motivo_revoca" IS NULL))
);

ALTER TABLE "letture_pesa" ADD CONSTRAINT "letture_pesa_valori_check" CHECK (
  "stabile" = true
  AND "peso_kg" > 0
  AND "sequenza" >= 1
  AND ("alibi_id" IS NULL OR btrim("alibi_id") <> '')
  AND "simulata" = ("driver" = 'SIMULATA')
  AND octet_length("payload") BETWEEN 2 AND 2048
  AND "firma" ~ '^[A-Za-z0-9+/]{86}==$'
);

-- Una pesata con lettura e' STRUMENTO o SIMULATA e viceversa; tutto il resto viene dalla lettura.
-- (Il CHECK `pesate_coerenza_check` di 4.8a non si tocca.)
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_lettura_check" CHECK (
  (("fonte" IN ('STRUMENTO', 'SIMULATA')) = ("lettura_id" IS NOT NULL))
  AND ("lettura_id" IS NULL OR (
    "firma_agente" IS NOT NULL AND "strumento_id" IS NOT NULL AND "operatore_id" IS NOT NULL
    AND "motivo_manuale" IS NULL AND "strumento_esterno" IS NULL AND "allegato_id" IS NULL))
);

-- 4. Funzioni e trigger -------------------------------------------------------------------------

CREATE FUNCTION letture_pesa_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'letture_pesa: riga immutabile';
END;
$fn$;

CREATE TRIGGER letture_pesa_no_update BEFORE UPDATE ON "letture_pesa"
  FOR EACH ROW EXECUTE FUNCTION letture_pesa_immutabile();
CREATE TRIGGER letture_pesa_no_delete BEFORE DELETE ON "letture_pesa"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER letture_pesa_no_truncate BEFORE TRUNCATE ON "letture_pesa"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();
CREATE TRIGGER agenti_pesa_no_delete BEFORE DELETE ON "agenti_pesa"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER agenti_pesa_no_truncate BEFORE TRUNCATE ON "agenti_pesa"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

-- Transizioni IN_ATTESA->ATTIVO, IN_ATTESA->REVOCATO, ATTIVO->REVOCATO. Token, chiave, impronta e
-- data di abbinamento si scrivono UNA volta (IN_ATTESA->ATTIVO) e poi non cambiano piu', nemmeno alla
-- revoca (il token revocato resta riconoscibile per rispondere 403). Il codice cambia solo in IN_ATTESA.
CREATE FUNCTION agenti_pesa_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."tenant_id" <> OLD."tenant_id" OR NEW."creato_da" <> OLD."creato_da"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'agenti_pesa: azienda, autore e data di creazione non si modificano';
  END IF;

  IF OLD."stato" = 'REVOCATO' THEN
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'agenti_pesa: un agente revocato non si modifica';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."stato" <> OLD."stato" AND NOT (
       (OLD."stato" = 'IN_ATTESA' AND NEW."stato" IN ('ATTIVO', 'REVOCATO'))
    OR (OLD."stato" = 'ATTIVO' AND NEW."stato" = 'REVOCATO')) THEN
    RAISE EXCEPTION 'agenti_pesa: transizione di stato non ammessa (% -> %)', OLD."stato", NEW."stato";
  END IF;

  IF (OLD."token_sha256" IS NOT NULL AND NEW."token_sha256" IS DISTINCT FROM OLD."token_sha256")
     OR (OLD."chiave_pubblica" IS NOT NULL AND NEW."chiave_pubblica" IS DISTINCT FROM OLD."chiave_pubblica")
     OR (OLD."impronta_chiave" IS NOT NULL AND NEW."impronta_chiave" IS DISTINCT FROM OLD."impronta_chiave")
     OR (OLD."abbinato_il" IS NOT NULL AND NEW."abbinato_il" IS DISTINCT FROM OLD."abbinato_il") THEN
    RAISE EXCEPTION 'agenti_pesa: token, chiave e abbinamento non si modificano';
  END IF;

  IF (OLD."token_sha256" IS NULL AND NEW."token_sha256" IS NOT NULL)
     OR (OLD."chiave_pubblica" IS NULL AND NEW."chiave_pubblica" IS NOT NULL)
     OR (OLD."impronta_chiave" IS NULL AND NEW."impronta_chiave" IS NOT NULL)
     OR (OLD."abbinato_il" IS NULL AND NEW."abbinato_il" IS NOT NULL) THEN
    IF NOT (OLD."stato" = 'IN_ATTESA' AND NEW."stato" = 'ATTIVO') THEN
      RAISE EXCEPTION 'agenti_pesa: token e chiave si scrivono solo all''abbinamento';
    END IF;
  END IF;

  IF OLD."stato" <> 'IN_ATTESA'
     AND (NEW."codice_sha256" IS DISTINCT FROM OLD."codice_sha256"
          OR NEW."codice_scade_il" IS DISTINCT FROM OLD."codice_scade_il") THEN
    RAISE EXCEPTION 'agenti_pesa: il codice di abbinamento cambia solo in attesa';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER agenti_pesa_controlli BEFORE UPDATE ON "agenti_pesa"
  FOR EACH ROW EXECUTE FUNCTION agenti_pesa_controlli();

-- Una pesata con `lettura_id` copia i valori della lettura: nemmeno il codice applicativo puo'
-- «aggiustare» un peso arrivato dallo strumento.
CREATE FUNCTION pesate_da_lettura() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  l "letture_pesa"%ROWTYPE;
  v_fonte text;
BEGIN
  IF NEW."lettura_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO l FROM "letture_pesa"
    WHERE "id" = NEW."lettura_id" AND "tenant_id" = NEW."tenant_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pesate: lettura non trovata';
  END IF;
  v_fonte := CASE WHEN l."simulata" THEN 'SIMULATA' ELSE 'STRUMENTO' END;
  IF NEW."strumento_id" IS DISTINCT FROM l."strumento_id"
     OR NEW."peso_kg" <> l."peso_kg"
     OR NEW."stabile" <> l."stabile"
     OR NEW."alibi_id" IS DISTINCT FROM l."alibi_id"
     OR NEW."ora_strumento" IS DISTINCT FROM l."ora_strumento"
     OR NEW."ora_ricezione" <> l."ora_ricezione"
     OR NEW."firma_agente" IS DISTINCT FROM l."firma"
     OR NEW."fonte"::text <> v_fonte THEN
    RAISE EXCEPTION 'pesate: valori diversi dalla lettura';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER pesate_da_lettura BEFORE INSERT ON "pesate"
  FOR EACH ROW EXECUTE FUNCTION pesate_da_lettura();

-- 5. Privilegi, solo se i ruoli esistono ----------------------------------------------------------

DO $priv$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "letture_pesa" FROM %I', v_ruolo);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "agenti_pesa" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$priv$;

-- 6. RLS, in fondo --------------------------------------------------------------------------------

ALTER TABLE "agenti_pesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenti_pesa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "agenti_pesa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "agenti_pesa" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "letture_pesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "letture_pesa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "letture_pesa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "letture_pesa" FOR SELECT TO wasteflow_lettura USING (true);
