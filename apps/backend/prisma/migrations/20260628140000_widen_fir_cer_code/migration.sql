-- Il codice CER canonico del catalogo è nel formato "NN NN NN" (con spazi, "*"
-- per i pericolosi): fino a 9 caratteri. La colonna firs.cer_code era VARCHAR(6)
-- (formato compatto a 6 cifre) e andava in overflow scrivendo il codice
-- normalizzato. La si allarga a VARCHAR(10), coerente con cer_codes.code.
ALTER TABLE "firs" ALTER COLUMN "cer_code" TYPE VARCHAR(10);
