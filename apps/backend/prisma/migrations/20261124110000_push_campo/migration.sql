-- App campo, pezzo P7: web push VAPID. Sottoscrizioni dei dispositivi e preferenze per utente.
--
-- Solo aggiunte (migration additiva): due tabelle nuove, entrambe con RLS ENABLE + FORCE
-- (`isolamento_azienda` + `sola_lettura` per il ruolo di lettura).
--
--  * `sottoscrizioni_push`: un dispositivo (endpoint del servizio push del browser) collegato a un
--    utente della stessa azienda. Si crea, si sposta di utente (telefono passato a un collega) e si
--    cancella (logout, 404/410 del servizio push): quindi NON e' append-only e il ruolo applicativo
--    mantiene INSERT/UPDATE/DELETE. L'invio non porta dati (nessuna chiave di cifratura da tenere):
--    si salva solo l'endpoint.
--  * `preferenze_push`: una riga per utente, interruttori per tipo di avviso.
--
-- ROLLBACK (solo prima dell'uso): DROP TABLE preferenze_push; DROP TABLE sottoscrizioni_push; poi
-- `npx prisma migrate resolve --rolled-back 20261124110000_push_campo`.

SET LOCAL lock_timeout = '5s';

CREATE TABLE "sottoscrizioni_push" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "utente_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "creata_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_invio_il" TIMESTAMPTZ(3),

    CONSTRAINT "sottoscrizioni_push_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sottoscrizioni_push_endpoint_https" CHECK ("endpoint" LIKE 'https://%' AND char_length("endpoint") BETWEEN 20 AND 2000)
);

CREATE UNIQUE INDEX "sottoscrizioni_push_endpoint_key" ON "sottoscrizioni_push"("tenant_id", "endpoint");
CREATE INDEX "sottoscrizioni_push_utente_idx" ON "sottoscrizioni_push"("tenant_id", "utente_id");

ALTER TABLE "sottoscrizioni_push" ADD CONSTRAINT "sottoscrizioni_push_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sottoscrizioni_push" ADD CONSTRAINT "sottoscrizioni_push_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "preferenze_push" (
    "tenant_id" UUID NOT NULL,
    "utente_id" UUID NOT NULL,
    "giro_modificato" BOOLEAN NOT NULL DEFAULT true,
    "aggiornata_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferenze_push_pkey" PRIMARY KEY ("tenant_id", "utente_id")
);

ALTER TABLE "preferenze_push" ADD CONSTRAINT "preferenze_push_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "preferenze_push" ADD CONSTRAINT "preferenze_push_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- RLS --------------------------------------------------------------------------------------------

ALTER TABLE "sottoscrizioni_push" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sottoscrizioni_push" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "sottoscrizioni_push"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "sottoscrizioni_push" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "preferenze_push" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preferenze_push" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "preferenze_push"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "preferenze_push" FOR SELECT TO wasteflow_lettura USING (true);
