-- Fase 4 pezzo 3 (Task 14): due ritocchi additivi a `20261103200000_legami_movimento`.
--
-- 1. Nuovo avviso `CONTRATTO_ALTRA_SEDE` (contratto scelto a mano di un'altra sede rispetto a quella
--    del FIR: solo un avviso, spec §6.3). Il CHECK `legami_movimento_avvisi_ammessi` si ricrea con lo
--    stesso nome e un valore in piu': DROP + ADD ... NOT VALID + VALIDATE (la tabella e' nuova e
--    vuota o quasi; VALIDATE non blocca le scritture). Lo stesso insieme e' in
--    `domain/legami-movimento/codici.ts`.
-- 2. Decisione di Graziano (03/11): il flag `fatturabile` di una versione di causale aziendale GIA'
--    USATA nel registro non si cambia (serve una nuova versione). Prima lo garantiva solo il servizio
--    (409 `CAUSALE_USATA_NUOVA_VERSIONE`); ora anche il trigger `causali_registro_azienda_controlli`,
--    ricreato con `CREATE OR REPLACE FUNCTION`: stessa definizione di prima piu' il solo ramo su
--    `fatturabile` dentro `IF v_usi > 0`. Il trigger non cambia (stesso nome, stessi eventi).
--
-- Additiva: nessun dato cambia, nessuna colonna. La esegue `prisma migrate deploy` col proprietario.
--
-- Ripristino a mano (in quest'ordine; nessun dato si perde):
--   UPDATE legami_movimento SET avvisi = array_remove(avvisi, 'CONTRATTO_ALTRA_SEDE') WHERE 'CONTRATTO_ALTRA_SEDE' = ANY(avvisi);
--   ALTER TABLE legami_movimento DROP CONSTRAINT legami_movimento_avvisi_ammessi;
--   ALTER TABLE legami_movimento ADD CONSTRAINT legami_movimento_avvisi_ammessi CHECK ("avvisi" IS NOT NULL AND "avvisi" <@ ARRAY['CLIENTE_NON_DA_FIR', 'QUANTITA_MANUALE_NON_DERIVATA', 'CAMBIO_CER_DA_CONFERMARE', 'PREZZO_MANUALE']::text[]) NOT VALID;
--   ALTER TABLE legami_movimento VALIDATE CONSTRAINT legami_movimento_avvisi_ammessi;
--   la definizione precedente della funzione, da rieseguire intera:
--   CREATE OR REPLACE FUNCTION public.causali_registro_azienda_controlli()
--    RETURNS trigger
--    LANGUAGE plpgsql
--   AS $function$
--   DECLARE
--     v_usi    bigint;
--     v_ultimo date;
--   BEGIN
--     IF TG_OP = 'UPDATE' THEN
--       IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
--          OR NEW."natura" IS DISTINCT FROM OLD."natura"
--          OR NEW."codice" IS DISTINCT FROM OLD."codice"
--          OR NEW."verso" IS DISTINCT FROM OLD."verso"
--          OR NEW."causale_sistema_codice" IS DISTINCT FROM OLD."causale_sistema_codice" THEN
--         RAISE EXCEPTION 'causali_registro_azienda: tenant, natura, codice e verso non si cambiano';
--       END IF;
--     END IF;
--
--     IF NEW."natura" = 'PROPRIA' THEN
--       IF EXISTS (
--         SELECT 1 FROM "causali_registro_azienda" x
--         WHERE x."tenant_id" = NEW."tenant_id" AND x."natura" = 'PROPRIA'
--           AND x."codice" = NEW."codice" AND x."verso" = NEW."verso" AND x."id" <> NEW."id"
--           AND x."valida_dal" <= COALESCE(NEW."valida_al", 'infinity'::date)
--           AND NEW."valida_dal" <= COALESCE(x."valida_al", 'infinity'::date)
--       ) THEN
--         RAISE EXCEPTION 'causali_registro_azienda: le versioni della causale % si sovrappongono', NEW."codice";
--       END IF;
--
--       IF TG_OP = 'UPDATE' THEN
--         SELECT count(*),
--                max((m."movement_date" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date)
--           INTO v_usi, v_ultimo
--         FROM "waste_movements" m
--         WHERE m."causale_azienda_id" = OLD."id" AND m."tenant_id" = OLD."tenant_id";
--         IF v_usi > 0 THEN
--           IF NEW."ruolo_mud" IS DISTINCT FROM OLD."ruolo_mud"
--              OR NEW."codice_rentri" IS DISTINCT FROM OLD."codice_rentri"
--              OR NEW."operazione" IS DISTINCT FROM OLD."operazione"
--              OR NEW."valida_dal" IS DISTINCT FROM OLD."valida_dal" THEN
--             RAISE EXCEPTION 'causali_registro_azienda: la versione e'' gia'' usata nel registro, ruolo MUD, codice RENTRI, operazione e inizio validita'' non si cambiano';
--           END IF;
--           IF NEW."valida_al" IS NOT NULL AND NEW."valida_al" < v_ultimo THEN
--             RAISE EXCEPTION 'causali_registro_azienda: la validita'' non puo'' finire prima dell''ultimo giorno d''uso (%)', v_ultimo;
--           END IF;
--         END IF;
--       END IF;
--     END IF;
--     RETURN NEW;
--   END
--   $function$;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261104100000_legami_avvisi_e_causali';
-- Ripristino da migration fallita (P3009): e' transazionale; si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261104100000_legami_avvisi_e_causali`, poi si rilancia il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 1. Avviso CONTRATTO_ALTRA_SEDE -----------------------------------------------

ALTER TABLE "legami_movimento" DROP CONSTRAINT "legami_movimento_avvisi_ammessi";
ALTER TABLE "legami_movimento" ADD CONSTRAINT "legami_movimento_avvisi_ammessi" CHECK ("avvisi" IS NOT NULL AND "avvisi" <@ ARRAY['CLIENTE_NON_DA_FIR', 'QUANTITA_MANUALE_NON_DERIVATA', 'CAMBIO_CER_DA_CONFERMARE', 'PREZZO_MANUALE', 'CONTRATTO_ALTRA_SEDE']::text[]) NOT VALID;
ALTER TABLE "legami_movimento" VALIDATE CONSTRAINT "legami_movimento_avvisi_ammessi";

-- 2. `fatturabile` immutabile su una versione di causale gia' usata ---------------

CREATE OR REPLACE FUNCTION public.causali_registro_azienda_controlli()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_usi    bigint;
  v_ultimo date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
       OR NEW."natura" IS DISTINCT FROM OLD."natura"
       OR NEW."codice" IS DISTINCT FROM OLD."codice"
       OR NEW."verso" IS DISTINCT FROM OLD."verso"
       OR NEW."causale_sistema_codice" IS DISTINCT FROM OLD."causale_sistema_codice" THEN
      RAISE EXCEPTION 'causali_registro_azienda: tenant, natura, codice e verso non si cambiano';
    END IF;
  END IF;

  IF NEW."natura" = 'PROPRIA' THEN
    IF EXISTS (
      SELECT 1 FROM "causali_registro_azienda" x
      WHERE x."tenant_id" = NEW."tenant_id" AND x."natura" = 'PROPRIA'
        AND x."codice" = NEW."codice" AND x."verso" = NEW."verso" AND x."id" <> NEW."id"
        AND x."valida_dal" <= COALESCE(NEW."valida_al", 'infinity'::date)
        AND NEW."valida_dal" <= COALESCE(x."valida_al", 'infinity'::date)
    ) THEN
      RAISE EXCEPTION 'causali_registro_azienda: le versioni della causale % si sovrappongono', NEW."codice";
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT count(*),
             max((m."movement_date" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date)
        INTO v_usi, v_ultimo
      FROM "waste_movements" m
      WHERE m."causale_azienda_id" = OLD."id" AND m."tenant_id" = OLD."tenant_id";
      IF v_usi > 0 THEN
        IF NEW."ruolo_mud" IS DISTINCT FROM OLD."ruolo_mud"
           OR NEW."codice_rentri" IS DISTINCT FROM OLD."codice_rentri"
           OR NEW."operazione" IS DISTINCT FROM OLD."operazione"
           OR NEW."valida_dal" IS DISTINCT FROM OLD."valida_dal" THEN
          RAISE EXCEPTION 'causali_registro_azienda: la versione e'' gia'' usata nel registro, ruolo MUD, codice RENTRI, operazione e inizio validita'' non si cambiano';
        END IF;
        IF NEW."fatturabile" IS DISTINCT FROM OLD."fatturabile" THEN
          RAISE EXCEPTION 'causali_registro_azienda: la versione e'' gia'' usata nel registro, fatturabile non si cambia (serve una nuova versione)';
        END IF;
        IF NEW."valida_al" IS NOT NULL AND NEW."valida_al" < v_ultimo THEN
          RAISE EXCEPTION 'causali_registro_azienda: la validita'' non puo'' finire prima dell''ultimo giorno d''uso (%)', v_ultimo;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
