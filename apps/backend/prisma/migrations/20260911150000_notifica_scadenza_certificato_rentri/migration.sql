-- Aggiunge a notification_type il tipo di avviso generato dallo
-- scadenzario per la scadenza del certificato RENTRI (Task 2,
-- checkRentriCertificateExpiration). Additiva: nessun valore rimosso o
-- rinominato.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'CERTIFICATO_RENTRI_IN_SCADENZA';
