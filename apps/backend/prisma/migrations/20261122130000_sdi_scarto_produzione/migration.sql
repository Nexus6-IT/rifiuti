-- Fase 4 pezzo 4.5d, correzioni dopo la review finale. Segue `20261122120000_sdi_annullo_scartato`.
--
-- Cosa fa (due CREATE OR REPLACE FUNCTION, nessun dato toccato):
--  1. `documenti_fattura_immutabile()`: lo scarto che sblocca l'annullo di un emesso conta solo se e' di una
--     trasmissione EMESSA in PRODUZIONE (uno scarto di sandbox o di una ricevuta non dice nulla sul documento
--     vero). La trasmissione «viva» resta contata in ogni ambiente (scelta prudente).
--  2. `trasmissioni_sdi_documento_non_annullato()`: `FOR NO KEY UPDATE` al posto di `FOR UPDATE` (confligge gia'
--     con l'UPDATE dell'annullo e non blocca gli INSERT figli che prendono `FOR KEY SHARE`), e fail-closed se il
--     documento non si vede.
-- Come si annulla: riapplicare le due funzioni di `20261122120000_sdi_annullo_scartato`.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION documenti_fattura_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_permesse text[] := ARRAY['stato', 'annullato_il', 'annullato_da', 'motivo_annullo', 'emesso_il',
                             'xml', 'xml_sha256', 'xml_generato_il', 'progressivo_file',
                             'versione', 'updated_at'];
  v_scartato boolean;
  v_viva boolean;
BEGIN
  -- INSERT: la testata nasce solo in BOZZA (poi figlie, poi promozione): la creazione diretta come
  -- DEFINITIVO o ANNULLATO aggirerebbe il trigger delle figlie.
  IF TG_OP = 'INSERT' THEN
    IF NEW.stato <> 'BOZZA' THEN
      RAISE EXCEPTION 'documenti_fattura: un documento nasce in bozza';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.stato <> 'BOZZA' THEN
      RAISE EXCEPTION 'documenti_fattura: un documento non in bozza non si cancella';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.stato = 'BOZZA' THEN
    IF NEW.stato NOT IN ('BOZZA', 'DEFINITIVO') THEN
      RAISE EXCEPTION 'documenti_fattura: una bozza diventa solo definitiva';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_permesse) IS DISTINCT FROM (to_jsonb(OLD) - v_permesse) THEN
    RAISE EXCEPTION 'documenti_fattura: documento non in bozza immutabile';
  END IF;
  IF NEW.stato <> OLD.stato THEN
    -- Solo DEFINITIVO -> ANNULLATO, e solo se non emesso (decisioni 3 e 12). L'annullo non scrive
    -- l'emissione: un annullato non diventa «emesso» e non consuma un progressivo_file.
    -- (Il divieto di annullare un TD04, decisione 18, e «solo l'ultimo numero» restano al servizio:
    -- 409 ANNULLO_NON_AMMESSO, Task 20.)
    IF NOT (OLD.stato = 'DEFINITIVO' AND NEW.stato = 'ANNULLATO') THEN
      RAISE EXCEPTION 'documenti_fattura: transizione di stato non ammessa';
    END IF;
    -- 4.5d (D3): un emesso si annulla solo se lo SDI l'ha scartato (una trasmissione SCARTATA) e non ne
    -- esiste una viva (un nuovo invio in corso o riuscito). Senza trasmissioni la regola e' quella di prima.
    IF OLD.emesso_il IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM "trasmissioni_sdi" t
                      WHERE t.tenant_id = OLD.tenant_id AND t.documento_id = OLD.id
                        AND t.direzione = 'EMESSA' AND t.ambiente = 'PRODUZIONE'
                        AND t.stato = 'SCARTATA'),
             EXISTS (SELECT 1 FROM "trasmissioni_sdi" t
                      WHERE t.tenant_id = OLD.tenant_id AND t.documento_id = OLD.id
                        AND t.stato NOT IN ('ERRORE_INVIO', 'SCARTATA'))
        INTO v_scartato, v_viva;
      IF NOT (v_scartato AND NOT v_viva) THEN
        RAISE EXCEPTION 'documenti_fattura: un documento emesso non si annulla';
      END IF;
    END IF;
    IF NEW.emesso_il IS DISTINCT FROM OLD.emesso_il OR NEW.xml IS DISTINCT FROM OLD.xml
       OR NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256
       OR NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il
       OR NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file THEN
      RAISE EXCEPTION 'documenti_fattura: l''annullo non scrive i dati di emissione';
    END IF;
  ELSIF OLD.stato = 'ANNULLATO' THEN
    -- Un annullato resta com'e': passano solo versione e updated_at (le permesse dell'elenco).
    IF NEW.emesso_il IS DISTINCT FROM OLD.emesso_il OR NEW.xml IS DISTINCT FROM OLD.xml
       OR NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256
       OR NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il
       OR NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file
       OR NEW.annullato_il IS DISTINCT FROM OLD.annullato_il
       OR NEW.annullato_da IS DISTINCT FROM OLD.annullato_da
       OR NEW.motivo_annullo IS DISTINCT FROM OLD.motivo_annullo THEN
      RAISE EXCEPTION 'documenti_fattura: un documento annullato non si modifica';
    END IF;
  ELSIF NEW.annullato_il IS DISTINCT FROM OLD.annullato_il
     OR NEW.annullato_da IS DISTINCT FROM OLD.annullato_da
     OR NEW.motivo_annullo IS DISTINCT FROM OLD.motivo_annullo THEN
    RAISE EXCEPTION 'documenti_fattura: i dati dell''annullo si scrivono solo con l''annullo';
  END IF;
  -- Da null a valore una sola volta.
  IF OLD.emesso_il IS NOT NULL AND NEW.emesso_il IS DISTINCT FROM OLD.emesso_il THEN
    RAISE EXCEPTION 'documenti_fattura: emesso_il gia'' scritto';
  END IF;
  IF OLD.xml IS NOT NULL AND NEW.xml IS DISTINCT FROM OLD.xml THEN
    RAISE EXCEPTION 'documenti_fattura: xml gia'' scritto';
  END IF;
  IF OLD.xml_sha256 IS NOT NULL AND NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256 THEN
    RAISE EXCEPTION 'documenti_fattura: xml_sha256 gia'' scritto';
  END IF;
  IF OLD.xml_generato_il IS NOT NULL AND NEW.xml_generato_il IS DISTINCT FROM OLD.xml_generato_il THEN
    RAISE EXCEPTION 'documenti_fattura: xml_generato_il gia'' scritto';
  END IF;
  IF OLD.progressivo_file IS NOT NULL AND NEW.progressivo_file IS DISTINCT FROM OLD.progressivo_file THEN
    RAISE EXCEPTION 'documenti_fattura: progressivo_file gia'' scritto';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION trasmissioni_sdi_documento_non_annullato() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_documento_fattura";
BEGIN
  SELECT d.stato INTO v_stato FROM "documenti_fattura" d
    WHERE d.id = NEW.documento_id AND d.tenant_id = NEW.tenant_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento % non trovato per la trasmissione SDI', NEW.documento_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_stato = 'ANNULLATO' THEN
    RAISE EXCEPTION 'un documento annullato non si invia allo SDI (documento %)', NEW.documento_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;
