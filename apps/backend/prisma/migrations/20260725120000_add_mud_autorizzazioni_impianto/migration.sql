-- Scheda SA-AUT del MUD (record AU): autorizzazioni e certificazioni
-- dell'impianto del dichiarante. Prerequisito documentato delle schede SA-RIC
-- e dei moduli MG (gestione rifiuti).
--
-- Da non confondere con destinatari.numero_autorizzazione, che è
-- l'autorizzazione di un soggetto TERZO a cui si conferisce il rifiuto.

CREATE TABLE "autorizzazioni_impianto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    "estremi" VARCHAR(20) NOT NULL,
    "data_rilascio" DATE,
    "data_scadenza" DATE,
    -- 0=ND, 1=Provincia, 2=Regione, 3=Ministero
    "ente_autorizzante" SMALLINT NOT NULL DEFAULT 0,
    -- 0=ND, 1..6 (tracciato 6.04/24); 7, 8, 9 introdotti dal 6.04/25
    "tipo_autorizzazione" SMALLINT NOT NULL DEFAULT 0,
    "rinnovo_autocertificazione" BOOLEAN NOT NULL DEFAULT false,

    "operazioni_recupero" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "operazioni_smaltimento" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    "gestisce_vfu" BOOLEAN NOT NULL DEFAULT false,
    "gestisce_raee" BOOLEAN NOT NULL DEFAULT false,
    -- Autorizzazione EoW (art. 184-ter c.3): significativa solo per tipo 1, 2, 4, 5
    "autorizzazione_eow" BOOLEAN NOT NULL DEFAULT false,

    -- Capacità autorizzate in tonnellate/anno
    "impianto_incenerimento" BOOLEAN NOT NULL DEFAULT false,
    "capacita_complessiva_ta" INTEGER NOT NULL DEFAULT 0,
    "capacita_pericolosi_ta" INTEGER NOT NULL DEFAULT 0,
    "capacita_non_pericolosi_ta" INTEGER NOT NULL DEFAULT 0,
    "impianto_coincenerimento" BOOLEAN NOT NULL DEFAULT false,
    "capacita_coinc_complessiva_ta" INTEGER NOT NULL DEFAULT 0,
    "capacita_coinc_pericolosi_ta" INTEGER NOT NULL DEFAULT 0,
    "capacita_coinc_non_pericolosi_ta" INTEGER NOT NULL DEFAULT 0,

    "emas_prima_registrazione" DATE,
    "emas_numero_registrazione" VARCHAR(9),
    "iso14001_emissione" DATE,

    CONSTRAINT "autorizzazioni_impianto_pkey" PRIMARY KEY ("id")
);

-- Fino a 3 discariche per autorizzazione: il record AU prevede esattamente
-- tre blocchi (classificazione + capacità residua). Le eccedenti sono ignorate
-- in fase di export.
CREATE TABLE "autorizzazioni_impianto_discariche" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "autorizzazione_id" UUID NOT NULL,
    -- 0=ND, 6=rifiuti pericolosi, 7=rifiuti non pericolosi, 8=rifiuti inerti
    "classificazione" SMALLINT NOT NULL DEFAULT 0,
    "capacita_residua_mc" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "autorizzazioni_impianto_discariche_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "autorizzazioni_impianto_tenant_id_idx" ON "autorizzazioni_impianto"("tenant_id");
CREATE INDEX "autorizzazioni_impianto_discariche_autorizzazione_id_idx" ON "autorizzazioni_impianto_discariche"("autorizzazione_id");

ALTER TABLE "autorizzazioni_impianto"
    ADD CONSTRAINT "autorizzazioni_impianto_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "autorizzazioni_impianto_discariche"
    ADD CONSTRAINT "autorizzazioni_impianto_discariche_autorizzazione_id_fkey"
    FOREIGN KEY ("autorizzazione_id") REFERENCES "autorizzazioni_impianto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
