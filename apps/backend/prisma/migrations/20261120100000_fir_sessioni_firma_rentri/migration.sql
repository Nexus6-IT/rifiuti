-- FIR RENTRI in viaggio, pezzo P1: sessione di firma remota riprendibile.
--
-- Solo aggiunte (migration additiva): enum `stato_sessione_firma_rentri`, tabella
-- `fir_sessioni_firma_rentri` (chiavi esterne composte, indice unico PARZIALE «una sola sessione
-- aperta per FIR»), RLS ENABLE + FORCE con `isolamento_azienda` e `sola_lettura`; niente DELETE ne'
-- TRUNCATE ai ruoli applicativi (una sessione chiusa resta come traccia: l'elenco duraturo e'
-- `v_senza_cancellazione` in `ruoli-db.sql`).
--
-- ROLLBACK (solo prima dell'uso): DROP TABLE fir_sessioni_firma_rentri; DROP TYPE
-- stato_sessione_firma_rentri; poi `npx prisma migrate resolve --rolled-back
-- 20261120100000_fir_sessioni_firma_rentri`.

CREATE TYPE "stato_sessione_firma_rentri" AS ENUM ('IN_AVVIO', 'IN_ATTESA', 'IN_FIRMA', 'COMPLETATA', 'SCADUTA', 'RIFIUTATA', 'ANNULLATA');

CREATE TABLE "fir_sessioni_firma_rentri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fir_id" UUID NOT NULL,
    "tipo_operazione" VARCHAR(60) NOT NULL,
    "handle" VARCHAR(255),
    "token_hash" VARCHAR(64),
    "token_acquisizione" TEXT,
    "digest_to_sign" TEXT,
    "scadenza" TIMESTAMPTZ(3) NOT NULL,
    "stato" "stato_sessione_firma_rentri" NOT NULL DEFAULT 'IN_AVVIO',
    "dettaglio_ente" TEXT,
    "utente_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fir_sessioni_firma_rentri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fir_sessioni_firma_rentri_id_tenant_id_key" ON "fir_sessioni_firma_rentri"("id", "tenant_id");
CREATE INDEX "fir_sessioni_firma_rentri_fir_idx" ON "fir_sessioni_firma_rentri"("tenant_id", "fir_id", "created_at");
-- Una sola sessione aperta per FIR (la riga si prenota IN_AVVIO PRIMA di chiamare l'ente): la seconda
-- richiesta di autorizzazione sullo stesso FIR e' proprio cio' che il pezzo vuole impedire.
CREATE UNIQUE INDEX "fir_sessioni_firma_rentri_aperta_key" ON "fir_sessioni_firma_rentri"("fir_id") WHERE "stato" IN ('IN_AVVIO', 'IN_ATTESA', 'IN_FIRMA');

ALTER TABLE "fir_sessioni_firma_rentri" ADD CONSTRAINT "fir_sessioni_firma_rentri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fir_sessioni_firma_rentri" ADD CONSTRAINT "fir_sessioni_firma_rentri_fir_fkey" FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fir_sessioni_firma_rentri" ADD CONSTRAINT "fir_sessioni_firma_rentri_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "fir_sessioni_firma_rentri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fir_sessioni_firma_rentri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "fir_sessioni_firma_rentri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "fir_sessioni_firma_rentri" FOR SELECT TO wasteflow_lettura USING (true);

DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "fir_sessioni_firma_rentri" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
