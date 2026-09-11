-- Task 3 dello scadenzario: la data di scadenza delle controparti non
-- esisteva. Aggiunge due colonne NULLABLE (additiva, forward-only): per
-- trasportatori e destinatari non si inventa una scadenza per le anagrafiche
-- già esistenti, che restano semplicemente senza avviso finché non viene
-- valorizzata.
ALTER TABLE "trasportatori" ADD COLUMN "scadenza_iscrizione" DATE;
ALTER TABLE "destinatari" ADD COLUMN "scadenza_autorizzazione" DATE;
