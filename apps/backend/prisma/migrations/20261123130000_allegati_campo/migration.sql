-- App campo, pezzo P5: foto scattate dall'autista per un evento dal campo.
--
-- Solo aggiunte (migration additiva): tabella `allegati_campo` APPEND-ONLY. I byte stanno nel database
-- (come `allegati_pesa`, tetto di 1 MiB per foto), con impronta SHA-256 che il server ricalcola e
-- confronta con quella del telefono. `foto_uuid` e' generato dal telefono: unico per azienda
-- (idempotenza del reinvio). Il tetto di foto per evento (3) lo applica il servizio sotto lock
-- sull'evento. La posizione al momento dell'evento NON ha una tabella: sta in `eventi_campo.dati`.
--
-- Immutabilita', RLS e privilegi come `eventi_campo` (P4): UPDATE/DELETE/TRUNCATE vietati da trigger
-- anche al proprietario (la cascata da `tenants` resta ammessa), RLS ENABLE + FORCE, ai ruoli
-- applicativi solo SELECT e INSERT (`v_solo_inserimento` in `ruoli-db.sql`).
--
-- ROLLBACK (solo prima dell'uso): DROP TABLE allegati_campo; DROP FUNCTION allegati_campo_immutabile();
-- poi `npx prisma migrate resolve --rolled-back 20261123130000_allegati_campo`.

SET LOCAL lock_timeout = '5s';

CREATE TABLE "allegati_campo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "foto_uuid" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "utente_id" UUID NOT NULL,
    "mime_type" VARCHAR(20) NOT NULL,
    "dimensione_byte" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "contenuto" BYTEA NOT NULL,
    "ricevuto_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegati_campo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allegati_campo_mime_ammesso" CHECK ("mime_type" IN ('image/jpeg', 'image/png')),
    CONSTRAINT "allegati_campo_dimensione_ammessa" CHECK ("dimensione_byte" BETWEEN 1 AND 1048576),
    CONSTRAINT "allegati_campo_dimensione_coerente" CHECK (octet_length("contenuto") = "dimensione_byte"),
    CONSTRAINT "allegati_campo_sha256_formato" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "allegati_campo_foto_uuid_key" ON "allegati_campo"("tenant_id", "foto_uuid");
CREATE INDEX "allegati_campo_evento_idx" ON "allegati_campo"("tenant_id", "evento_id");

ALTER TABLE "allegati_campo" ADD CONSTRAINT "allegati_campo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegati_campo" ADD CONSTRAINT "allegati_campo_evento_fkey" FOREIGN KEY ("evento_id", "tenant_id") REFERENCES "eventi_campo"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "allegati_campo" ADD CONSTRAINT "allegati_campo_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Append-only ------------------------------------------------------------------------------------

CREATE FUNCTION allegati_campo_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'allegati_campo: riga immutabile';
END;
$fn$;

CREATE TRIGGER allegati_campo_no_update BEFORE UPDATE ON "allegati_campo"
  FOR EACH ROW EXECUTE FUNCTION allegati_campo_immutabile();
CREATE TRIGGER allegati_campo_no_delete BEFORE DELETE ON "allegati_campo"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER allegati_campo_no_truncate BEFORE TRUNCATE ON "allegati_campo"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

-- RLS e privilegi --------------------------------------------------------------------------------

ALTER TABLE "allegati_campo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allegati_campo" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "allegati_campo"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "allegati_campo" FOR SELECT TO wasteflow_lettura USING (true);

DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "allegati_campo" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
