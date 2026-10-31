-- Fase 4 pezzo 8a, Task 2b: cancellazione bloccata dai trigger, FOR SHARE sugli accessi, indici di
-- supporto alle chiavi esterne (continua `20261101600000_pese_modello_dati`, mai applicata in
-- produzione).
--
-- Cosa fa:
--   1. `pesate`, `rettifiche_peso`, `allegati_pesa`: oltre ai privilegi (REVOKE di D4) ora anche
--      trigger che vietano DELETE (`BEFORE DELETE FOR EACH ROW`) e TRUNCATE (`BEFORE TRUNCATE FOR
--      EACH STATEMENT`) a QUALUNQUE ruolo, proprietario compreso. La cancellazione a cascata da
--      `tenants` resta ammessa: gira dentro i trigger referenziali, quindi `pg_trigger_depth()`
--      vale almeno 2 nel trigger di riga (1 = DELETE diretto di un client);
--   2. `pesate_controlli` e `collegamenti_accesso_controlli` leggono l'accesso con `FOR SHARE`: la
--      chiusura o l'annullamento dell'accesso (UPDATE) aspetta le pesate e i collegamenti in corso,
--      e viceversa, senza finestra fra il controllo di stato e l'INSERT;
--   3. unico `collegamenti_accesso_id_tenant_id_key` (id, tenant_id), come tutti i modelli (D1);
--   4. indici di supporto alle chiavi esterne composte (cascata e controlli senza scansione).
--
-- Ruolo che esegue la migration: `wasteflow`. Nessun GRANT.
--
-- Ripristino a mano: DROP TRIGGER <tabella>_no_delete ON <tabella> e <tabella>_no_truncate per le tre
-- tabelle; DROP FUNCTION pese_cancellazione_vietata(), pese_svuotamento_vietato(); DROP INDEX
-- collegamenti_accesso_id_tenant_id_key, collegamenti_accesso_fir_id_tenant_id_idx,
-- collegamenti_accesso_movimento_idx, accessi_pesa_automezzo_id_idx, pesate_allegato_id_idx,
-- pesate_automezzo_id_idx; le due funzioni `*_controlli` tornano alla versione di
-- `20261101600000_pese_modello_dati` (senza FOR SHARE). Da migration fallita (P3009):
-- `npx prisma migrate resolve --rolled-back 20261101600100_pese_cancellazione_e_indici`.

SET LOCAL lock_timeout = '5s';

-- 1. DELETE e TRUNCATE vietati ----------------------------------------------------------------

