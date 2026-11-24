-- App campo, pezzo P4: eventi dal campo (esiti dei ritiri registrati dall'autista).
--
-- Solo aggiunte (migration additiva): enum `esito_evento_campo`, tabella `eventi_campo` APPEND-ONLY
-- (unico `(tenant_id, evento_uuid)` = chiave di idempotenza generata dal telefono, chiavi esterne
-- composte NO ACTION verso ritiri/autisti/utenti, CHECK), RLS ENABLE + FORCE con `isolamento_azienda`
-- e `sola_lettura`. L'esito (APPLICATO / DA_RICONCILIARE) si decide PRIMA dell'INSERT, nella stessa
-- transazione che applica l'evento al ritiro: la riga non si aggiorna mai.
--
-- Immutabilita': UPDATE, DELETE diretto e TRUNCATE sono vietati da trigger anche al proprietario
-- (la cascata da `tenants` passa da un trigger referenziale, profondita' >= 2, ed e' ammessa: usa
-- `pese_cancellazione_vietata()` / `pese_svuotamento_vietato()` della migration
-- 20261101600100). Ai ruoli applicativi restano solo SELECT e INSERT (`v_solo_inserimento` in
-- `ruoli-db.sql`); qui la REVOKE vale se i ruoli esistono gia'.
--
-- ROLLBACK (solo prima dell'uso): DROP TABLE eventi_campo; DROP FUNCTION eventi_campo_immutabile();
-- DROP TYPE esito_evento_campo; poi `npx prisma migrate resolve --rolled-back
-- 20261123110000_eventi_campo`.

SET LOCAL lock_timeout = '5s';

CREATE TYPE "esito_evento_campo" AS ENUM ('APPLICATO', 'DA_RICONCILIARE');

CREATE TABLE "eventi_campo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "evento_uuid" UUID NOT NULL,
    "ritiro_id" UUID NOT NULL,
    "autista_id" UUID NOT NULL,
    "utente_id" UUID NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "dati" JSONB NOT NULL DEFAULT '{}',
    "versione_vista" INTEGER NOT NULL,
    "rilevato_il" TIMESTAMPTZ(3) NOT NULL,
    "ricevuto_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "esito" "esito_evento_campo" NOT NULL,
    "motivo_conflitto" VARCHAR(40),

    CONSTRAINT "eventi_campo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eventi_campo_tipo_ammesso" CHECK ("tipo" IN ('RITIRO_ESEGUITO', 'RITIRO_NON_ESEGUITO')),
    CONSTRAINT "eventi_campo_versione_positiva" CHECK ("versione_vista" >= 1),
    CONSTRAINT "eventi_campo_dati_oggetto" CHECK (jsonb_typeof("dati") = 'object' AND octet_length("dati"::text) <= 2048),
    CONSTRAINT "eventi_campo_conflitto_coerente" CHECK (("esito" = 'DA_RICONCILIARE') = ("motivo_conflitto" IS NOT NULL))
);

CREATE UNIQUE INDEX "eventi_campo_id_tenant_id_key" ON "eventi_campo"("id", "tenant_id");
CREATE UNIQUE INDEX "eventi_campo_evento_uuid_key" ON "eventi_campo"("tenant_id", "evento_uuid");
CREATE INDEX "eventi_campo_esito_idx" ON "eventi_campo"("tenant_id", "esito", "ricevuto_il" DESC);
CREATE INDEX "eventi_campo_ritiro_idx" ON "eventi_campo"("tenant_id", "ritiro_id", "ricevuto_il");

ALTER TABLE "eventi_campo" ADD CONSTRAINT "eventi_campo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eventi_campo" ADD CONSTRAINT "eventi_campo_ritiro_fkey" FOREIGN KEY ("ritiro_id", "tenant_id") REFERENCES "ritiri"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "eventi_campo" ADD CONSTRAINT "eventi_campo_autista_fkey" FOREIGN KEY ("autista_id", "tenant_id") REFERENCES "autisti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "eventi_campo" ADD CONSTRAINT "eventi_campo_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Append-only ------------------------------------------------------------------------------------

CREATE FUNCTION eventi_campo_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'eventi_campo: riga immutabile';
END;
$fn$;

CREATE TRIGGER eventi_campo_no_update BEFORE UPDATE ON "eventi_campo"
  FOR EACH ROW EXECUTE FUNCTION eventi_campo_immutabile();
CREATE TRIGGER eventi_campo_no_delete BEFORE DELETE ON "eventi_campo"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER eventi_campo_no_truncate BEFORE TRUNCATE ON "eventi_campo"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

-- RLS e privilegi --------------------------------------------------------------------------------

ALTER TABLE "eventi_campo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eventi_campo" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "eventi_campo"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "eventi_campo" FOR SELECT TO wasteflow_lettura USING (true);

DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "eventi_campo" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
