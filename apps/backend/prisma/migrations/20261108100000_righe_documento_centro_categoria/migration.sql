-- Fase 4 pezzo 4c (Task 30b): centro di ricavo e categoria dell'addebito fotografati sulle righe
-- del documento di fattura, per la chiave a cascata `CR:` -> `CAT:` -> `TIPO:` del conto ricavi
-- dell'export TeamSystem. Segue `20261107100000_fatturazione_mappature`.
--
-- Cosa fa: 1. lock_timeout; 2. due colonne nullable su `righe_documento_fattura`, della stessa
-- lunghezza di `codifiche_addebito.codice` (varchar(3)).
-- Additiva: nessun DROP, nessun dato esistente convertito (nulla in produzione ha righe con
-- definitive attive). Le righe gia' scritte restano con NULL e cadono sulla chiave `TIPO:`.
-- Il trigger `figlie_documento_immutabili` (migration 20261105100000) copre l'intera riga di un
-- documento non in bozza: le colonne nuove sono immutabili senza toccarlo.
-- Rollback: ALTER TABLE righe_documento_fattura DROP COLUMN centro_ricavo_codice,
-- DROP COLUMN categoria_codice; DELETE FROM _prisma_migrations WHERE migration_name = '20261108100000_righe_documento_centro_categoria';
SET LOCAL lock_timeout = '5s';

ALTER TABLE "righe_documento_fattura"
  ADD COLUMN "centro_ricavo_codice" VARCHAR(3),
  ADD COLUMN "categoria_codice" VARCHAR(3);
