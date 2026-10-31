-- 4.6: abbinamento carichi-scarichi (stoccaggio R13/D15).
--
-- Aggiunge la tabella abbinamenti_carico_scarico (quale carico, o giacenza iniziale, ha coperto
-- quale scarico e per quanto), l'enum origine_abbinamento e un indice unico su giacenze_iniziali
-- (destinazione della chiave esterna). Additiva: nessuna colonna nuova su waste_movements, nessun
-- dato esistente cambia; il codice vecchio ignora la tabella. Nessun backfill.
--
-- Ripristino (a mano): DROP TABLE abbinamenti_carico_scarico; DROP TYPE origine_abbinamento;
-- DROP INDEX giacenze_iniziali_id_registro_tenant_key; e togliere la riga di questa migration da
-- _prisma_migrations. Prima controllare
-- `SELECT tenant_id, count(*) FROM abbinamenti_carico_scarico GROUP BY 1`.

SET LOCAL lock_timeout = '5s';

-- 1. Enum.
CREATE TYPE "origine_abbinamento" AS ENUM ('AUTOMATICO', 'MANUALE');

-- 2. Destinazione della FK verso le giacenze iniziali.
CREATE UNIQUE INDEX "giacenze_iniziali_id_registro_tenant_key"
  ON "giacenze_iniziali"("id", "registro_id", "tenant_id");

-- 3. Tabella.
CREATE TABLE "abbinamenti_carico_scarico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "scarico_id" UUID NOT NULL,
    "scarico_tipo" "waste_movement_type" NOT NULL DEFAULT 'SCARICO',
    "carico_id" UUID,
    "carico_tipo" "waste_movement_type" NOT NULL DEFAULT 'CARICO',
    "giacenza_iniziale_id" UUID,
    "famiglia" VARCHAR(10) NOT NULL,
    "quantita" DECIMAL(12,3) NOT NULL,
    "origine" "origine_abbinamento" NOT NULL,
    "creato_da" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abbinamenti_cs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abbinamenti_cs_scarico_tipo_check" CHECK ("scarico_tipo" = 'SCARICO'),
    CONSTRAINT "abbinamenti_cs_carico_tipo_check" CHECK ("carico_tipo" = 'CARICO'),
    CONSTRAINT "abbinamenti_cs_un_carico_check"
      CHECK (num_nonnulls("carico_id", "giacenza_iniziale_id") = 1),
    CONSTRAINT "abbinamenti_cs_quantita_check" CHECK ("quantita" > 0),
    CONSTRAINT "abbinamenti_cs_famiglia_check" CHECK (btrim("famiglia") <> '')
);

-- 4. Indici e chiavi esterne (nomi uguali a quelli di schema.prisma).
CREATE UNIQUE INDEX "abbinamenti_cs_scarico_carico_key"
  ON "abbinamenti_carico_scarico"("scarico_id", "carico_id");
CREATE UNIQUE INDEX "abbinamenti_cs_scarico_giacenza_key"
  ON "abbinamenti_carico_scarico"("scarico_id", "giacenza_iniziale_id");
CREATE INDEX "abbinamenti_cs_tenant_id_idx" ON "abbinamenti_carico_scarico"("tenant_id");
CREATE INDEX "abbinamenti_cs_registro_id_idx" ON "abbinamenti_carico_scarico"("registro_id");
CREATE INDEX "abbinamenti_cs_carico_id_idx" ON "abbinamenti_carico_scarico"("carico_id");
CREATE INDEX "abbinamenti_cs_giacenza_iniziale_id_idx"
  ON "abbinamenti_carico_scarico"("giacenza_iniziale_id");

ALTER TABLE "abbinamenti_carico_scarico" ADD CONSTRAINT "abbinamenti_cs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abbinamenti_carico_scarico" ADD CONSTRAINT "abbinamenti_cs_registro_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "abbinamenti_carico_scarico" ADD CONSTRAINT "abbinamenti_cs_scarico_fkey"
  FOREIGN KEY ("scarico_id", "registro_id", "tenant_id", "scarico_tipo")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
-- MATCH SIMPLE: con carico_id NULL (riga su giacenza iniziale) questa chiave non e' controllata.
ALTER TABLE "abbinamenti_carico_scarico" ADD CONSTRAINT "abbinamenti_cs_carico_fkey"
  FOREIGN KEY ("carico_id", "registro_id", "tenant_id", "carico_tipo")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "abbinamenti_carico_scarico" ADD CONSTRAINT "abbinamenti_cs_giacenza_fkey"
  FOREIGN KEY ("giacenza_iniziale_id", "registro_id", "tenant_id")
  REFERENCES "giacenze_iniziali"("id", "registro_id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 5. RLS, in fondo (stessa forma di 20261031100000_soglie_deposito_temporaneo).
ALTER TABLE "abbinamenti_carico_scarico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "abbinamenti_carico_scarico" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "abbinamenti_carico_scarico"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "abbinamenti_carico_scarico" FOR SELECT TO wasteflow_lettura USING (true);
