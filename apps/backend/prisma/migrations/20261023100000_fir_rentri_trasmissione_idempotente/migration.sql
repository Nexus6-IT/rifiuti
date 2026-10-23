-- RENTRI B1: creazione del FIR senza doppioni.
--
-- rentri_transazione_in_attesa: transazione di creazione accettata dall'ente e non ancora
-- letta fino all'esito; salvata subito, cosi' un tentativo successivo la riprende invece di
-- creare un secondo formulario. rentri_sync_avviato_at: istante in cui un processo ha
-- prenotato la trasmissione (SYNCING); oltre la soglia di stallo la prenotazione e'
-- riprendibile e il job di recupero la elenca.
-- TIMESTAMPTZ: e' un istante assoluto confrontato con la soglia di stallo, non deve
-- dipendere dal fuso della sessione.
--
-- Additiva: due colonne nullable e un indice, nessuna DROP, nessun backfill necessario
-- (NULL = nessuna prenotazione in corso).
ALTER TABLE "firs" ADD COLUMN "rentri_transazione_in_attesa" VARCHAR(100);
ALTER TABLE "firs" ADD COLUMN "rentri_sync_avviato_at" TIMESTAMPTZ(3);

CREATE INDEX "firs_rentri_sync_status_rentri_sync_avviato_at_idx"
  ON "firs"("rentri_sync_status", "rentri_sync_avviato_at");
