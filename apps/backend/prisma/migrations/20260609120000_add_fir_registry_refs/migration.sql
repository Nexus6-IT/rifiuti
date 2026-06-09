-- Riferimenti al registro (Produttore/Trasportatore/Destinatario) da cui è stato
-- preso lo snapshot anagrafico immutabile del FIR. Nullable per compatibilità
-- con i FIR esistenti; nessun vincolo FK per non accoppiare il documento legale
-- al ciclo di vita delle anagrafiche (lo snapshot resta valido anche se il
-- registro cambia o viene rimosso).
ALTER TABLE "firs" ADD COLUMN "producer_id" UUID;
ALTER TABLE "firs" ADD COLUMN "carrier_id" UUID;
ALTER TABLE "firs" ADD COLUMN "receiver_id" UUID;
