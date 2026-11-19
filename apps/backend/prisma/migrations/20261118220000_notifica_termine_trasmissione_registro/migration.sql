-- eREGI E0: avviso del termine di trasmissione mensile del registro a RENTRI.
-- Aggiunge a notification_type il tipo generato dal controllo giornaliero dello scadenzario
-- (una notifica per registro e per giorno, da 5 giorni prima del termine e finche' e' superato).
-- Additiva: nessun valore rimosso o rinominato.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'TRASMISSIONE_REGISTRO_IN_SCADENZA';
