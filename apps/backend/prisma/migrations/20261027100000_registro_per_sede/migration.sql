-- Fase 2 pezzo 1, M1: registro per sede (unita' locale), additiva, con backfill dei dati esistenti.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea `registri_rifiuti` (un registro per unita' locale, codice CARICO_SCARICO), l'indice
--      unico parziale "uno senza sede per azienda e codice", la chiave esterna verso la sede
--      e il trigger `registri_rifiuti_sede_immutabile`;
--   2. per ogni azienda con righe in `waste_movements` O in `registro_progressivi_iniziali`
--      inserisce UN registro: sede = la principale; se non c'e' nessuna principale e l'azienda ha
--      UNA sola sede, quella; altrimenti nessuna sede (mai una sede indovinata fra due);
--   3. aggiunge `registro_id` (nullable) a `waste_movements` e `registro_progressivi_iniziali`,
--      lo valorizza con l'unico registro dell'azienda e si FERMA (RAISE EXCEPTION) se resta una
--      riga senza registro: la migration e' transazionale, non lascia stati a meta';
--   4. crea le chiavi esterne composte (registro_id, tenant_id) -> registri_rifiuti(id, tenant_id)
--      DOPO il backfill (il controllo gira una volta sola, su dati gia' coerenti), i NUOVI indici
--      unici (registro, anno, numero) e (registro, anno), e l'indice (registro, CER);
--   5. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` (come la Fase 1) in
--      FONDO, dopo il backfill, cosi' la WITH CHECK non respinge gli INSERT del backfill se il
--      ruolo non bypassasse la RLS.
--
-- I VECCHI vincoli unici (azienda, anno, numero) e (azienda, anno) restano: li toglie M2
-- (`registro_obbligatorio`, Task 3), che rende anche `registro_id` obbligatorio. Il nuovo indice
-- si crea prima di togliere il vecchio, cosi' la tabella non resta mai senza vincolo. Il nuovo
-- vincolo non puo' collidere: il vecchio era piu' stretto e ogni azienda ha ancora un solo registro.
--
-- Ruolo che esegue la migration: con FORCE ROW LEVEL SECURITY il proprietario NON e' esente, solo
-- un superuser o un ruolo con BYPASSRLS. In produzione e nel database di test il ruolo e'
-- `wasteflow` (rolsuper = true, rolbypassrls = true): il backfill vede tutte le righe. Nessun
-- GRANT qui: `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges che
-- `ops/db-ruoli.sh` (prisma/sql/ruoli-db.sql) imposta per le tabelle create dal proprietario.
--
-- Step 0 (D11), conteggio in produzione prima della migration: aziende con `num_iscr_sito` solo
-- sulla credenziale e nessuna riga in `rentri_unita_locali` = 0. Produzione ha 3 movimenti di
-- 2 aziende, nessuna sede RENTRI: due registri senza sede.
--
-- Scelta sulla chiave esterna composta opzionale: `prisma validate` ACCETTA
-- `@relation(fields: [registroId, tenantId], references: [id, tenantId])` con `registroId`
-- opzionale e `tenantId` obbligatorio (Prisma 5.22), quindi le chiavi composte stanno in M1.
-- Con MATCH SIMPLE (default) una riga con `registro_id` NULL non viene controllata.
--
-- Ripristino (a mano, solo se M2 non e' stata applicata): DROP TRIGGER
-- registri_rifiuti_sede_immutabile e DROP FUNCTION registri_rifiuti_sede_immutabile(); togliere
-- le chiavi esterne composte e le colonne `registro_id` da `waste_movements` e
-- `registro_progressivi_iniziali` (gli indici su di esse cadono con le colonne); infine DROP
-- TABLE registri_rifiuti.

-- 1. Tabella, vincoli, trigger.
CREATE TABLE "registri_rifiuti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "unita_locale_id" UUID,
    "codice" VARCHAR(30) NOT NULL DEFAULT 'CARICO_SCARICO',
    "descrizione" VARCHAR(255) NOT NULL,
    "identificativo_rentri" VARCHAR(100),
    "attivo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "registri_rifiuti_pkey" PRIMARY KEY ("id")
);

-- Un solo registro "senza sede" per azienda e codice (NULL e' distinto negli unici ordinari,
-- quindi serve l'indice parziale; non esprimibile in Prisma). Prima di qualunque INSERT.
CREATE UNIQUE INDEX "registri_rifiuti_uno_senza_sede_per_tenant"
  ON "registri_rifiuti"("tenant_id", "codice") WHERE "unita_locale_id" IS NULL;

CREATE INDEX "registri_rifiuti_tenant_id_idx" ON "registri_rifiuti"("tenant_id");
CREATE UNIQUE INDEX "registri_rifiuti_id_tenant_id_key" ON "registri_rifiuti"("id", "tenant_id");
CREATE UNIQUE INDEX "registri_rifiuti_tenant_id_unita_locale_id_codice_key"
  ON "registri_rifiuti"("tenant_id", "unita_locale_id", "codice");

ALTER TABLE "registri_rifiuti" ADD CONSTRAINT "registri_rifiuti_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "registri_rifiuti" ADD CONSTRAINT "registri_rifiuti_unita_locale_id_fkey"
  FOREIGN KEY ("unita_locale_id") REFERENCES "rentri_unita_locali"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Il legame registro -> sede passa solo da NULL a un valore, mai da una sede a un'altra, e la sede
-- deve essere della stessa azienda del registro (la chiave esterna semplice non lo garantisce).
CREATE FUNCTION "registri_rifiuti_sede_immutabile"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.unita_locale_id IS NOT NULL
     AND NEW.unita_locale_id IS DISTINCT FROM OLD.unita_locale_id THEN
    RAISE EXCEPTION 'unita_locale_id di un registro non si cambia dopo l''aggancio';
  END IF;
  IF NEW.unita_locale_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM rentri_unita_locali u
       WHERE u.id = NEW.unita_locale_id AND u.tenant_id <> NEW.tenant_id
     ) THEN
    RAISE EXCEPTION 'la sede del registro appartiene a un altro tenant';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "registri_rifiuti_sede_immutabile"
  BEFORE INSERT OR UPDATE OF "unita_locale_id" ON "registri_rifiuti"
  FOR EACH ROW EXECUTE FUNCTION "registri_rifiuti_sede_immutabile"();

-- 2. Un registro per ogni azienda che ha movimenti o un progressivo iniziale.
INSERT INTO "registri_rifiuti" ("tenant_id", "updated_at", "unita_locale_id", "descrizione")
SELECT a.tenant_id,
       now(),
       s.id,
       CASE WHEN s.id IS NULL THEN 'Registro cronologico'
            ELSE left('Registro ' || s.denominazione, 255) END
FROM (
  SELECT tenant_id FROM waste_movements
  UNION
  SELECT tenant_id FROM registro_progressivi_iniziali
) a
LEFT JOIN LATERAL (
  SELECT u.id, u.denominazione
  FROM rentri_unita_locali u
  WHERE u.tenant_id = a.tenant_id
    AND (
      u.principale
      OR (
        NOT EXISTS (SELECT 1 FROM rentri_unita_locali p WHERE p.tenant_id = a.tenant_id AND p.principale)
        AND (SELECT count(*) FROM rentri_unita_locali c WHERE c.tenant_id = a.tenant_id) = 1
      )
    )
  ORDER BY u.principale DESC
  LIMIT 1
) s ON true;

-- 3. Colonne e backfill.
ALTER TABLE "waste_movements" ADD COLUMN "registro_id" UUID;
ALTER TABLE "registro_progressivi_iniziali" ADD COLUMN "registro_id" UUID;

UPDATE "waste_movements" w
   SET "registro_id" = r."id"
  FROM "registri_rifiuti" r
 WHERE r."tenant_id" = w."tenant_id" AND r."codice" = 'CARICO_SCARICO';

UPDATE "registro_progressivi_iniziali" p
   SET "registro_id" = r."id"
  FROM "registri_rifiuti" r
 WHERE r."tenant_id" = p."tenant_id" AND r."codice" = 'CARICO_SCARICO';

DO $$
DECLARE
  v_movimenti integer;
  v_progressivi integer;
BEGIN
  SELECT count(*) INTO v_movimenti FROM waste_movements WHERE registro_id IS NULL;
  SELECT count(*) INTO v_progressivi FROM registro_progressivi_iniziali WHERE registro_id IS NULL;
  IF v_movimenti > 0 OR v_progressivi > 0 THEN
    RAISE EXCEPTION 'backfill del registro incompleto: % movimenti e % progressivi iniziali senza registro',
      v_movimenti, v_progressivi;
  END IF;
END
$$;

-- 4. Chiavi esterne composte (dopo il backfill) e nuovi indici (i vecchi restano fino a M2).
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_registro_id_tenant_id_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registro_progressivi_iniziali" ADD CONSTRAINT "registro_progressivi_iniziali_registro_id_tenant_id_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "waste_movements_registro_id_progressive_year_progressive_nu_key"
  ON "waste_movements"("registro_id", "progressive_year", "progressive_number");
CREATE INDEX "waste_movements_registro_id_cer_code_idx" ON "waste_movements"("registro_id", "cer_code");
CREATE UNIQUE INDEX "registro_progressivi_iniziali_registro_id_anno_key"
  ON "registro_progressivi_iniziali"("registro_id", "anno");

-- 5. RLS, in fondo (stessa forma della Fase 1: 20261025130000 e 20261026100000).
ALTER TABLE "registri_rifiuti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registri_rifiuti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "registri_rifiuti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "registri_rifiuti" FOR SELECT TO wasteflow_lettura USING (true);
