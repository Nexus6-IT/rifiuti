-- Fase 2 pezzo 5, correzione della 20261030100000_causali_registro (additiva, quella gia' applicata non si tocca).
--
-- 1. Il CHECK `causali_registro_azienda_natura_disattivazione` confrontava `causale_sistema_codice = codice`:
--    con `causale_sistema_codice` NULL il confronto vale NULL e il CHECK passa. Una DISATTIVAZIONE senza
--    codice di sistema sfuggiva alla FK MATCH SIMPLE e all'unico, e poteva diventare bersaglio valido
--    della FK dei movimenti `AZ_`. Il CHECK viene ricreato con `IS NOT NULL` esplicito.
-- 2. Nuovo CHECK `causali_registro_azienda_codice_formato`, per tutte le nature (PROPRIA ha gia' `AZ_...`,
--    DISATTIVAZIONE ha il codice di una causale di sistema): `^[A-Z][A-Z0-9_]*$`.
-- 3. Commenti sul database (non si modifica la funzione gia' creata): il trigger e' una rete, non e'
--    race-free; la garanzia contro le corse sta nel `SELECT ... FOR UPDATE` del servizio di gestione (C5).
--
-- Nota sul controllo preventivo "nessun movimento AZ_" della migration precedente: con un owner NON
-- superuser e FORCE ROW LEVEL SECURITY su `waste_movements` conterebbe zero; il CHECK
-- `waste_movements_causale_azienda_coerente` (e la FK) restano la rete.
--
-- Ripristino (a mano): ricreare il vecchio CHECK senza `IS NOT NULL` e
-- DROP CONSTRAINT causali_registro_azienda_codice_formato.

ALTER TABLE "causali_registro_azienda" DROP CONSTRAINT "causali_registro_azienda_natura_disattivazione";
ALTER TABLE "causali_registro_azienda" ADD CONSTRAINT "causali_registro_azienda_natura_disattivazione" CHECK (
  "natura" <> 'DISATTIVAZIONE' OR (
    "causale_sistema_codice" IS NOT NULL
    AND "causale_sistema_codice" = "codice"
    AND "descrizione" IS NULL AND "ruolo_mud" IS NULL AND "codice_rentri" IS NULL
    AND "operazione" IS NULL AND "valida_dal" IS NULL AND "valida_al" IS NULL));

ALTER TABLE "causali_registro_azienda" ADD CONSTRAINT "causali_registro_azienda_codice_formato"
  CHECK ("codice" ~ '^[A-Z][A-Z0-9_]*$');

COMMENT ON FUNCTION "causali_registro_azienda_controlli"() IS
  'Rete del database per le versioni delle causali aziendali; NON e'' race-free (due transazioni concorrenti possono non vedersi). La garanzia sta nel SELECT ... FOR UPDATE del servizio di gestione.';
