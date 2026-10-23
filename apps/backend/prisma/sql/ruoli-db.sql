-- Ruoli database di WasteFlow e relativi GRANT (RLS pezzo 1).
--
-- Eseguito dall'OWNER delle tabelle (oggi `wasteflow`), idempotente:
--   psql -v ON_ERROR_STOP=1 -v app_password=... -v sistema_password=... -f ruoli-db.sql
--
-- Le password arrivano come variabili psql e vengono passate al blocco DO
-- tramite set_config: psql NON interpola le variabili dentro i dollar-quoted
-- string, quindi il blocco non potrebbe leggerle altrimenti. Questo vincolo
-- e' anche cio' che permette al test di eseguire lo STESSO file senza psql
-- (sostituisce i due `:'...'` con letterali e lo spezza in statement).
-- Non usare meta-comandi psql (\gexec, \set...) in questo file.
--
-- Nessuna policy: ENABLE ROW LEVEL SECURITY / CREATE POLICY non fanno parte
-- di questo pezzo.

SELECT set_config('ruoli.app_password', :'app_password', false);
SELECT set_config('ruoli.sistema_password', :'sistema_password', false);

DO $ruoli$
DECLARE
  v_owner   text := current_user;
  v_db      text := current_database();
  v_ruolo   text;
  v_pwd     text;
  v_tabella text;
BEGIN
  -- Creazione o aggiornamento password dei due ruoli.
  FOR v_ruolo, v_pwd IN
    SELECT 'wasteflow_app', current_setting('ruoli.app_password')
    UNION ALL
    SELECT 'wasteflow_sistema', current_setting('ruoli.sistema_password')
  LOOP
    IF v_pwd IS NULL OR v_pwd = '' THEN
      RAISE EXCEPTION 'password vuota per il ruolo %', v_ruolo;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', v_ruolo, v_pwd);
    ELSE
      EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', v_ruolo, v_pwd);
    END IF;
  END LOOP;

  -- Attributi (riallineati a ogni esecuzione).
  ALTER ROLE wasteflow_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ALTER ROLE wasteflow_sistema NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', v_db, v_ruolo);
    -- Solo USAGE: niente CREATE sullo schema.
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', v_ruolo);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_ruolo);

    -- CRUD su tutte le tabelle tranne _prisma_migrations. Mai TRUNCATE.
    FOR v_tabella IN
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    LOOP
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I',
        v_tabella, v_ruolo);
    END LOOP;

    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_ruolo);

    -- _prisma_migrations: solo lettura (la scrive solo `prisma migrate`).
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public._prisma_migrations FROM %I', v_ruolo);
      EXECUTE format(
        'GRANT SELECT ON TABLE public._prisma_migrations TO %I', v_ruolo);
    END IF;

    -- Oggetti futuri creati dall'owner (le nuove migration).
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      v_owner, v_ruolo);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      'GRANT USAGE, SELECT ON SEQUENCES TO %I',
      v_owner, v_ruolo);
  END LOOP;
END
$ruoli$;

RESET ruoli.app_password;
RESET ruoli.sistema_password;
