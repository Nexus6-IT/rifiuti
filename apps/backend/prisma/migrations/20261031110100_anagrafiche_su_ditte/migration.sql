-- Fase 2 pezzo 10 (F2-10), Task 3b-2: le righe di ruolo (produttori, trasportatori, destinatari)
-- vivono su ditte e sedi; le colonne vecchie diventano copia congelata (D6, I6 del piano
-- `2026-10-28-fase2-10-controparti`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale: un RAISE EXCEPTION annulla tutto):
--   1. `lock_timeout` di 5 secondi: le tabelle sono vive, meglio fallire che accodare le scritture;
--   2. richiama `f210_collega_anagrafiche()`: completa le righe create dal backend vecchio fra la
--      migration 20261031110000 e l'avvio del nuovo (il deploy applica le migration mentre il
--      vecchio e' ancora in servizio), poi elimina la funzione (non serve piu');
--   3. controllo di sicurezza fail-closed: nessuna riga con `ditta_id` o `sede_id` NULL, altrimenti
--      RAISE EXCEPTION con i SOLI conteggi per tabella;
--   4. `ditta_id` e `sede_id` diventano NOT NULL;
--   5. le colonne vecchie (ragione sociale, partita IVA, indirizzo) perdono il NOT NULL: il nuovo
--      backend non le scrive piu' (un privato, per esempio, non ha la partita IVA);
--   6. cadono i tre indici unici `*_tenant_id_partita_iva_key`: l'unicita' sta in `ditte`;
--   7. COMMENT ON COLUMN: copia congelata.
-- Nessun dato viene cancellato.
--
-- Ripristino a mano (additivo salvo i DROP NOT NULL): ricreare gli indici unici
-- `<tabella>_tenant_id_partita_iva_key` su (tenant_id, partita_iva) solo se tutte le righe hanno
-- ancora la partita IVA, poi SET NOT NULL sulle colonne vecchie e DROP NOT NULL su
-- `ditta_id`/`sede_id`. Ripristino da migration fallita (P3009): vedi `ops/README.md`.

SET LOCAL lock_timeout = '5s';

-- 2. Completamento e eliminazione della funzione -----------------------------------------------

SELECT f210_collega_anagrafiche();

DROP FUNCTION f210_collega_anagrafiche();

-- 3. Controllo di sicurezza --------------------------------------------------------------------

DO $$
DECLARE
  v_produttori bigint;
  v_trasportatori bigint;
  v_destinatari bigint;
BEGIN
  SELECT count(*) INTO v_produttori FROM produttori WHERE ditta_id IS NULL OR sede_id IS NULL;
  SELECT count(*) INTO v_trasportatori FROM trasportatori WHERE ditta_id IS NULL OR sede_id IS NULL;
  SELECT count(*) INTO v_destinatari FROM destinatari WHERE ditta_id IS NULL OR sede_id IS NULL;
  IF v_produttori + v_trasportatori + v_destinatari > 0 THEN
    RAISE EXCEPTION 'F2-10: righe di ruolo senza ditta o sede (produttori=%, trasportatori=%, destinatari=%)',
      v_produttori, v_trasportatori, v_destinatari;
  END IF;
END
$$;

-- 4. ditta_id e sede_id obbligatori ------------------------------------------------------------

ALTER TABLE "produttori" ALTER COLUMN "ditta_id" SET NOT NULL, ALTER COLUMN "sede_id" SET NOT NULL;
ALTER TABLE "trasportatori" ALTER COLUMN "ditta_id" SET NOT NULL, ALTER COLUMN "sede_id" SET NOT NULL;
ALTER TABLE "destinatari" ALTER COLUMN "ditta_id" SET NOT NULL, ALTER COLUMN "sede_id" SET NOT NULL;

-- 5. Colonne vecchie senza NOT NULL ------------------------------------------------------------

ALTER TABLE "produttori"
  ALTER COLUMN "ragione_sociale" DROP NOT NULL, ALTER COLUMN "partita_iva" DROP NOT NULL,
  ALTER COLUMN "via" DROP NOT NULL, ALTER COLUMN "civico" DROP NOT NULL,
  ALTER COLUMN "cap" DROP NOT NULL, ALTER COLUMN "comune" DROP NOT NULL,
  ALTER COLUMN "provincia" DROP NOT NULL;
