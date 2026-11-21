-- App campo, pezzo P6: ricevuta di ritiro con firma su schermo del cliente.
--
-- Solo aggiunte (migration additiva): tabelle `ricevute_ritiro` e `invii_ricevuta_ritiro`, entrambe
-- APPEND-ONLY. La ricevuta e' una FIRMA ELETTRONICA SEMPLICE (immagine del tratto + nome + ora),
-- prova commerciale: NON e' una firma qualificata e NON sostituisce il FIR. Il PDF lo genera il
-- server dai dati del ritiro (mai dal telefono) e se ne conserva l'impronta SHA-256; il contenuto
-- firmato ha una propria impronta (`contenuto_sha256`) che compare nel PDF. Byte nel database come
-- `allegati_pesa` (firma <= 128 KiB, PDF <= 1 MiB).
--
-- `ricevuta_uuid` e' generato dal telefono: unico per azienda (idempotenza del reinvio).
-- `invii_ricevuta_ritiro` registra l'esito dell'invio FACOLTATIVO al cliente (spento per default);
-- l'indirizzo email NON viene conservato, solo una forma mascherata (`m***@dominio.it`).
--
-- Immutabilita', RLS e privilegi come `eventi_campo` (P4): UPDATE/DELETE/TRUNCATE vietati da trigger
-- anche al proprietario (la cascata da `tenants` resta ammessa), RLS ENABLE + FORCE, ai ruoli
-- applicativi solo SELECT e INSERT (`v_solo_inserimento` in `ruoli-db.sql`).
--
-- ROLLBACK (solo prima dell'uso): DROP TABLE invii_ricevuta_ritiro; DROP TABLE ricevute_ritiro;
-- DROP FUNCTION ricevute_ritiro_immutabile(); poi `npx prisma migrate resolve --rolled-back
-- 20261124100000_ricevute_ritiro`.

SET LOCAL lock_timeout = '5s';

CREATE TABLE "ricevute_ritiro" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ricevuta_uuid" UUID NOT NULL,
    "ritiro_id" UUID NOT NULL,
    "autista_id" UUID NOT NULL,
    "utente_id" UUID NOT NULL,
    "firmatario_nome" VARCHAR(120) NOT NULL,
    "firmato_il" TIMESTAMPTZ(3) NOT NULL,
    "ricevuto_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dati" JSONB NOT NULL,
    "firma_png" BYTEA NOT NULL,
    "firma_sha256" VARCHAR(64) NOT NULL,
    "contenuto_sha256" VARCHAR(64) NOT NULL,
    "pdf" BYTEA NOT NULL,
    "pdf_sha256" VARCHAR(64) NOT NULL,

    CONSTRAINT "ricevute_ritiro_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ricevute_ritiro_nome_non_vuoto" CHECK (length(btrim("firmatario_nome")) BETWEEN 2 AND 120),
    CONSTRAINT "ricevute_ritiro_dati_oggetto" CHECK (jsonb_typeof("dati") = 'object' AND octet_length("dati"::text) <= 8192),
    CONSTRAINT "ricevute_ritiro_firma_dimensione" CHECK (octet_length("firma_png") BETWEEN 1 AND 131072),
    CONSTRAINT "ricevute_ritiro_pdf_dimensione" CHECK (octet_length("pdf") BETWEEN 1 AND 1048576),
    CONSTRAINT "ricevute_ritiro_firma_sha256_formato" CHECK ("firma_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ricevute_ritiro_contenuto_sha256_formato" CHECK ("contenuto_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ricevute_ritiro_pdf_sha256_formato" CHECK ("pdf_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "ricevute_ritiro_id_tenant_id_key" ON "ricevute_ritiro"("id", "tenant_id");
CREATE UNIQUE INDEX "ricevute_ritiro_uuid_key" ON "ricevute_ritiro"("tenant_id", "ricevuta_uuid");
CREATE INDEX "ricevute_ritiro_ritiro_idx" ON "ricevute_ritiro"("tenant_id", "ritiro_id", "ricevuto_il");
CREATE INDEX "ricevute_ritiro_recenti_idx" ON "ricevute_ritiro"("tenant_id", "ricevuto_il" DESC);

ALTER TABLE "ricevute_ritiro" ADD CONSTRAINT "ricevute_ritiro_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ricevute_ritiro" ADD CONSTRAINT "ricevute_ritiro_ritiro_fkey" FOREIGN KEY ("ritiro_id", "tenant_id") REFERENCES "ritiri"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ricevute_ritiro" ADD CONSTRAINT "ricevute_ritiro_autista_fkey" FOREIGN KEY ("autista_id", "tenant_id") REFERENCES "autisti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ricevute_ritiro" ADD CONSTRAINT "ricevute_ritiro_utente_fkey" FOREIGN KEY ("utente_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "invii_ricevuta_ritiro" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ricevuta_id" UUID NOT NULL,
    "esito" VARCHAR(10) NOT NULL,
    "destinatario_mascherato" VARCHAR(120) NOT NULL,
    "registrato_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invii_ricevuta_ritiro_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invii_ricevuta_ritiro_esito_ammesso" CHECK ("esito" IN ('INVIATO', 'FALLITO'))
);

CREATE UNIQUE INDEX "invii_ricevuta_ritiro_ricevuta_key" ON "invii_ricevuta_ritiro"("ricevuta_id", "tenant_id");

ALTER TABLE "invii_ricevuta_ritiro" ADD CONSTRAINT "invii_ricevuta_ritiro_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invii_ricevuta_ritiro" ADD CONSTRAINT "invii_ricevuta_ritiro_ricevuta_fkey" FOREIGN KEY ("ricevuta_id", "tenant_id") REFERENCES "ricevute_ritiro"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Append-only ------------------------------------------------------------------------------------

CREATE FUNCTION ricevute_ritiro_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '%: riga immutabile', TG_TABLE_NAME;
END;
$fn$;

CREATE TRIGGER ricevute_ritiro_no_update BEFORE UPDATE ON "ricevute_ritiro"
  FOR EACH ROW EXECUTE FUNCTION ricevute_ritiro_immutabile();
CREATE TRIGGER ricevute_ritiro_no_delete BEFORE DELETE ON "ricevute_ritiro"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER ricevute_ritiro_no_truncate BEFORE TRUNCATE ON "ricevute_ritiro"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

CREATE TRIGGER invii_ricevuta_ritiro_no_update BEFORE UPDATE ON "invii_ricevuta_ritiro"
  FOR EACH ROW EXECUTE FUNCTION ricevute_ritiro_immutabile();
CREATE TRIGGER invii_ricevuta_ritiro_no_delete BEFORE DELETE ON "invii_ricevuta_ritiro"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER invii_ricevuta_ritiro_no_truncate BEFORE TRUNCATE ON "invii_ricevuta_ritiro"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

-- RLS e privilegi --------------------------------------------------------------------------------

ALTER TABLE "ricevute_ritiro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ricevute_ritiro" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "ricevute_ritiro"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "ricevute_ritiro" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "invii_ricevuta_ritiro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invii_ricevuta_ritiro" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "invii_ricevuta_ritiro"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "invii_ricevuta_ritiro" FOR SELECT TO wasteflow_lettura USING (true);

DO $ruoli$
DECLARE
  v_ruolo text;
  v_tabella text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      FOREACH v_tabella IN ARRAY ARRAY['ricevute_ritiro', 'invii_ricevuta_ritiro'] LOOP
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM %I', v_tabella, v_ruolo);
      END LOOP;
    END IF;
  END LOOP;
END
$ruoli$;
