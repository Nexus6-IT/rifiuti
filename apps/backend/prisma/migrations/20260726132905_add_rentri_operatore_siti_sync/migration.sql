-- R4 Task 3: unità locali RENTRI lette dall'ente, non digitate.
--
-- Aggiunge a `rentri_credentials` due colonne NULLABLE, nessun default
-- obbligatorio, zero impatto sulle righe esistenti:
--   - num_iscr_operatore: numero di iscrizione dell'OPERATORE (parametro
--     `num_iscr` di GET /anagrafiche/v1.0/operatore/{num_iscr}/siti). Senza
--     vincolo di formato: anagrafiche.yaml lo dichiara `string` semplice.
--   - siti_sincronizzati_al: timestamp dell'ultimo allineamento riuscito
--     delle unità locali del tenant, usato come cache TTL (1 ora) da
--     SincronizzaSitiUseCase per non richiamare l'ente a ogni apertura della
--     sezione «Unità locali».
--
-- NOTA su drift preesistente: `prisma migrate dev --create-only` ha
-- riproposto lo stesso drift già osservato e rimosso in precedenti
-- migrazioni di questo progetto (v. 20260726113432_add_rentri_unita_locale):
-- DROP di indici su tenants, ALTER su autorizzazioni_impianto/firs/
-- notifications/waste_movements, RENAME di un indice. Nessuna di queste
-- modifiche è oggetto di questo task: rimosse da qui, non applicate a
-- scatola chiusa (v. CLAUDE.md, drift già capitato tre volte).

-- AlterTable
ALTER TABLE "rentri_credentials"
    ADD COLUMN "num_iscr_operatore" VARCHAR(30),
    ADD COLUMN "siti_sincronizzati_al" TIMESTAMP(3);