ALTER TABLE "trasportatori"
  ALTER COLUMN "ragione_sociale" DROP NOT NULL, ALTER COLUMN "partita_iva" DROP NOT NULL,
  ALTER COLUMN "via" DROP NOT NULL, ALTER COLUMN "civico" DROP NOT NULL,
  ALTER COLUMN "cap" DROP NOT NULL, ALTER COLUMN "comune" DROP NOT NULL,
  ALTER COLUMN "provincia" DROP NOT NULL;
ALTER TABLE "destinatari"
  ALTER COLUMN "ragione_sociale" DROP NOT NULL, ALTER COLUMN "partita_iva" DROP NOT NULL,
  ALTER COLUMN "via" DROP NOT NULL, ALTER COLUMN "civico" DROP NOT NULL,
  ALTER COLUMN "cap" DROP NOT NULL, ALTER COLUMN "comune" DROP NOT NULL,
  ALTER COLUMN "provincia" DROP NOT NULL;

-- 6. Indici unici sulla partita IVA ------------------------------------------------------------

DROP INDEX "produttori_tenant_id_partita_iva_key";
DROP INDEX "trasportatori_tenant_id_partita_iva_key";
DROP INDEX "destinatari_tenant_id_partita_iva_key";

-- 7. Commenti ----------------------------------------------------------------------------------

COMMENT ON COLUMN "produttori"."ragione_sociale" IS 'F2-10: copia congelata, non più scritta (vale ditte.ragione_sociale). Serve solo al MUD storico.';
COMMENT ON COLUMN "trasportatori"."ragione_sociale" IS 'F2-10: copia congelata, non più scritta (vale ditte.ragione_sociale). Serve solo al MUD storico.';
COMMENT ON COLUMN "destinatari"."ragione_sociale" IS 'F2-10: copia congelata, non più scritta (vale ditte.ragione_sociale). Serve solo al MUD storico.';
COMMENT ON COLUMN "produttori"."partita_iva" IS 'F2-10: copia congelata, non più scritta (vale ditte.partita_iva).';
COMMENT ON COLUMN "trasportatori"."partita_iva" IS 'F2-10: copia congelata, non più scritta (vale ditte.partita_iva).';
COMMENT ON COLUMN "destinatari"."partita_iva" IS 'F2-10: copia congelata, non più scritta (vale ditte.partita_iva).';
COMMENT ON COLUMN "produttori"."via" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.via).';
COMMENT ON COLUMN "trasportatori"."via" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.via).';
COMMENT ON COLUMN "destinatari"."via" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.via).';
COMMENT ON COLUMN "produttori"."civico" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.civico).';
COMMENT ON COLUMN "trasportatori"."civico" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.civico).';
COMMENT ON COLUMN "destinatari"."civico" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.civico).';
COMMENT ON COLUMN "produttori"."cap" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.cap).';
COMMENT ON COLUMN "trasportatori"."cap" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.cap).';
COMMENT ON COLUMN "destinatari"."cap" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.cap).';
COMMENT ON COLUMN "produttori"."comune" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.comune).';
COMMENT ON COLUMN "trasportatori"."comune" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.comune).';
COMMENT ON COLUMN "destinatari"."comune" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.comune).';
COMMENT ON COLUMN "produttori"."provincia" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.provincia).';
COMMENT ON COLUMN "trasportatori"."provincia" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.provincia).';
COMMENT ON COLUMN "destinatari"."provincia" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.provincia).';
COMMENT ON COLUMN "produttori"."email" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.email).';
COMMENT ON COLUMN "trasportatori"."email" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.email).';
COMMENT ON COLUMN "destinatari"."email" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.email).';
COMMENT ON COLUMN "produttori"."telefono" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.telefono).';
COMMENT ON COLUMN "trasportatori"."telefono" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.telefono).';
COMMENT ON COLUMN "destinatari"."telefono" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.telefono).';
COMMENT ON COLUMN "produttori"."pec" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.pec).';
COMMENT ON COLUMN "trasportatori"."pec" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.pec).';
COMMENT ON COLUMN "destinatari"."pec" IS 'F2-10: copia congelata, non più scritta (vale sedi_ditte.pec).';
