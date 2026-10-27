-- Fase 2 pezzo 4: versione del FIR per le scritture condizionate (lock ottimistico), additiva.
--
-- Cosa fa: aggiunge a `firs` la colonna `versione` (INTEGER NOT NULL DEFAULT 1). Ogni salvataggio
-- del repository la incrementa; chi ha letto il FIR con una versione e salva con un'altra riceve
-- un conflitto (409) invece di sovrascrivere in silenzio le modifiche di un'altra operazione.
--
-- Nessun backfill: le righe esistenti partono da 1 grazie al DEFAULT. Nessun GRANT e nessuna policy:
-- e' una colonna di una tabella gia' sotto RLS, i privilegi di tabella restano quelli attuali.
--
-- Ripristino a mano: ALTER TABLE firs DROP COLUMN versione; e' sicuro perche' nessun dato, vincolo
-- o indice dipende dalla colonna.

ALTER TABLE "firs" ADD COLUMN "versione" INTEGER NOT NULL DEFAULT 1;
