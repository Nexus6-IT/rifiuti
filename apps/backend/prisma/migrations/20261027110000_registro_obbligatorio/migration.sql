-- Rollback dell'immagine dopo questa migration: il codice precedente scrive movimenti senza registro_id (NOT NULL) → solo con restore del backup predeploy.
--
-- Fase 2 pezzo 1, M2: il registro diventa obbligatorio e la numerazione passa dall'azienda al registro.
--
-- Va nella STESSA release di M1 (`registro_per_sede`): M1 ha riempito `registro_id` e creato i nuovi
-- indici unici; qui si chiude. Il nuovo vincolo (registro, anno, numero) esiste gia' da M1, quindi
-- la tabella non resta mai senza vincolo. Le chiavi esterne composte (registro_id, tenant_id) sono
-- gia' in M1.
--
-- 1. Controllo: se resta una riga senza registro la migration si ferma con un messaggio chiaro
--    (la migration e' transazionale, non lascia stati a meta').
-- 2. `registro_id` NOT NULL su `waste_movements` e `registro_progressivi_iniziali`.
-- 3. Solo ora si tolgono i vecchi vincoli per azienda: quello di `waste_movements` e' un CONSTRAINT
--    (creato con ADD CONSTRAINT ... UNIQUE, nome troncato a 63 caratteri da Postgres), quello di
--    `registro_progressivi_iniziali` e' un INDEX.
--
-- Ripristino (a mano): ricreare i due unici per azienda
-- (waste_movements: tenant_id, progressive_year, progressive_number; registro_progressivi_iniziali:
-- tenant_id, anno) e `ALTER COLUMN registro_id DROP NOT NULL`. Il ripristino dei vecchi unici
-- fallisce se due registri della stessa azienda hanno gia' lo stesso numero nello stesso anno.

-- Recupero: M1 e M2 sono due transazioni dello stesso `migrate deploy`, e fra le due il container
-- vecchio ancora in servizio puo' scrivere un movimento (o un progressivo iniziale) con
-- `registro_id` NULL. Quelle righe si assegnano all'unico registro della loro azienda, ma SOLO se
-- l'azienda ne ha esattamente uno (con M1 appena applicata e' sempre cosi'). Se un'azienda ha piu'
-- registri non si indovina: le righe restano NULL e il controllo qui sotto ferma la migration.
UPDATE "waste_movements" m
SET "registro_id" = r."id"
FROM "registri_rifiuti" r
WHERE m."registro_id" IS NULL
  AND r."tenant_id" = m."tenant_id"
  AND (SELECT count(*) FROM "registri_rifiuti" x WHERE x."tenant_id" = m."tenant_id") = 1;

UPDATE "registro_progressivi_iniziali" p
SET "registro_id" = r."id"
FROM "registri_rifiuti" r
WHERE p."registro_id" IS NULL
  AND r."tenant_id" = p."tenant_id"
  AND (SELECT count(*) FROM "registri_rifiuti" x WHERE x."tenant_id" = p."tenant_id") = 1;

DO $$
DECLARE
  movimenti_senza_registro integer;
  progressivi_senza_registro integer;
BEGIN
  SELECT count(*) INTO movimenti_senza_registro FROM "waste_movements" WHERE "registro_id" IS NULL;
  SELECT count(*) INTO progressivi_senza_registro FROM "registro_progressivi_iniziali" WHERE "registro_id" IS NULL;
  IF movimenti_senza_registro > 0 OR progressivi_senza_registro > 0 THEN
    RAISE EXCEPTION 'M2 registro_obbligatorio: % movimenti e % progressivi iniziali senza registro. M1 (registro_per_sede) non ha completato il backfill: applicare M1 e M2 nella stessa release.',
      movimenti_senza_registro, progressivi_senza_registro;
  END IF;
END
$$;

ALTER TABLE "waste_movements" ALTER COLUMN "registro_id" SET NOT NULL;
ALTER TABLE "registro_progressivi_iniziali" ALTER COLUMN "registro_id" SET NOT NULL;

ALTER TABLE "waste_movements" DROP CONSTRAINT "waste_movements_tenant_id_progressive_year_progressive_numb_key";
DROP INDEX "registro_progressivi_iniziali_tenant_id_anno_key";