CREATE FUNCTION pese_cancellazione_vietata() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Profondita' 1 = DELETE diretto di un client; la cascata da tenants passa da un trigger
  -- referenziale (profondita' >= 2) ed e' l'unico caso ammesso.
  -- ATTENZIONE: `<= 1` lascia passare QUALUNQUE cascata. Una futura chiave esterna con ON DELETE
  -- CASCADE verso queste tabelle (pesate, rettifiche_peso, allegati_pesa) aggirerebbe
  -- l'immutabilita': non va aggiunta (le FK verso di esse sono NO ACTION).
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION '%: le righe non si cancellano', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE FUNCTION pese_svuotamento_vietato() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '%: la tabella non si svuota', TG_TABLE_NAME;
END;
$fn$;

CREATE TRIGGER pesate_no_delete BEFORE DELETE ON "pesate"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER rettifiche_peso_no_delete BEFORE DELETE ON "rettifiche_peso"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER allegati_pesa_no_delete BEFORE DELETE ON "allegati_pesa"
  FOR EACH ROW EXECUTE FUNCTION pese_cancellazione_vietata();
CREATE TRIGGER pesate_no_truncate BEFORE TRUNCATE ON "pesate"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();
CREATE TRIGGER rettifiche_peso_no_truncate BEFORE TRUNCATE ON "rettifiche_peso"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();
CREATE TRIGGER allegati_pesa_no_truncate BEFORE TRUNCATE ON "allegati_pesa"
  FOR EACH STATEMENT EXECUTE FUNCTION pese_svuotamento_vietato();

-- 2. FOR SHARE sull'accesso -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pesate_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_accesso_pesa";
  v_modo "modo_pesatura";
BEGIN
  SELECT "stato", "modo" INTO v_stato, v_modo
    FROM "accessi_pesa" WHERE "id" = NEW."accesso_id" AND "tenant_id" = NEW."tenant_id"
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pesate: accesso non trovato';
  END IF;
  IF v_stato <> 'APERTO' THEN
    RAISE EXCEPTION 'pesate: accesso non aperto';
  END IF;
  IF v_modo = 'SINGOLA' AND NEW."ordine" <> 1 THEN
    RAISE EXCEPTION 'pesate: la pesata singola ha solo l''ordine 1';
  END IF;
  IF v_modo = 'SINGOLA' AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
    RAISE EXCEPTION 'pesate: la pesata singola non ammette la tara dichiarata';
  END IF;
  IF v_modo = 'TARA_ANAGRAFICA' THEN
    IF NEW."ordine" = 1 AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
      RAISE EXCEPTION 'pesate: la prima pesata non puo'' essere la tara dichiarata';
    END IF;
    IF NEW."ordine" = 2 AND NEW."fonte" <> 'TARA_ANAGRAFICA' THEN
      RAISE EXCEPTION 'pesate: con la tara dichiarata la seconda pesata e'' la tara';
    END IF;
  END IF;
  IF v_modo = 'DOPPIA' AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
    RAISE EXCEPTION 'pesate: la doppia pesata non ammette la tara dichiarata';
  END IF;
  IF NEW."ordine" = 2 AND NOT EXISTS (
    SELECT 1 FROM "pesate" WHERE "accesso_id" = NEW."accesso_id" AND "ordine" = 1
  ) THEN
    RAISE EXCEPTION 'pesate: manca la prima pesata';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION collegamenti_accesso_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_accesso_pesa";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "stato" INTO v_stato
      FROM "accessi_pesa" WHERE "id" = NEW."accesso_id" AND "tenant_id" = NEW."tenant_id"
      FOR SHARE;
    IF NOT FOUND OR v_stato <> 'CHIUSO' THEN
      RAISE EXCEPTION 'collegamenti_accesso: l''accesso deve essere chiuso';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."revocato_il" IS NOT NULL THEN
    RAISE EXCEPTION 'collegamenti_accesso: collegamento gia'' revocato';
  END IF;
  IF (NEW."id", NEW."tenant_id", NEW."accesso_id", NEW."registro_id", NEW."verso", NEW."tipo",
      NEW."fir_id", NEW."movimento_id", NEW."creato_da", NEW."creato_il")
     IS DISTINCT FROM
     (OLD."id", OLD."tenant_id", OLD."accesso_id", OLD."registro_id", OLD."verso", OLD."tipo",
      OLD."fir_id", OLD."movimento_id", OLD."creato_da", OLD."creato_il") THEN
    RAISE EXCEPTION 'collegamenti_accesso: si puo'' solo revocare';
  END IF;
  RETURN NEW;
END;
$fn$;

-- 3 e 4. Unico e indici di supporto -----------------------------------------------------------

CREATE UNIQUE INDEX "collegamenti_accesso_id_tenant_id_key" ON "collegamenti_accesso"("id", "tenant_id");
CREATE INDEX "collegamenti_accesso_fir_id_tenant_id_idx" ON "collegamenti_accesso"("fir_id", "tenant_id");
CREATE INDEX "collegamenti_accesso_movimento_idx"
  ON "collegamenti_accesso"("movimento_id", "registro_id", "tenant_id", "verso");
CREATE INDEX "accessi_pesa_automezzo_id_idx" ON "accessi_pesa"("automezzo_id");
CREATE INDEX "pesate_allegato_id_idx" ON "pesate"("allegato_id");
CREATE INDEX "pesate_automezzo_id_idx" ON "pesate"("automezzo_id");
