-- Seguito 4.9b: una regola senza data di inizio vale da sempre, non da oggi.
-- Migration additiva: la precedente e' gia' applicata e non si tocca.
ALTER TABLE "regole_consorzio" ALTER COLUMN "valida_dal" SET DEFAULT DATE '1970-01-01';
