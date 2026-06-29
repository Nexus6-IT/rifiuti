-- Migrazione additiva: rende opzionali i campi di indirizzo sulla tabella tenants.
-- Necessario per il signup self-service (WS-G): il form di registrazione raccoglie
-- solo ragione sociale + P.IVA + dati admin; l'indirizzo può essere completato
-- successivamente dal pannello di amministrazione.
-- I tenant esistenti mantengono i valori già impostati; i vincoli NOT NULL vengono
-- eliminati soltanto a livello di schema (i DTO admin continuano a richiedere questi
-- campi per la creazione manuale via pannello SUPER_ADMIN).

ALTER TABLE "tenants" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "tenants" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "tenants" ALTER COLUMN "province" DROP NOT NULL;
ALTER TABLE "tenants" ALTER COLUMN "postal_code" DROP NOT NULL;
