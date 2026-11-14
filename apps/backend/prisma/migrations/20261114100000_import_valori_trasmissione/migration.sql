-- Fase 3 (3.1), D3 del piano `2026-11-14-fase3-import-piano`: valori di enum per i movimenti importati.
--
-- Cosa fa: aggiunge `DA_RICONCILIARE` a `stato_trasmissione_rentri` e `IMPORTAZIONE` a
-- `origine_trasmissione_rentri`. SOLO questo, in una migration a se': un valore di enum appena
-- aggiunto non si puo' usare nella stessa transazione (CHECK e trigger che lo citano stanno nella
-- migration `20261114100300_blocco_invio_importati`). E' additiva e innocua finche' nessuna riga li usa.
--
-- Ripristino a mano: un valore di enum non si toglie con un DROP. Finche' nessuna riga lo usa non
-- serve toglierlo; se proprio, ricreare il tipo senza il valore (ALTER TYPE ... RENAME, CREATE TYPE,
-- ALTER COLUMN ... TYPE ... USING) a tabella `movimenti_trasmissione_rentri` senza righe importate.
-- Ripristino da migration fallita (P3009): `ADD VALUE IF NOT EXISTS` e' idempotente; se uno dei due
-- valori manca, `npx prisma migrate resolve --rolled-back 20261114100000_import_valori_trasmissione`
-- e si rilancia.

SET LOCAL lock_timeout = '5s';

ALTER TYPE "stato_trasmissione_rentri" ADD VALUE IF NOT EXISTS 'DA_RICONCILIARE';
ALTER TYPE "origine_trasmissione_rentri" ADD VALUE IF NOT EXISTS 'IMPORTAZIONE';
