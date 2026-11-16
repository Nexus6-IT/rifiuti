-- Comunicazioni consorzi: metodo dei pesi specifici con cui e' calcolato `hash_dati`.
--
-- Le giacenze O.R.SO. ora convertono ogni movimento coi pesi specifici del SUO anno (prima, tutti
-- coi pesi dell'anno della comunicazione). Le comunicazioni gia' generate o inviate devono tenere
-- valori e confronto «modificata dopo l'invio» di prima: la colonna dice con quale metodo e'
-- stato calcolato l'hash, e il confronto ricalcola con lo stesso metodo. Le righe esistenti
-- prendono il default 'ANNO_COMUNICAZIONE' (il metodo storico); quelle nuove scrivono
-- 'PESI_PER_ANNO' dall'applicazione. Solo additiva (default costante: nessuna riscrittura).
--
-- Ripristino a mano: ALTER TABLE "comunicazioni_consorzi" DROP CONSTRAINT "comunicazioni_consorzi_metodo_pesi_ammesso",
--   DROP COLUMN "metodo_pesi";

ALTER TABLE "comunicazioni_consorzi"
  ADD COLUMN "metodo_pesi" VARCHAR(20) NOT NULL DEFAULT 'ANNO_COMUNICAZIONE',
  ADD CONSTRAINT "comunicazioni_consorzi_metodo_pesi_ammesso"
    CHECK ("metodo_pesi" IN ('ANNO_COMUNICAZIONE', 'PESI_PER_ANNO'));
