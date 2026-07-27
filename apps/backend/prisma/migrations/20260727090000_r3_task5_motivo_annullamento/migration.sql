-- Migrazione additiva: aggiunge il campo motivo_annullamento su "firs"
-- (R3 Task 5). Nullable, nessun default richiesto: un FIR mai annullato non
-- lo valorizza. Vincolo di lunghezza allineato al contratto RENTRI
-- (NoteAnnullamentoModel.note, maxLength 1024) perché lo stesso testo viene
-- anche trasmesso all'ente per un FIR legato (POST /note-annullamento).
-- Forward-only. Mai modificare una migrazione già applicata.

ALTER TABLE "firs"
  ADD COLUMN IF NOT EXISTS "motivo_annullamento" VARCHAR(1024);
