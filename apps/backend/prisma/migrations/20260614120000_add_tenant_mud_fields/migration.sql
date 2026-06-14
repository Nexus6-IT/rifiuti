-- Campi anagrafica dichiarante per il MUD.
ALTER TABLE "tenants" ADD COLUMN "codice_fiscale" VARCHAR(16);
ALTER TABLE "tenants" ADD COLUMN "telefono" VARCHAR(20);
ALTER TABLE "tenants" ADD COLUMN "rea_number" VARCHAR(9);
ALTER TABLE "tenants" ADD COLUMN "numero_addetti" INTEGER;
ALTER TABLE "tenants" ADD COLUMN "legale_rappresentante_nome" VARCHAR(25);
ALTER TABLE "tenants" ADD COLUMN "legale_rappresentante_cognome" VARCHAR(25);
ALTER TABLE "tenants" ADD COLUMN "civico" VARCHAR(10);
