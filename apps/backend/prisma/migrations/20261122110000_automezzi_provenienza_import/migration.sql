-- Import WinWaste, pezzo I4: provenienza immutabile anche sugli automezzi.
--
-- Cosa fa (stesso schema di `20261114140200_provenienza_import`, solo su `automezzi`):
--   1. `SET LOCAL lock_timeout = '5s'`;
--   2. tre colonne NULL (nessun backfill, nessun default: gli automezzi esistenti restano non
--      importati): `import_source` VARCHAR(30), `legacy_key` VARCHAR(200), `lotto_import_id` UUID;
--   3. CHECK `automezzi_provenienza_check`: tutte e tre NULL oppure tutte e tre valorizzate, con
--      `import_source` = 'WINWASTE' e `legacy_key` nel formato `^[0-9]{4}\|[^|]+(\|[^|]+)+$`;
--   4. unico PARZIALE `automezzi_tenant_import_legacy_key` su `(tenant_id, import_source,
--      legacy_key) WHERE import_source IS NOT NULL` (solo SQL: Prisma non rappresenta gli indici
--      parziali). Chi carica scrive `ON CONFLICT (tenant_id, import_source, legacy_key) WHERE
--      import_source IS NOT NULL DO NOTHING`;
--   5. FK composta `automezzi_lotto_import_fkey` `(lotto_import_id, tenant_id) ->
--      lotti_import(id, tenant_id)`, NO ACTION;
--   6. trigger `automezzi_provenienza_immutabile` (AFTER UPDATE ... WHEN) con la funzione
--      `provenienza_import_immutabile()` gia' creata dalla migration 20261114140200.
-- Additiva: nessuna colonna esistente cambia, nessun dato viene toccato. RLS invariata (88 tabelle).
--
-- Ripristino a mano (solo se nessun automezzo e' stato importato, altrimenti si perde la provenienza):
--   DROP TRIGGER automezzi_provenienza_immutabile ON automezzi;
--   DROP INDEX automezzi_tenant_import_legacy_key;
--   ALTER TABLE automezzi DROP CONSTRAINT automezzi_provenienza_check,
--     DROP CONSTRAINT automezzi_lotto_import_fkey, DROP COLUMN import_source,
--     DROP COLUMN legacy_key, DROP COLUMN lotto_import_id;
-- Ripristino da migration fallita (P3009): transazionale; se `automezzi` non ha la colonna
-- `import_source`: `npx prisma migrate resolve --rolled-back 20261122110000_automezzi_provenienza_import`,
-- poi si rilancia.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "automezzi"
  ADD COLUMN "import_source" VARCHAR(30),
  ADD COLUMN "legacy_key" VARCHAR(200),
  ADD COLUMN "lotto_import_id" UUID;

ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_provenienza_check" CHECK (
  ("import_source" IS NULL AND "legacy_key" IS NULL AND "lotto_import_id" IS NULL)
  OR ("import_source" IS NOT NULL AND "import_source" IN ('WINWASTE')
      AND "legacy_key" IS NOT NULL AND "legacy_key" ~ '^[0-9]{4}\|[^|]+(\|[^|]+)+$'
      AND char_length("legacy_key") <= 200
      AND "lotto_import_id" IS NOT NULL));

CREATE UNIQUE INDEX "automezzi_tenant_import_legacy_key"
  ON "automezzi" ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL;

ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_lotto_import_fkey"
  FOREIGN KEY ("lotto_import_id", "tenant_id") REFERENCES "lotti_import"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TRIGGER "automezzi_provenienza_immutabile"
  AFTER UPDATE OF "import_source", "legacy_key", "lotto_import_id" ON "automezzi"
  FOR EACH ROW
  WHEN (OLD."import_source" IS DISTINCT FROM NEW."import_source"
     OR OLD."legacy_key" IS DISTINCT FROM NEW."legacy_key"
     OR OLD."lotto_import_id" IS DISTINCT FROM NEW."lotto_import_id")
  EXECUTE FUNCTION provenienza_import_immutabile();
