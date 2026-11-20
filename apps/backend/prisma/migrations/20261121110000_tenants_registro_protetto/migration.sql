-- I3 - Protezione del registro dalla cascata (decisione Q7 del 14/11).
--
-- `DELETE FROM tenants` porta via a cascata movimenti, FIR e lotti di import: un registro di carico e
-- scarico non si cancella per sbaglio (ne' per una pulizia mal indirizzata). Il trigger rifiuta la
-- cancellazione di un'azienda che ha almeno un movimento, un FIR o un lotto di import.
--
-- Eccezione: pulizie dei test e script di manutenzione, con DUE condizioni insieme:
--   1. la transazione ha impostato `SET LOCAL app.consenti_cancellazione_azienda = 'on'`;
--   2. la sessione e' di un SUPERUSER (`session_user`): il proprietario del database. Il ruolo
--      applicativo (`wasteflow_app`, NOSUPERUSER) puo' impostare il GUC, ma non basta: un'app
--      compromessa non puo' aggirare la protezione. Lo stesso vale per `wasteflow_sistema`.
--
-- SECURITY DEFINER: le tabelle hanno RLS FORCE e il ruolo applicativo vedrebbe solo le righe della
-- propria azienda (senza contesto, nessuna): la funzione gira come proprietario (superuser, aggira
-- la RLS) e conta le righe di qualunque azienda. search_path fissato.
-- Messaggio senza dati: nessun id, nessun nome.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenants_registro_protetto_fn() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.consenti_cancellazione_azienda', true) = 'on'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1 FROM public.waste_movements WHERE tenant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.firs WHERE tenant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.lotti_import WHERE tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'cancellazione azienda rifiutata: l''azienda ha registro, FIR o lotti di import'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION tenants_registro_protetto_fn() FROM PUBLIC;

DROP TRIGGER IF EXISTS tenants_registro_protetto ON "tenants";
CREATE TRIGGER tenants_registro_protetto
  BEFORE DELETE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION tenants_registro_protetto_fn();
