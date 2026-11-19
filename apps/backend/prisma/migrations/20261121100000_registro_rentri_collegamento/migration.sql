-- eREGI E2 (modello M1): collegare o aprire il registro RENTRI da WasteFlow.
--
-- Cosa: colonne su `registri_rifiuti` per le attivita' del registro su RENTRI, la prenotazione
-- dell'apertura (impedisce due POST di apertura e permette di risolvere un esito incerto per
-- lettura), la chiusura su RENTRI e l'ultima sincronizzazione.
-- Perche': oggi l'ADMIN copia a mano l'identificativo `R...` dal portale; l'apertura da
-- WasteFlow e' una scrittura irreversibile e non idempotente, quindi serve uno stato locale.
-- Additiva: nessun backfill, nessuna tabella nuova (RLS invariata). Nessun GRANT: i ruoli
-- applicativi li ricevono dai default privileges di `ops/db-ruoli.sh`.
--
-- Scelta rispetto al piano (§4.1): le due liste sono NOT NULL DEFAULT '{}' e non NULL, perche'
-- Prisma non ha liste opzionali; "vuota" significa "dettaglio non noto". In piu'
-- `rentri_apertura_descrizione` conserva la descrizione richiesta per riconoscere, dopo un esito
-- incerto, il registro aperto dalla nostra POST.
--
-- Rollback (non eseguito in automatico):
--   ALTER TABLE registri_rifiuti
--     DROP CONSTRAINT registri_rifiuti_rentri_attivita_check,
--     DROP CONSTRAINT registri_rifiuti_rentri_attivita_rec_smalt_check,
--     DROP CONSTRAINT registri_rifiuti_rentri_rec_smalt_richiesti_check,
--     DROP CONSTRAINT registri_rifiuti_chiuso_con_identificativo_check,
--     DROP COLUMN rentri_attivita, DROP COLUMN rentri_attivita_rec_smalt,
--     DROP COLUMN rentri_apertura_richiesta_il, DROP COLUMN rentri_apertura_descrizione,
--     DROP COLUMN rentri_chiuso_il, DROP COLUMN rentri_sincronizzato_il;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261121100000_registro_rentri_collegamento';

SET LOCAL lock_timeout = '5s';

ALTER TABLE "registri_rifiuti"
  ADD COLUMN "rentri_attivita" VARCHAR(40)[] NOT NULL DEFAULT '{}',
  ADD COLUMN "rentri_attivita_rec_smalt" VARCHAR(4)[] NOT NULL DEFAULT '{}',
  ADD COLUMN "rentri_apertura_richiesta_il" TIMESTAMPTZ(3),
  ADD COLUMN "rentri_apertura_descrizione" VARCHAR(250),
  ADD COLUMN "rentri_chiuso_il" TIMESTAMPTZ(3),
  ADD COLUMN "rentri_sincronizzato_il" TIMESTAMPTZ(3);

-- Valori ammessi dal contratto (anagrafiche.yaml, CreateRegistroRequest).
ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_rentri_attivita_check"
  CHECK ("rentri_attivita" <@ ARRAY[
    'CentroRaccolta', 'Produzione', 'Recupero', 'Smaltimento', 'Trasporto',
    'IntermediazioneSenzaDetenzione'
  ]::VARCHAR[]);

ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_rentri_attivita_rec_smalt_check"
  CHECK ("rentri_attivita_rec_smalt" <@ ARRAY[
    'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15'
  ]::VARCHAR[]);

-- Recupero o Smaltimento richiedono i codici R/D.
ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_rentri_rec_smalt_richiesti_check"
  CHECK (
    NOT ("rentri_attivita" && ARRAY['Recupero', 'Smaltimento']::VARCHAR[])
    OR cardinality("rentri_attivita_rec_smalt") > 0
  );

ALTER TABLE "registri_rifiuti"
  ADD CONSTRAINT "registri_rifiuti_chiuso_con_identificativo_check"
  CHECK ("rentri_chiuso_il" IS NULL OR "identificativo_rentri" IS NOT NULL);
