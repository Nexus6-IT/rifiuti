-- Momento reale della presa in carico del FIR, separato da `transport_date`.
-- `transport_date` entra nel documento firmato e non va riscritto dopo l'emissione; la presa in
-- carico lo riscriveva e invalidava le firme di produttore e trasportatore.
-- Additiva: colonna nullable, nessun backfill (i FIR esistenti sono dati di test; il codice ripiega
-- su `transport_date` quando la colonna e' vuota).
ALTER TABLE "firs" ADD COLUMN "presa_in_carico_il" TIMESTAMPTZ(6);
