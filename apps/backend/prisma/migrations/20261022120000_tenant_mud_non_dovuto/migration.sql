-- A-W-10: flag per azienda "MUD non dovuto" (come il flag MUD S/N di WinWaste), impostato
-- da un amministratore dell'azienda. Con il flag lo scadenzario non manda promemoria del
-- MUD e la pagina MUD lo mostra; il file si puo' generare comunque.
--
-- Additiva e non puo' fallire: la colonna NOT NULL ha DEFAULT false, quindi tutte le righe
-- esistenti restano tenute al MUD come oggi; le altre tre sono nullable (motivo, data e
-- utente si valorizzano solo con il flag attivo). Nessuna FK su mud_non_dovuto_da: e'
-- traccia di chi l'ha impostato, come impostato_da di registro_progressivi_iniziali.
ALTER TABLE "tenants" ADD COLUMN "mud_non_dovuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "mud_non_dovuto_motivo" VARCHAR(500);
ALTER TABLE "tenants" ADD COLUMN "mud_non_dovuto_il" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "mud_non_dovuto_da" UUID;
