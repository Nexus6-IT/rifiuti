-- FIR RENTRI in viaggio, pezzo P2: storico delle operazioni del viaggio (`fir_eventi_rentri`).
--
-- Una riga per ogni operazione inviata all'ente (quantita', trasporto, rollback, reset, ...), scritta
-- a esito noto. SOLO INSERIMENTO: i ruoli applicativi non fanno UPDATE ne' DELETE (la tabella sta in
-- `v_solo_inserimento` di `ruoli-db.sql`; la REVOKE e' fatta anche qui, se i ruoli esistono gia').
-- Il `payload` e' quello di dominio inviato all'ente: mai dati di firma, token ne' certificati.
-- FK composta `(fir_id, tenant_id)` su `firs`, RLS ENABLE + FORCE con `isolamento_azienda` e
-- `sola_lettura`.
--
-- ROLLBACK (solo prima dell'uso):
--   DROP TABLE fir_eventi_rentri; DROP TYPE esito_evento_rentri;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261121130100_fir_eventi_rentri';

SET LOCAL lock_timeout = '5s';

CREATE TYPE "esito_evento_rentri" AS ENUM ('INVIATA', 'ACCETTATA', 'RIFIUTATA', 'INCERTA');

CREATE TABLE "fir_eventi_rentri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fir_id" UUID NOT NULL,
    "operazione" VARCHAR(60) NOT NULL,
    "payload" JSONB,
    "transazione_id" VARCHAR(100),
    "esito" "esito_evento_rentri" NOT NULL,
    "dettaglio_ente" TEXT,
    "stato_formulario_dopo" "rentri_stato_formulario",
    "utente_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fir_eventi_rentri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fir_eventi_rentri_operazione_non_vuota" CHECK (btrim("operazione") <> '')
);

CREATE UNIQUE INDEX "fir_eventi_rentri_id_tenant_id_key" ON "fir_eventi_rentri"("id", "tenant_id");
CREATE INDEX "fir_eventi_rentri_fir_idx" ON "fir_eventi_rentri"("tenant_id", "fir_id", "created_at");

ALTER TABLE "fir_eventi_rentri" ADD CONSTRAINT "fir_eventi_rentri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fir_eventi_rentri" ADD CONSTRAINT "fir_eventi_rentri_fir_fkey" FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fir_eventi_rentri" ADD CONSTRAINT "fir_eventi_rentri_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "fir_eventi_rentri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fir_eventi_rentri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "fir_eventi_rentri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "fir_eventi_rentri" FOR SELECT TO wasteflow_lettura USING (true);

DO $ruoli$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "fir_eventi_rentri" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$ruoli$;
