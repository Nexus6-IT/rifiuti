-- Seguito di F2-9 (decisione di Graziano, 31/10/2026): escludere una singola annotazione
-- dall'invio automatico del registro a RENTRI.
--
-- Cosa fa: tre colonne NULLABLE su `movimenti_trasmissione_rentri` (nessun backfill, nessuna riga
-- toccata) e un CHECK che le tiene coerenti. Una riga "esclusa" resta `DA_TRASMETTERE` ma la
-- prenotazione (`prenota`) non la sceglie mai; poiche' la riga ESISTE, l'adozione automatica
-- (`NOT EXISTS`) non la ricrea. Perche' sulla riga di trasmissione e non su `waste_movements`
-- (tabella calda e immutabile del registro) ne' in una tabella nuova (+1 RLS): la riga di
-- trasmissione ha gia' RLS, trigger e audit, e l'esclusione ha senso solo finche' l'annotazione
-- non e' partita.
--
-- Il CHECK impedisce che una riga esclusa cambi stato: un'annotazione gia' partita (IN_INVIO,
-- ATTESA_ESITO, INCERTA, TRASMESSA, GIA_SU_RENTRI...) non puo' portare l'esclusione, quindi
-- l'esclusione non tocca mai righe che RENTRI potrebbe avere.
--
-- RLS invariata (44 tabelle con RLS). Nessun GRANT.
--
-- Ripristino a mano (solo prima di usare la funzione, altrimenti si perde il motivo):
--   ALTER TABLE movimenti_trasmissione_rentri
--     DROP CONSTRAINT movimenti_trasmissione_rentri_esclusione_check,
--     DROP COLUMN escluso_il, DROP COLUMN escluso_da, DROP COLUMN motivo_esclusione;
-- Da migration fallita (P3009):
--   npx prisma migrate resolve --rolled-back 20261102100000_rentri_esclusione_invio_automatico

SET LOCAL lock_timeout = '5s';

ALTER TABLE "movimenti_trasmissione_rentri"
  ADD COLUMN "escluso_il" TIMESTAMPTZ(3),
  ADD COLUMN "escluso_da" UUID,
  ADD COLUMN "motivo_esclusione" VARCHAR(500);

ALTER TABLE "movimenti_trasmissione_rentri"
  ADD CONSTRAINT "movimenti_trasmissione_rentri_esclusione_check" CHECK (
    ("escluso_il" IS NULL AND "escluso_da" IS NULL AND "motivo_esclusione" IS NULL)
    OR ("escluso_il" IS NOT NULL AND "motivo_esclusione" IS NOT NULL
        AND "stato" = 'DA_TRASMETTERE' AND NOT "bloccato_invio")
  );
