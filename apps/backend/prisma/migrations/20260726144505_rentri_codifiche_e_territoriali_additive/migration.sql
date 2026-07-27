-- CreateTable
CREATE TABLE "rentri_codifiche_semplici" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tabella" VARCHAR(30) NOT NULL,
    "external_id" VARCHAR(20) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "presente_in_rentri" BOOLEAN NOT NULL DEFAULT true,
    "rimosso_da_rentri_al" TIMESTAMP(3),
    "fonte" VARCHAR(20) NOT NULL DEFAULT 'rentri',

    CONSTRAINT "rentri_codifiche_semplici_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentri_province" (
    "id" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "regione_id" VARCHAR(10) NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "fine_validita" TIMESTAMP(3),
    "presente_in_rentri" BOOLEAN NOT NULL DEFAULT true,
    "rimosso_da_rentri_al" TIMESTAMP(3),
    "fonte" VARCHAR(20) NOT NULL DEFAULT 'rentri',

    CONSTRAINT "rentri_province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentri_comuni" (
    "id" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "code" VARCHAR(4) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "provincia_id" VARCHAR(10) NOT NULL,
    "cciaa" VARCHAR(2) NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "nuovo_id" VARCHAR(10),
    "fine_validita" TIMESTAMP(3),
    "presente_in_rentri" BOOLEAN NOT NULL DEFAULT true,
    "rimosso_da_rentri_al" TIMESTAMP(3),
    "fonte" VARCHAR(20) NOT NULL DEFAULT 'rentri',

    CONSTRAINT "rentri_comuni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentri_nazioni" (
    "id" VARCHAR(2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "presente_in_rentri" BOOLEAN NOT NULL DEFAULT true,
    "rimosso_da_rentri_al" TIMESTAMP(3),
    "fonte" VARCHAR(20) NOT NULL DEFAULT 'rentri',

    CONSTRAINT "rentri_nazioni_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rentri_codifiche_semplici_tabella_idx" ON "rentri_codifiche_semplici"("tabella");

-- CreateIndex
CREATE UNIQUE INDEX "rentri_codifiche_semplici_tabella_code_key" ON "rentri_codifiche_semplici"("tabella", "code");

-- CreateIndex
CREATE INDEX "rentri_province_code_idx" ON "rentri_province"("code");

-- CreateIndex
CREATE INDEX "rentri_comuni_provincia_id_idx" ON "rentri_comuni"("provincia_id");

-- CreateIndex
CREATE INDEX "rentri_comuni_name_idx" ON "rentri_comuni"("name");
