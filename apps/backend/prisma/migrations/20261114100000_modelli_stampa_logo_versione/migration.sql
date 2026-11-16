-- Modelli di stampa: il cambio del logo fa salire sempre `versione`.
--
-- La cache dei loghi (cache-logo.ts) ha per chiave tenant + modello + versione: e' corretta solo se
-- ogni scrittura di `logo_base64` incrementa `versione`. Oggi lo fa l'applicazione (modifica); un
-- seed, uno script o una migration futuri che aggiornassero il logo via SQL senza toccare
-- `versione` farebbero servire il logo vecchio fino al TTL. Il trigger rende l'invariante del
-- database: se il logo cambia e la versione non e' stata incrementata dall'istruzione, la
-- incrementa. Se l'istruzione ha gia' portato la versione avanti (modifica applicativa), non fa nulla.
--
-- Ruolo che esegue la migration: `wasteflow`. Nessun GRANT: la funzione gira con i diritti di chi
-- fa l'UPDATE e tocca solo la riga in aggiornamento.
--
-- Ripristino a mano: DROP TRIGGER company_templates_logo_versione ON "company_templates";
-- DROP FUNCTION company_templates_logo_versione();

CREATE FUNCTION company_templates_logo_versione() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.logo_base64 IS DISTINCT FROM OLD.logo_base64 AND NEW.versione = OLD.versione THEN
    NEW.versione := OLD.versione + 1;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER company_templates_logo_versione BEFORE UPDATE ON "company_templates"
  FOR EACH ROW EXECUTE FUNCTION company_templates_logo_versione();
