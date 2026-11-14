-- Fase 3 (3.1), D3 del piano `2026-11-14-fase3-import-piano`: blocco all'invio a RENTRI dei
-- MOVIMENTI importati, tutto nel database (la parte applicativa e' nel Task 6).
--
-- Presuppone la migration `20261114140000_import_valori_trasmissione` (i due valori di enum nuovi:
-- una migration precedente, quindi gia' utilizzabili qui) e `20261114140200_provenienza_import`
-- (`waste_movements.import_source`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale):
--   1. `SET LOCAL lock_timeout = '5s'`;
--   2. CHECK `movimenti_trasmissione_rentri_bloccato_coerente_check` sostituito da una versione che
--      include `DA_RICONCILIARE` (DROP e ADD dello stesso vincolo NELLA STESSA istruzione ALTER
--      TABLE: nessun istante senza garanzia; la nuova condizione e' piu' stretta e le righe esistenti,
--      che non hanno quello stato, la rispettano). Resta `..._coda_sbloccata_check` (`DA_TRASMETTERE`
--      non bloccato): per questo l'importato ha uno stato suo e non e' «in coda e bloccato». Il CHECK di
--      esclusione e `..._motivo_blocco_check` valgono gia' cosi' come sono (l'esclusione richiede
--      `DA_TRASMETTERE`, il blocco richiede un motivo);
--   3. CHECK `movimenti_trasmissione_rentri_origine_importazione_check`: `DA_RICONCILIARE` => origine
--      `IMPORTAZIONE`;
--   4. trigger `movimenti_trasmissione_rentri_importati` (BEFORE INSERT OR UPDATE):
--      INSERT: la riga e' di origine `IMPORTAZIONE` se e solo se il movimento ha `import_source` non
--      nullo, e un'origine `IMPORTAZIONE` nasce sempre `DA_RICONCILIARE` (dopo 3.6 la riga cambiera'
--      stato restando `IMPORTAZIONE`, per questo l'inverso non e' un CHECK);
--      UPDATE: da `DA_RICONCILIARE` non si esce e non cambiano ne' origine ne' blocco (lo sblocco e'
--      3.6, che allentera' questa regola con una funzione dedicata e audit); l'origine
--      `IMPORTAZIONE` non cambia mai. La cancellazione e' gia' vietata dal trigger `..._no_delete`
--      (`DA_RICONCILIARE` non e' fra gli stati cancellabili; la cascata da `tenants` passa);
--   5. trigger di vincolo DIFFERITO `waste_movements_importato_bloccato` (AFTER INSERT ON
--      waste_movements, `WHEN (NEW.import_source IS NOT NULL)`: le registrazioni normali non pagano
--      nulla): al commit un movimento importato senza la sua riga `IMPORTAZIONE` fa fallire la
--      transazione. E' la rete se un caricatore futuro dimentica la riga.
--
-- ATTENZIONE per chi scrivera' il caricatore (Task 9 e 3.4): con Prisma 5.22 l'errore del vincolo
-- differito sollevato dal COMMIT NON arriva all'applicazione (la transazione e' annullata ma la
-- promise di `$transaction` si risolve). Il blocco deve quindi chiudere con
-- `SET CONSTRAINTS "waste_movements_importato_bloccato" IMMEDIATE` come ultimo statement, cosi' l'errore
-- e' quello di uno statement e viene rilanciato. La rete del database regge in ogni caso (nessuna
-- riga persiste), ma senza quello statement l'applicazione crederebbe di aver scritto.
--
-- I trigger NON sono `SECURITY DEFINER`: le SELECT interne passano dalla RLS di chi scrive (il
-- contesto azienda e' impostato con `set_config(..., true)`, valido fino al commit anche per il
-- trigger differito).
--
-- Ripristino a mano (additiva, solo se nessuna riga e' `DA_RICONCILIARE`):
--   DROP TRIGGER waste_movements_importato_bloccato ON waste_movements;
--   DROP TRIGGER movimenti_trasmissione_rentri_importati ON movimenti_trasmissione_rentri;
--   DROP FUNCTION waste_movements_importato_bloccato(); DROP FUNCTION movimenti_trasmissione_rentri_importati();
--   ALTER TABLE movimenti_trasmissione_rentri DROP CONSTRAINT movimenti_trasmissione_rentri_origine_importazione_check,
--     DROP CONSTRAINT movimenti_trasmissione_rentri_bloccato_coerente_check,
--     ADD CONSTRAINT movimenti_trasmissione_rentri_bloccato_coerente_check
--       CHECK (stato NOT IN ('TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA') OR bloccato_invio);
-- Ripristino da migration fallita (P3009): transazionale; se il trigger
-- `waste_movements_importato_bloccato` non esiste: `npx prisma migrate resolve --rolled-back
-- 20261114140300_blocco_invio_importati`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "movimenti_trasmissione_rentri"
  DROP CONSTRAINT "movimenti_trasmissione_rentri_bloccato_coerente_check",
  ADD CONSTRAINT "movimenti_trasmissione_rentri_bloccato_coerente_check"
    CHECK ("stato" NOT IN ('TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA', 'DA_RICONCILIARE') OR "bloccato_invio"),
  ADD CONSTRAINT "movimenti_trasmissione_rentri_origine_importazione_check"
    CHECK ("stato" <> 'DA_RICONCILIARE' OR "origine" = 'IMPORTAZIONE');

CREATE FUNCTION movimenti_trasmissione_rentri_importati() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_importato boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT (m.import_source IS NOT NULL) INTO v_importato
      FROM waste_movements m WHERE m.id = NEW.movimento_id AND m.tenant_id = NEW.tenant_id;
    IF v_importato IS NULL THEN
      -- Movimento inesistente o di un'altra azienda (la RLS non lo mostra): non e' compito di questo
      -- trigger dirlo. Lasciano l'errore giusto la policy `isolamento_azienda` e la FK composta.
      RETURN NEW;
    END IF;
    IF v_importato AND NEW.origine <> 'IMPORTAZIONE' THEN
      RAISE EXCEPTION 'movimenti_trasmissione_rentri: il movimento importato % ha solo la riga di origine IMPORTAZIONE', NEW.movimento_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT v_importato AND NEW.origine = 'IMPORTAZIONE' THEN
      RAISE EXCEPTION 'movimenti_trasmissione_rentri: origine IMPORTAZIONE solo per un movimento importato (movimento %)', NEW.movimento_id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.origine = 'IMPORTAZIONE' AND NEW.stato <> 'DA_RICONCILIARE' THEN
      RAISE EXCEPTION 'movimenti_trasmissione_rentri: una riga di origine IMPORTAZIONE nasce DA_RICONCILIARE'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.origine = 'IMPORTAZIONE' AND NEW.origine IS DISTINCT FROM OLD.origine THEN
    RAISE EXCEPTION 'movimenti_trasmissione_rentri: l''origine IMPORTAZIONE non cambia'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.stato = 'DA_RICONCILIARE'
     AND (NEW.stato IS DISTINCT FROM OLD.stato
          OR NEW.bloccato_invio IS DISTINCT FROM OLD.bloccato_invio) THEN
    RAISE EXCEPTION 'movimenti_trasmissione_rentri: da DA_RICONCILIARE non si esce prima della riconciliazione (3.6)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "movimenti_trasmissione_rentri_importati"
  BEFORE INSERT OR UPDATE ON "movimenti_trasmissione_rentri"
  FOR EACH ROW EXECUTE FUNCTION movimenti_trasmissione_rentri_importati();

CREATE FUNCTION waste_movements_importato_bloccato() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM movimenti_trasmissione_rentri t
    WHERE t.movimento_id = NEW.id AND t.tenant_id = NEW.tenant_id AND t.origine = 'IMPORTAZIONE'
  ) THEN
    RAISE EXCEPTION 'waste_movements: il movimento importato % non ha la riga di blocco all''invio RENTRI (origine IMPORTAZIONE)', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER "waste_movements_importato_bloccato"
  AFTER INSERT ON "waste_movements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.import_source IS NOT NULL)
  EXECUTE FUNCTION waste_movements_importato_bloccato();
