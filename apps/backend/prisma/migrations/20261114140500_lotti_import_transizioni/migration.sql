-- Fase 3 (3.1), M2 della review: le transizioni di stato di `lotti_import` si fanno rispettare dal database.
--
-- Cosa fa (un solo script, transazionale): trigger BEFORE UPDATE `lotti_import_transizioni`: un lotto
-- che NON e' `IN_CORSO` non si modifica piu' (ne' stato ne' conteggi); da `IN_CORSO` si resta tale
-- (aggiornamento dei conteggi di un blocco) o si va a COMPLETATO / FALLITO / ANNULLATO. Il lotto
-- `COMPLETATO` che torna `IN_CORSO` e' proprio cio' che il trigger vieta. Non e' SECURITY DEFINER e non
-- legge altre tabelle. La tabella e' vuota in produzione al momento della migration: nessun costo.
--
-- Ripristino a mano: DROP TRIGGER lotti_import_transizioni ON lotti_import; DROP FUNCTION lotti_import_transizioni();
-- Ripristino da migration fallita (P3009): transazionale; se la funzione non esiste:
-- `npx prisma migrate resolve --rolled-back 20261114140500_lotti_import_transizioni`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION lotti_import_transizioni() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.stato <> 'IN_CORSO' THEN
    RAISE EXCEPTION 'il lotto di import % e'' gia'' concluso (%): non si modifica', OLD.id, OLD.stato
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER lotti_import_transizioni BEFORE UPDATE ON lotti_import
  FOR EACH ROW EXECUTE FUNCTION lotti_import_transizioni();
