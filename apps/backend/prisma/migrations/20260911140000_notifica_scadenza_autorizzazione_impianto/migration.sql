-- Aggiunge a notification_type il tipo di avviso generato dallo
-- scadenzario per le autorizzazioni degli impianti (Task 1,
-- checkAuthorizationExpirations). Additiva: nessun valore rimosso o
-- rinominato.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'AUTORIZZAZIONE_IN_SCADENZA';
