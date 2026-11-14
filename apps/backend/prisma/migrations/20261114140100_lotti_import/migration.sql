-- Fase 3 (3.1), D5 del piano `2026-11-14-fase3-import-piano`: tabella `lotti_import`.
--
-- Cosa fa, in quest'ordine (un solo script, transazionale):
--   1. `SET LOCAL lock_timeout = '5s'` (si tocca `tenants` con la FK);
--   2. enum `ambito_lotto_import` e `stato_lotto_import`; tabella `lotti_import` con unico
--      `(id, tenant_id)` (bersaglio delle FK composte della migration `...100200`), CHECK sul formato
--      di `archivio` (`^WW[0-9]{8}$`), di `hash_staging` (esadecimale minuscolo di 64) e di
--      `import_source` (solo `WINWASTE`, lista estendibile da migration), e unico PARZIALE
--      «un solo IN_CORSO per (tenant, archivio, ambito)» (solo SQL: Prisma non rappresenta gli
--      indici parziali);
--   3. REVOKE di DELETE e TRUNCATE per `wasteflow_app` e `wasteflow_sistema` SE esistono (un lotto non
--      si cancella, si annulla); stesso elenco in `prisma/sql/ruoli-db.sql` (`v_senza_cancellazione`).
--      La cascata da `tenants` resta possibile (azione referenziale coi privilegi del proprietario);
--   4. RLS ENABLE + FORCE e policy `isolamento_azienda` / `sola_lettura`.
--
-- Ripristino a mano (additiva): DROP TABLE "lotti_import"; DROP TYPE "stato_lotto_import";
-- DROP TYPE "ambito_lotto_import". Da fare solo se la migration `...100200` non e' stata applicata
-- (le sue FK puntano a questa tabella).
-- Ripristino da migration fallita (P3009): transazionale; se `to_regclass('public.lotti_import')` e'
-- NULL: `npx prisma migrate resolve --rolled-back 20261114140100_lotti_import`, poi si rilancia.

SET LOCAL lock_timeout = '5s';

CREATE TYPE "ambito_lotto_import" AS ENUM ('ANAGRAFICHE', 'REGISTRO', 'GIACENZE', 'FIR');
CREATE TYPE "stato_lotto_import" AS ENUM ('IN_CORSO', 'COMPLETATO', 'FALLITO', 'ANNULLATO');

CREATE TABLE "lotti_import" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "import_source" VARCHAR(30) NOT NULL,
  "archivio" VARCHAR(10) NOT NULL,
  "ambito" "ambito_lotto_import" NOT NULL,
  "formato_staging" VARCHAR(40) NOT NULL,
  "hash_staging" VARCHAR(64) NOT NULL,
  "stato" "stato_lotto_import" NOT NULL DEFAULT 'IN_CORSO',
  "conteggi" JSONB NOT NULL DEFAULT '{}',
  "errore" VARCHAR(1000),
  "avviato_da" UUID,
  "avviato_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluso_il" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lotti_import_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lotti_import_import_source_check" CHECK ("import_source" IN ('WINWASTE')),
  CONSTRAINT "lotti_import_archivio_check" CHECK ("archivio" ~ '^WW[0-9]{8}$'),
  CONSTRAINT "lotti_import_hash_staging_check" CHECK ("hash_staging" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "lotti_import_id_tenant_id_key" ON "lotti_import"("id", "tenant_id");
CREATE INDEX "lotti_import_tenant_id_idx" ON "lotti_import"("tenant_id");
-- Un solo caricamento in corso per azienda, archivio e ambito (solo SQL: indice parziale).
CREATE UNIQUE INDEX "lotti_import_in_corso_key"
  ON "lotti_import"("tenant_id", "archivio", "ambito") WHERE "stato" = 'IN_CORSO';

ALTER TABLE "lotti_import"
  ADD CONSTRAINT "lotti_import_tenant_id_fkey" FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Privilegi: un lotto non si cancella ------------------------------------------------------------

DO $priv$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "lotti_import" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$priv$;

-- 4. RLS, in fondo ---------------------------------------------------------------------------------

ALTER TABLE "lotti_import" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lotti_import" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "lotti_import"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "lotti_import" FOR SELECT TO wasteflow_lettura USING (true);
