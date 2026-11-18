-- Sede della ditta controparte del movimento: colonna strutturata `waste_movements.counterpart_sede_id`.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. `lock_timeout` di 5 s: se la tabella e' occupata la migration fallisce subito invece di
--      mettere in coda le scritture del registro dietro il suo lock;
--   2. aggiunge la colonna nullable `counterpart_sede_id` (UUID);
--   3. aggiunge la chiave esterna composta `(counterpart_sede_id, tenant_id)` verso
--      `sedi_ditte(id, tenant_id)`, NO ACTION, come le altre FK del movimento: la cascata da `tenants`
--      toglie movimenti e sedi nello stesso statement. Prima NOT VALID e poi VALIDATE: la colonna e'
--      tutta NULL, quindi la scansione e' veloce.
--
-- Additiva: nessuna colonna resa NOT NULL, nessun CHECK, nessun trigger.
-- Nessun backfill: i movimenti storici restano NULL (il resolver di O.R.SO. ripiega sul FIR e sul
-- nome della controparte). Dedurre la sede dal nome vorrebbe dire scrivere con un UPDATE su righe di
-- un registro vidimato (R13): e' un pezzo a parte.
-- Nessun indice (decisione D1): nessuna query filtra per sede e la FK non ne ha bisogno, perche'
-- `id` e `tenant_id` delle sedi non si aggiornano e le sedi non si cancellano mai (si disattivano).
-- Un CREATE INDEX su `waste_movements` in una migration transazionale bloccherebbe le scritture del
-- registro per tutta la durata della costruzione.
-- La colonna sta FUORI dall'hash di vidimazione (`hashAnnotazioneV2` non la contiene): aggiungerla
-- non invalida nessuna catena e `verifica-catena-registro` resta invariato.
-- Il conteggio delle tabelle con `tenant_id` (88, rls-catalogo) non cambia: nessuna tabella nuova.
--
-- Ripristino (a mano), in quest'ordine, SOLO se nessuna riga ha la colonna valorizzata
-- (`SELECT count(*) FROM waste_movements WHERE counterpart_sede_id IS NOT NULL`):
--   ALTER TABLE waste_movements DROP CONSTRAINT waste_movements_counterpart_sede_fkey;
--   ALTER TABLE waste_movements DROP COLUMN counterpart_sede_id;
-- Se la migration si ferma a meta' (P3009), dopo aver ripristinato lo stato:
--   npx prisma migrate resolve --rolled-back 20261118100000_movimenti_sede_controparte

SET LOCAL lock_timeout = '5s';

ALTER TABLE "waste_movements" ADD COLUMN "counterpart_sede_id" UUID;

ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_counterpart_sede_fkey"
  FOREIGN KEY ("counterpart_sede_id", "tenant_id")
  REFERENCES "sedi_ditte"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "waste_movements" VALIDATE CONSTRAINT "waste_movements_counterpart_sede_fkey";
