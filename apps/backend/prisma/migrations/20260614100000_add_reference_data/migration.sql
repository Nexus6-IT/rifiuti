-- Dati di riferimento condivisi (globali): ATECO + ISTAT nazioni/province/comuni.
CREATE TABLE "ateco_codes" (
    "code" VARCHAR(10) NOT NULL,
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ateco_codes_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "istat_nazioni" (
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "iso3" VARCHAR(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "istat_nazioni_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "istat_nazioni_name_idx" ON "istat_nazioni"("name");

CREATE TABLE "istat_province" (
    "sigla" VARCHAR(2) NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "regione" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "istat_province_pkey" PRIMARY KEY ("sigla")
);
CREATE UNIQUE INDEX "istat_province_code_key" ON "istat_province"("code");
CREATE INDEX "istat_province_name_idx" ON "istat_province"("name");

CREATE TABLE "istat_comuni" (
    "code" VARCHAR(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "provincia_sigla" VARCHAR(2) NOT NULL,
    "codice_catastale" VARCHAR(4),
    "cap" VARCHAR(5),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "istat_comuni_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "istat_comuni_name_idx" ON "istat_comuni"("name");
CREATE INDEX "istat_comuni_provincia_sigla_idx" ON "istat_comuni"("provincia_sigla");
CREATE INDEX "istat_comuni_name_provincia_sigla_idx" ON "istat_comuni"("name", "provincia_sigla");
