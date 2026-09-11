-- Aggiunge a notification_type i due tipi di avviso generati dallo
-- scadenzario per le scadenze delle controparti (Task 3, estensione di
-- checkAuthorizationExpirations a Trasportatore.scadenzaIscrizione e
-- Destinatario.scadenzaAutorizzazione). Additiva: nessun valore rimosso o
-- rinominato.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'DESTINATARIO_AUTORIZZAZIONE_IN_SCADENZA';
