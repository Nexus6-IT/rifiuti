-- Allinea la STORIA DELLE MIGRAZIONI a ciò che esiste davvero in produzione.
--
-- Perché questa migrazione esiste: da settimane ogni `prisma migrate dev`
-- generava, in coda alla modifica richiesta, lo stesso blocco di modifiche MAI
-- chieste da nessuno (il "drift"). Finora è stato cancellato a mano cinque
-- volte, una per migrazione. Bastava dimenticarsene una volta per portare in
-- produzione un `DROP INDEX` che nessuno aveva deciso.
--
-- Il drift non era un errore unico: era di due nature opposte, verificate una
-- per una contro il database di produzione (102 colonne temporali, indici,
-- default reali) prima di scegliere da che parte stesse la ragione.
--
--   a) Voci in cui aveva ragione il DATABASE e il modello aveva perso
--      l'informazione — i due indici di `tenants` e i default lista vuota di
--      `autorizzazioni_impianto`. Risolte RIDICHIARANDOLE in `schema.prisma`:
--      qui non compaiono, perché non c'è nulla da cambiare nel database.
--
--   b) Voci in cui aveva ragione il MODELLO e il database era avanti alla
--      storia (cambiato a mano, o da un'immagine, senza migrazione). Sono
--      queste sotto.

-- (1) Estensione richiesta dal modello e presente in produzione, mai
-- registrata da una migrazione: un ambiente ricostruito dalla sola storia non
-- l'avrebbe avuta.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- (2) Default già presente in produzione e già dichiarato nel modello, mai
-- passato per una migrazione.
ALTER TABLE "notifications" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '30 days';

-- (3) `firs.fourth_copy_returned_at` era l'UNICA colonna applicativa con fuso
-- orario su 102 colonne temporali del database (le altre tre `timestamptz`
-- appartengono alla tabella interna di Prisma). Una colonna che si comporta
-- diversamente da tutte le altre è una trappola: due date lette dalla stessa
-- riga si confrontano male.
--
-- La conversione è a VALORE INVARIATO, verificato sulle 4 righe non nulle
-- presenti in produzione: sono tutte memorizzate in UTC e le colonne sorelle
-- (`created_at`, senza fuso) contengono lo stesso orario di parete UTC.
-- `AT TIME ZONE 'UTC'` è esplicito di proposito: il cast implicito userebbe il
-- fuso della sessione e darebbe lo stesso risultato solo finché la sessione
-- resta su UTC.
ALTER TABLE "firs" ALTER COLUMN "fourth_copy_returned_at" TYPE TIMESTAMP(3)
  USING "fourth_copy_returned_at" AT TIME ZONE 'UTC';

-- (4) Default che il modello non dichiara e che MASCHERANO un dato non valido
-- invece di rifiutarlo: un movimento con numero progressivo 0 non esiste nel
-- registro di carico/scarico (art. 190 D.Lgs. 152/2006), e una causale che
-- scivola silenziosamente su 'ALTRO_CARICO' descrive male il movimento in un
-- registro tenuto per legge. Tolti i default, un inserimento che omette il
-- campo fallisce subito e visibilmente invece di scrivere un dato plausibile e
-- sbagliato. Nessun percorso applicativo li omette: l'unico SQL grezzo su
-- questa tabella è un advisory lock, e Prisma invia sempre i campi obbligatori.
-- Le righe già presenti non vengono toccate: togliere un default non riscrive
-- nulla.
ALTER TABLE "waste_movements" ALTER COLUMN "progressive_number" DROP DEFAULT,
  ALTER COLUMN "progressive_year" DROP DEFAULT,
  ALTER COLUMN "causale" DROP DEFAULT;

-- (5) Solo il nome dell'indice: PostgreSQL aveva troncato l'identificatore in
-- modo diverso da quanto Prisma si aspetta. Nessun effetto sui dati.
ALTER INDEX "waste_movements_tenant_id_progressive_year_progressive_number_k"
  RENAME TO "waste_movements_tenant_id_progressive_year_progressive_numb_key";
