-- Ruoli database di WasteFlow e relativi GRANT (RLS pezzo 1).
--
-- Eseguito dall'OWNER delle tabelle (oggi `wasteflow`), idempotente:
--   ops/db-ruoli.sh (anteponendo a questo file due righe \set app_password '...'
--   e \set sistema_password '...' sullo stdin di psql: cosi' le password non
--   stanno in nessun argv)
--
-- Le password arrivano come variabili psql e vengono passate al blocco DO
-- tramite set_config: psql NON interpola le variabili dentro i dollar-quoted
-- string, quindi il blocco non potrebbe leggerle altrimenti. Questo vincolo
-- e' anche cio' che permette al test di eseguire lo STESSO file senza psql
-- (sostituisce i due `:'...'` con letterali e lo spezza in statement).
-- Non usare meta-comandi psql (\gexec, \set...) in questo file.
--
-- ORDINE: va eseguito DOPO `prisma migrate deploy`, ovunque (dev, CI, deploy,
-- restore). Se `_prisma_migrations` non esiste lo script si ferma: i default
-- privileges darebbero CRUD completo a quella tabella, quando verra' creata.
-- Va eseguito da un SUPERUSER (oggi `wasteflow`, bootstrap): in PostgreSQL 16
-- solo un superuser puo' assegnare BYPASSRLS.
--
-- Nessuna policy: ENABLE ROW LEVEL SECURITY / CREATE POLICY non fanno parte
-- di questo pezzo.
--
-- TABELLE GLOBALI IN SOLA LETTURA: le tabelle elencate in `v_sola_lettura` (oggi
-- `causali_registro`, il catalogo di sistema che scrive solo la migration) ricevono
-- solo SELECT e una REVOKE esplicita di INSERT/UPDATE/DELETE/TRUNCATE a ogni
-- esecuzione. I default privileges restano CRUD (valgono per le tabelle future):
-- una nuova tabella globale in sola lettura va AGGIUNTA a quell'elenco.
--
-- TABELLE IN SOLO INSERIMENTO (pese, Fase 4 pezzo 8a): `v_solo_inserimento` (`pesate`,
-- `rettifiche_peso`, `allegati_pesa`) ricevono solo SELECT e INSERT, con una REVOKE esplicita di
-- UPDATE/DELETE/TRUNCATE a ogni esecuzione (sono documentazione del registro e del FIR: i trigger
-- dei loro modelli le proteggono anche dal proprietario). `v_senza_cancellazione` (`accessi_pesa`,
-- `collegamenti_accesso`, `automezzi`, `strumenti_pesa`) ricevono SELECT, INSERT, UPDATE e una REVOKE
-- esplicita di DELETE/TRUNCATE. Valgono per ENTRAMBI i ruoli. La cancellazione a cascata da
-- `tenants` resta possibile: le azioni referenziali girano coi privilegi del proprietario.
-- La migration `20261101600000_pese_modello_dati` fa le stesse REVOKE se i ruoli esistono gia'.

SELECT set_config('ruoli.app_password', :'app_password', false);
SELECT set_config('ruoli.sistema_password', :'sistema_password', false);

DO $ruoli$
DECLARE
  v_owner   text := current_user;
  v_db      text := current_database();
  v_ruolo   text;
  v_pwd     text;
  v_tabella text;
  v_sola_lettura text[] := ARRAY['causali_registro'];
  v_solo_inserimento text[] := ARRAY['pesate', 'rettifiche_peso', 'allegati_pesa'];
  v_senza_cancellazione text[] :=
    ARRAY['accessi_pesa', 'collegamenti_accesso', 'automezzi', 'strumenti_pesa'];
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'lo script va eseguito da un superuser (serve per BYPASSRLS), non da %', current_user;
  END IF;
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'public._prisma_migrations non esiste: eseguire dopo prisma migrate deploy';
  END IF;

  -- Creazione o aggiornamento password dei due ruoli.
  FOR v_ruolo, v_pwd IN
    SELECT 'wasteflow_app', current_setting('ruoli.app_password')
    UNION ALL
    SELECT 'wasteflow_sistema', current_setting('ruoli.sistema_password')
  LOOP
    IF v_pwd IS NULL OR v_pwd = '' THEN
      RAISE EXCEPTION 'password vuota per il ruolo %', v_ruolo;
    END IF;
    -- Il messaggio d'errore NON deve contenere lo statement (c'e' la password):
    -- si riraise con un testo fisso, senza SQLERRM.
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', v_ruolo, v_pwd);
      ELSE
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', v_ruolo, v_pwd);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'creazione/aggiornamento ruolo % fallita', v_ruolo;
    END;
  END LOOP;

  -- Attributi (riallineati a ogni esecuzione).
  ALTER ROLE wasteflow_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ALTER ROLE wasteflow_sistema NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', v_db, v_ruolo);
    -- Solo USAGE: niente CREATE sullo schema.
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', v_ruolo);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_ruolo);

    -- CRUD su tutte le tabelle tranne _prisma_migrations. Mai TRUNCATE. Le tabelle
    -- globali in sola lettura (v_sola_lettura) ricevono solo SELECT.
    FOR v_tabella IN
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    LOOP
      IF v_tabella = ANY (v_sola_lettura) THEN
        EXECUTE format(
          'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %I',
          v_tabella, v_ruolo);
        EXECUTE format(
          'GRANT SELECT ON TABLE public.%I TO %I',
          v_tabella, v_ruolo);
      ELSIF v_tabella = ANY (v_solo_inserimento) THEN
        EXECUTE format(
          'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %I',
          v_tabella, v_ruolo);
        EXECUTE format(
          'GRANT SELECT, INSERT ON TABLE public.%I TO %I',
          v_tabella, v_ruolo);
      ELSIF v_tabella = ANY (v_senza_cancellazione) THEN
        EXECUTE format(
          'REVOKE DELETE, TRUNCATE ON TABLE public.%I FROM %I',
          v_tabella, v_ruolo);
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I',
          v_tabella, v_ruolo);
      ELSE
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I',
          v_tabella, v_ruolo);
      END IF;
    END LOOP;

    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_ruolo);

    -- Sonda della numerazione della fatturazione (4.4a): SECURITY INVOKER e leggibile solo da chi
    -- aggira la RLS (`wasteflow_sistema`). La migration fa il REVOKE da PUBLIC; il GRANT sta qui
    -- perche' alla prima `migrate deploy` il ruolo puo' non esistere ancora.
    IF to_regprocedure('public.fatturazione_violazioni_numerazione()') IS NOT NULL THEN
      IF v_ruolo = 'wasteflow_sistema' THEN
        EXECUTE format(
          'GRANT EXECUTE ON FUNCTION public.fatturazione_violazioni_numerazione() TO %I', v_ruolo);
      ELSE
        EXECUTE format(
          'REVOKE EXECUTE ON FUNCTION public.fatturazione_violazioni_numerazione() FROM %I', v_ruolo);
      END IF;
    END IF;

    -- _prisma_migrations: solo lettura (la scrive solo `prisma migrate`).
    EXECUTE format(
      'REVOKE ALL ON TABLE public._prisma_migrations FROM %I', v_ruolo);
    EXECUTE format(
      'GRANT SELECT ON TABLE public._prisma_migrations TO %I', v_ruolo);

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
