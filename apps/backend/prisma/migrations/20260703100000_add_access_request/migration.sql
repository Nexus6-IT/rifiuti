-- Migrazione additiva: tabella access_requests (lead capture "Richiedi accesso").
-- Sostituisce il signup self-service: il form pubblico ora persiste solo una
-- richiesta di contatto; NON crea più tenant/utente/Keycloak. Il consulente
-- attiva il TRIAL manualmente (white-glove) via provisioning admin.
-- Forward-only, backward-safe (nuova tabella + nuovo enum).

-- Enum stato della richiesta di accesso
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_request_status') THEN
    CREATE TYPE "access_request_status" AS ENUM ('PENDING', 'CONTACTED', 'CONVERTED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "access_requests" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)  NOT NULL,
  "ragione_sociale" VARCHAR(255)  NOT NULL,
  "partita_iva"     VARCHAR(11),
  "first_name"      VARCHAR(100)  NOT NULL,
  "last_name"       VARCHAR(100)  NOT NULL,
  "email"           VARCHAR(255)  NOT NULL,
  "phone"           VARCHAR(30),
  "message"         TEXT,
  "status"          "access_request_status" NOT NULL DEFAULT 'PENDING',
  "handled_note"    TEXT,
  CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "access_requests_status_idx"     ON "access_requests" ("status");
CREATE INDEX IF NOT EXISTS "access_requests_created_at_idx" ON "access_requests" ("created_at");
