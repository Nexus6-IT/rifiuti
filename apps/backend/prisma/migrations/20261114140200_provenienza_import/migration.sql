-- Fase 3 (3.1), D1 e D2 del piano `2026-11-14-fase3-import-piano`: provenienza immutabile dei
-- record importati da un altro programma (WinWaste).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale), per ciascuna delle 7 tabelle
-- `waste_movements`, `firs`, `ditte`, `sedi_ditte`, `produttori`, `trasportatori`, `destinatari`:
--   1. `SET LOCAL lock_timeout = '5s'`;
--   2. tre colonne NULL (nessun backfill, nessun default: le righe esistenti restano non importate):
--      `import_source` VARCHAR(30), `legacy_key` VARCHAR(200), `lotto_import_id` UUID;
--   3. CHECK `<tabella>_provenienza_check`: tutte e tre NULL oppure tutte e tre valorizzate (ogni termine ha
--      il suo `IS NOT NULL` esplicito: un `NULL IN (...)` darebbe NULL e un CHECK lascia passare NULL), con
--      `import_source` nella lista (`WINWASTE`) e `legacy_key` nel formato `^[0-9]{4}\|[^|]+(\|[^|]+)+$`
--      (stesso pattern di `domain/migrazione/chiavi-legacy.ts`, `CHIAVE_LEGACY_PATTERN`);
--   4. unico PARZIALE `<tabella>_tenant_import_legacy_key` su `(tenant_id, import_source, legacy_key)
--      WHERE import_source IS NOT NULL` (solo SQL: Prisma non rappresenta gli indici parziali). Chi
--      carica deve scrivere `ON CONFLICT (tenant_id, import_source, legacy_key) WHERE import_source
--      IS NOT NULL DO NOTHING`, altrimenti PostgreSQL non trova l'indice;
--   5. FK composta `<tabella>_lotto_import_fkey` `(lotto_import_id, tenant_id) -> lotti_import(id,
--      tenant_id)`, NO ACTION (MATCH SIMPLE: con `lotto_import_id` NULL non controlla nulla);
--   6. trigger `<tabella>_provenienza_immutabile` `AFTER UPDATE OF import_source, legacy_key,
--      lotto_import_id ... WHEN (una delle tre cambia)` con la funzione unica `provenienza_import_immutabile()`: le tre colonne non
--      cambiano mai, neppure da NULL a valore (un record nato in WasteFlow non diventa «importato»).
--      Vale anche per il proprietario: e' un trigger, non un GRANT. La cascata da `tenants` non
--      aggiorna, quindi non e' toccata.
--
-- Ripristino a mano (additiva): per ogni tabella `DROP TRIGGER <t>_provenienza_immutabile ON <t>;
-- DROP INDEX <t>_tenant_import_legacy_key; ALTER TABLE <t> DROP CONSTRAINT <t>_provenienza_check,
-- DROP CONSTRAINT <t>_lotto_import_fkey, DROP COLUMN import_source, DROP COLUMN legacy_key,
-- DROP COLUMN lotto_import_id;` poi `DROP FUNCTION provenienza_import_immutabile()`. Solo se nessuna
-- riga e' stata importata: altrimenti si perde la provenienza.
-- Ripristino da migration fallita (P3009): transazionale; se `waste_movements` non ha la colonna
-- `import_source`: `npx prisma migrate resolve --rolled-back 20261114140200_provenienza_import`, poi
-- si rilancia.

SET LOCAL lock_timeout = '5s';

-- Trigger AFTER (non BEFORE), con la condizione nella clausola WHEN: un trigger BEFORE per riga su una
-- tabella fa prendere all'UPDATE il lock di riga FOR UPDATE (invece di FOR NO KEY UPDATE) ogni volta
-- che l'UPDATE nomina una colonna chiave (es. `tenant_id`), anche con lo stesso valore, e quindi lo fa
-- aspettare chi tiene un FOR KEY SHARE (l'insert di un figlio con FK). Lo ha scoperto
-- `fir-prisma.repository.postgres.spec.ts` («un salvataggio non aspetta il FOR KEY SHARE»). Un
-- trigger AFTER che solleva l'eccezione annulla comunque lo statement, e il WHEN lo accoda solo
-- quando la provenienza cambia davvero: zero costo per gli UPDATE normali.
CREATE FUNCTION provenienza_import_immutabile() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'la provenienza di import (import_source, legacy_key, lotto_import_id) di % non si modifica mai', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END
$fn$;

DO $prov$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'waste_movements', 'firs', 'ditte', 'sedi_ditte', 'produttori', 'trasportatori', 'destinatari'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN "import_source" VARCHAR(30), ADD COLUMN "legacy_key" VARCHAR(200), ADD COLUMN "lotto_import_id" UUID',
      v_t);
    EXECUTE format($c$ALTER TABLE %1$I ADD CONSTRAINT %2$I CHECK (
      ("import_source" IS NULL AND "legacy_key" IS NULL AND "lotto_import_id" IS NULL)
      OR ("import_source" IS NOT NULL AND "import_source" IN ('WINWASTE')
          AND "legacy_key" IS NOT NULL AND "legacy_key" ~ '^[0-9]{4}\|[^|]+(\|[^|]+)+$'
          AND char_length("legacy_key") <= 200
          AND "lotto_import_id" IS NOT NULL))$c$,
      v_t, v_t || '_provenienza_check');
    EXECUTE format(
      'CREATE UNIQUE INDEX %I ON %I ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL',
      v_t || '_tenant_import_legacy_key', v_t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("lotto_import_id", "tenant_id") REFERENCES "lotti_import"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION',
      v_t, v_t || '_lotto_import_fkey');
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE OF "import_source", "legacy_key", "lotto_import_id" ON %I FOR EACH ROW WHEN (OLD."import_source" IS DISTINCT FROM NEW."import_source" OR OLD."legacy_key" IS DISTINCT FROM NEW."legacy_key" OR OLD."lotto_import_id" IS DISTINCT FROM NEW."lotto_import_id") EXECUTE FUNCTION provenienza_import_immutabile()',
      v_t || '_provenienza_immutabile', v_t);
  END LOOP;
END
$prov$;
