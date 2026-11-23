-- eREGI E3: modificare e chiudere il registro RENTRI da WasteFlow.
--
-- Cosa: `rentri_chiusura_richiesta_il` su `registri_rifiuti`, la prenotazione della chiusura.
-- Perche': la chiusura su RENTRI (DELETE) e' irreversibile e non si ritenta su esito incerto.
-- WasteFlow la prenota sotto lock PRIMA della chiamata: da quel momento nessun lotto parte piu'
-- verso il registro (la prenotazione di un lotto la vede), e un esito incerto si risolve per
-- lettura (`data_chiusura`) senza perdere lo stato. `rentri_chiuso_il` (E2) si scrive solo a
-- chiusura confermata. Azzerata se la chiusura e' rifiutata o non avvenuta.
-- Additiva: una colonna nullable, nessun backfill, nessuna tabella nuova (RLS e catalogo
-- invariati). Nessun GRANT: i ruoli applicativi li ricevono dai default privileges.
--
-- Rollback (non eseguito in automatico):
--   ALTER TABLE registri_rifiuti
--     DROP CONSTRAINT registri_rifiuti_chiusura_con_identificativo_check,
--     DROP COLUMN rentri_chiusura_richiesta_il;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261122100000_registro_rentri_chiusura';

SET LOCAL lock_timeout = '5s';

ALTER TABLE "registri_rifiuti"
  ADD COLUMN "rentri_chiusura_richiesta_il" TIMESTAMPTZ(3);

ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_chiusura_con_identificativo_check"
  CHECK ("rentri_chiusura_richiesta_il" IS NULL OR "identificativo_rentri" IS NOT NULL);
