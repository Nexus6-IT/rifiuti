-- App campo, pezzo P1: anagrafica degli autisti, ruolo AUTISTA e autista del ritiro.
--
-- Solo aggiunte (migration additiva):
--   1. valore `AUTISTA` di `user_role` (non usato in questa migration: un valore appena aggiunto non
--      si puo' usare nella stessa transazione);
--   2. indice unico `users(id, tenant_id)`: serve alla chiave esterna composita di `autisti.user_id`
--      (un autista e il suo utente stanno nella stessa azienda);
--   3. tabella `autisti` (CHECK, chiavi esterne composte NO ACTION, unici, indice);
--   4. colonna `ritiri.autista_id` (facoltativa, chiave esterna composita) e indice per giro;
--   5. RLS ENABLE + FORCE su `autisti` con `isolamento_azienda` e `sola_lettura`; niente DELETE ne'
--      TRUNCATE ai ruoli applicativi (un autista si disattiva, non si cancella).
--
-- ROLLBACK (solo prima dell'uso): ALTER TABLE ritiri DROP COLUMN autista_id; DROP TABLE autisti;
-- DROP INDEX users_id_tenant_id_key. Il valore dell'enum non si toglie (Postgres non lo prevede):
-- resta inutilizzato. Poi `npx prisma migrate resolve --rolled-back 20261119200000_autisti`.

-- 1. Ruolo ---------------------------------------------------------------------------------------

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'AUTISTA';

-- 2. Unico di appoggio sugli utenti --------------------------------------------------------------

CREATE UNIQUE INDEX "users_id_tenant_id_key" ON "users"("id", "tenant_id");

-- 3. Anagrafica autisti --------------------------------------------------------------------------

CREATE TABLE "autisti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "cognome" VARCHAR(100) NOT NULL,
    "codice_fiscale" VARCHAR(16),
    "trasportatore_id" UUID,
    "patente_numero" VARCHAR(30),
    "patente_categoria" VARCHAR(10),
    "patente_scadenza" DATE,
    "cqc_scadenza" DATE,
    "adr_scadenza" DATE,
    "telefono" VARCHAR(30),
    "user_id" UUID,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "creato_da" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autisti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "autisti_nome_non_vuoto" CHECK (btrim("nome") <> '' AND btrim("cognome") <> ''),
    CONSTRAINT "autisti_codice_fiscale_lunghezza" CHECK (
      "codice_fiscale" IS NULL OR char_length("codice_fiscale") = 16
    )
);

CREATE UNIQUE INDEX "autisti_id_tenant_id_key" ON "autisti"("id", "tenant_id");
CREATE UNIQUE INDEX "autisti_tenant_codice_fiscale_key" ON "autisti"("tenant_id", "codice_fiscale");
CREATE UNIQUE INDEX "autisti_user_id_key" ON "autisti"("user_id");
CREATE INDEX "autisti_tenant_id_idx" ON "autisti"("tenant_id");

ALTER TABLE "autisti" ADD CONSTRAINT "autisti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "autisti" ADD CONSTRAINT "autisti_trasportatore_fkey" FOREIGN KEY ("trasportatore_id", "tenant_id") REFERENCES "trasportatori"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "autisti" ADD CONSTRAINT "autisti_user_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 4. Autista del ritiro --------------------------------------------------------------------------

ALTER TABLE "ritiri" ADD COLUMN "autista_id" UUID;
ALTER TABLE "ritiri" ADD CONSTRAINT "ritiri_autista_fkey" FOREIGN KEY ("autista_id", "tenant_id") REFERENCES "autisti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "ritiri_tenant_autista_data_idx" ON "ritiri"("tenant_id", "autista_id", "data_prevista", "ordine_giro");

-- 5. RLS e privilegi -----------------------------------------------------------------------------

ALTER TABLE "autisti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "autisti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "autisti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "autisti" FOR SELECT TO wasteflow_lettura USING (true);

-- Come nelle migration delle pese e dei ritiri: il REVOKE vale solo se i ruoli esistono gia';
-- l'elenco duraturo e' `v_senza_cancellazione` in `ruoli-db.sql`.
DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "autisti" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
