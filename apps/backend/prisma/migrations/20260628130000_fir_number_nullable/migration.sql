-- Il numero progressivo del FIR viene assegnato all'EMISSIONE, non alla
-- creazione: una BOZZA non ha ancora un numero. Rende quindi nullable la
-- colonna fir_number. L'indice unico (tenant_id, fir_number) resta valido:
-- in PostgreSQL i NULL sono considerati distinti, quindi piu' bozze senza
-- numero per lo stesso tenant sono ammesse.
ALTER TABLE "firs" ALTER COLUMN "fir_number" DROP NOT NULL;
