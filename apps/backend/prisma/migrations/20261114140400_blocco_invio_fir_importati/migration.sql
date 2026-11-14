-- Fase 3 (3.1), D4 del piano `2026-11-14-fase3-import-piano`: blocco all'invio a RENTRI dei FIR
-- importati, tutto nel database (guardie e filtri applicativi sono nel Task 7).
--
-- Presuppone `20261114140200_provenienza_import` (`firs.import_source`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale):
--   1. `SET LOCAL lock_timeout = '5s'`;
--   2. colonne `firs.bloccato_invio` BOOLEAN NOT NULL DEFAULT false (le righe esistenti restano
--      sbloccate: nessun backfill, il default costante non riscrive la tabella) e
--      `firs.motivo_blocco_invio` VARCHAR(500) NULL;
--   3. CHECK `firs_bloccato_invio_motivo_check`: `NOT bloccato_invio OR motivo_blocco_invio IS NOT NULL`;
--   4. trigger `firs_blocco_invio_importati` (BEFORE INSERT) e `firs_sblocco_importati` (AFTER UPDATE OF bloccato_invio ... WHEN
--      (un importato bloccato diventa sbloccato): AFTER e non BEFORE perche' un BEFORE ROW che nomina
--      colonne cambia il lock dell'UPDATE e fa aspettare i FOR KEY SHARE, vedi la migration 100200):
--      INSERT: un FIR con `import_source` non nullo DEVE nascere con `bloccato_invio = true` (e il CHECK
--      pretende il motivo): non e' un default che si possa dimenticare;
--      UPDATE: un FIR importato non passa da bloccato a sbloccato in questo blocco (lo sblocco e' 3.6,
--      che allentera' la regola con una funzione dedicata e audit). Un FIR NON importato bloccato a
--      mano resta libero di essere sbloccato: il blocco e' piu' largo dell'import, l'obbligo vale solo
--      per gli importati.
--
-- I trigger non sono `SECURITY DEFINER` e non leggono altre tabelle.
--
-- Ripristino a mano (additiva, solo se nessun FIR e' importato): DROP TRIGGER firs_blocco_invio_importati
-- ON firs; DROP TRIGGER firs_sblocco_importati ON firs; DROP FUNCTION firs_blocco_invio_importati(); DROP FUNCTION firs_sblocco_importati(); ALTER TABLE firs DROP CONSTRAINT
-- firs_bloccato_invio_motivo_check, DROP COLUMN motivo_blocco_invio, DROP COLUMN bloccato_invio.
-- Ripristino da migration fallita (P3009): transazionale; se `firs` non ha la colonna `bloccato_invio`:
-- `npx prisma migrate resolve --rolled-back 20261114140400_blocco_invio_fir_importati`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "firs"
  ADD COLUMN "bloccato_invio" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivo_blocco_invio" VARCHAR(500),
  ADD CONSTRAINT "firs_bloccato_invio_motivo_check"
    CHECK (NOT "bloccato_invio" OR "motivo_blocco_invio" IS NOT NULL);

CREATE FUNCTION firs_blocco_invio_importati() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.import_source IS NOT NULL AND NOT NEW.bloccato_invio THEN
    RAISE EXCEPTION 'firs: un FIR importato nasce con bloccato_invio = true (invio a RENTRI bloccato fino alla riconciliazione)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "firs_blocco_invio_importati"
  BEFORE INSERT ON "firs"
  FOR EACH ROW WHEN (NEW."import_source" IS NOT NULL)
  EXECUTE FUNCTION firs_blocco_invio_importati();

CREATE FUNCTION firs_sblocco_importati() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'firs: un FIR importato non si sblocca prima della riconciliazione (3.6)'
    USING ERRCODE = '23514';
END
$fn$;

CREATE TRIGGER "firs_sblocco_importati"
  AFTER UPDATE OF "bloccato_invio" ON "firs"
  FOR EACH ROW WHEN (OLD."import_source" IS NOT NULL AND OLD."bloccato_invio" AND NOT NEW."bloccato_invio")
  EXECUTE FUNCTION firs_sblocco_importati();
