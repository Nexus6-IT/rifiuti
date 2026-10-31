-- Fase 4 pezzo 8a, Task 2a: modello dati delle pese (D1-D4 del piano `2026-10-31-fase4-8a-pese`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale):
--   1. `SET LOCAL lock_timeout = '5s'`: le chiavi esterne toccano tabelle calde (`waste_movements`,
--      `firs`, `registri_rifiuti`, `trasportatori`); se un lock non arriva in 5 s la migration
--      fallisce invece di accodarsi dietro il traffico;
--   2. crea i tipi enum (`fonte_pesata`, `modo_pesatura`, `stato_accesso_pesa`, `origine_tara`,
--      `tipo_collegamento_accesso`) e le 7 tabelle `strumenti_pesa`, `automezzi`, `accessi_pesa`,
--      `pesate`, `rettifiche_peso`, `allegati_pesa`, `collegamenti_accesso`, con i loro indici e le
--      chiavi esterne (composte con `tenant_id`: il database impone la stessa azienda; azioni
--      NO ACTION, la cascata da `tenants` cancella tutto in uno statement). La chiave esterna
--      `automezzi_tara_pesata_fkey` verso `pesate` e' creata dopo le tabelle (dipendenza circolare);
--   3. aggiunge CHECK e indici unici che Prisma non conosce (`automezzi_targhe_uniche`, i quattro
--      `collegamenti_accesso_*` parziali);
--   4. funzioni e trigger (NON `SECURITY DEFINER`: le SELECT interne passano dalla RLS di chi
--      scrive). `pesate`, `rettifiche_peso`, `allegati_pesa` non si aggiornano MAI (vale anche per
--      il proprietario); `pesate_controlli` impone la coerenza fonte/modo/ordine (SINGOLA solo
--      ordine 1; TARA_ANAGRAFICA ordine 1 non-tara e ordine 2 tara; DOPPIA senza tara dichiarata);
--      `accessi_pesa_controlli` governa le transizioni di stato; `collegamenti_accesso_controlli`
--      ammette solo la revoca, una volta;
--   5. REVOKE dei privilegi (D4) per `wasteflow_app` e `wasteflow_sistema` SE esistono: in CI la
--      prima `migrate deploy` precede `ops/db-ruoli.sh`, quindi senza il controllo la migration
--      fallirebbe. Lo stesso elenco e' in `prisma/sql/ruoli-db.sql` (Task 2b);
--   6. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` in FONDO (forma di
--      `20261031110000_ditte_sedi_controparti`).
--
-- Ruolo che esegue la migration: `wasteflow` (superuser, BYPASSRLS). Nessun GRANT qui: i default
-- privileges di `ops/db-ruoli.sh` li danno ai ruoli applicativi.
--
-- Ripristino a mano (la migration e' additiva): DROP TABLE collegamenti_accesso, rettifiche_peso,
-- pesate CASCADE; poi DROP TABLE accessi_pesa, automezzi, allegati_pesa, strumenti_pesa CASCADE;
-- DROP FUNCTION pesate_immutabile(), pesate_controlli(), rettifiche_peso_immutabile(),
-- rettifiche_peso_controlli(), allegati_pesa_immutabile(), accessi_pesa_controlli(),
-- collegamenti_accesso_controlli(); DROP TYPE tipo_collegamento_accesso, origine_tara,
-- stato_accesso_pesa, modo_pesatura, fonte_pesata.
-- Ripristino da migration fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.pesate')` sia NULL e si lancia
-- `npx prisma migrate resolve --rolled-back 20261101600000_pese_modello_dati`, poi si rilancia
-- il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi, tabelle, indici e chiavi esterne
CREATE TYPE "fonte_pesata" AS ENUM ('STRUMENTO', 'FILE', 'MANUALE', 'TARA_ANAGRAFICA');

-- CreateEnum
CREATE TYPE "modo_pesatura" AS ENUM ('DOPPIA', 'TARA_ANAGRAFICA', 'SINGOLA');

-- CreateEnum
CREATE TYPE "stato_accesso_pesa" AS ENUM ('APERTO', 'CHIUSO', 'ANNULLATO');

-- CreateEnum
CREATE TYPE "origine_tara" AS ENUM ('DICHIARATA', 'PESATA');

-- CreateEnum
CREATE TYPE "tipo_collegamento_accesso" AS ENUM ('FIR', 'MOVIMENTO');

-- CreateTable
CREATE TABLE "strumenti_pesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID,
    "descrizione" VARCHAR(255) NOT NULL,
    "costruttore" VARCHAR(100),
    "modello" VARCHAR(100),
    "matricola" VARCHAR(100),
    "portata_max_kg" DECIMAL(10,2),
    "divisione_kg" DECIMAL(8,3),
    "data_ultima_verificazione" DATE,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "creato_da" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "strumenti_pesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automezzi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "targa" VARCHAR(15) NOT NULL,
    "targa_rimorchio" VARCHAR(15),
    "trasportatore_id" UUID,
    "tara_kg" DECIMAL(10,2),
    "tara_origine" "origine_tara",
    "tara_pesata_id" UUID,
    "tara_aggiornata_il" TIMESTAMPTZ(3),
    "ultima_pesata_vuoto_il" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "creato_da" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automezzi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessi_pesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "anno" SMALLINT NOT NULL,
    "numero" INTEGER NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    "modo" "modo_pesatura" NOT NULL,
    "stato" "stato_accesso_pesa" NOT NULL DEFAULT 'APERTO',
    "automezzo_id" UUID,
    "targa" VARCHAR(15),
    "targa_rimorchio" VARCHAR(15),
    "cer_code" VARCHAR(10),
    "descrizione" VARCHAR(255),
    "note" VARCHAR(1000),
    "aperto_da" UUID NOT NULL,
    "aperto_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chiuso_da" UUID,
    "chiuso_il" TIMESTAMPTZ(3),
    "annullato_da" UUID,
    "annullato_il" TIMESTAMPTZ(3),
    "motivo_annullamento" VARCHAR(500),

    CONSTRAINT "accessi_pesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pesate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "accesso_id" UUID NOT NULL,
    "ordine" SMALLINT NOT NULL,
    "fonte" "fonte_pesata" NOT NULL,
    "strumento_id" UUID,
    "strumento_esterno" VARCHAR(200),
    "alibi_id" VARCHAR(40),
    "peso_kg" DECIMAL(10,2) NOT NULL,
    "stabile" BOOLEAN NOT NULL,
    "ora_strumento" TIMESTAMPTZ(3),
    "ora_ricezione" TIMESTAMPTZ(3) NOT NULL,
    "operatore_id" UUID,
    "motivo_manuale" VARCHAR(500),
    "allegato_id" UUID,
    "automezzo_id" UUID,
    "tara_aggiornata_il" TIMESTAMPTZ(3),
    "chiave_idempotenza" UUID NOT NULL,
    "firma_agente" TEXT,
    "impronta" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pesate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rettifiche_peso" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "pesata_id" UUID NOT NULL,
    "numero" SMALLINT NOT NULL,
    "peso_precedente_kg" DECIMAL(10,2) NOT NULL,
    "peso_nuovo_kg" DECIMAL(10,2) NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "autore_id" UUID NOT NULL,
    "allegato_id" UUID,
    "impronta" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rettifiche_peso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allegati_pesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "nome_file" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "dimensione_byte" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "contenuto" BYTEA NOT NULL,
    "caricato_da" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegati_pesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collegamenti_accesso" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "accesso_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "verso" "waste_movement_type" NOT NULL,
    "tipo" "tipo_collegamento_accesso" NOT NULL,
    "fir_id" UUID,
    "movimento_id" UUID,
    "creato_da" UUID NOT NULL,
    "creato_il" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocato_da" UUID,
    "revocato_il" TIMESTAMPTZ(3),
    "motivo_revoca" VARCHAR(500),

    CONSTRAINT "collegamenti_accesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strumenti_pesa_tenant_id_idx" ON "strumenti_pesa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strumenti_pesa_id_tenant_id_key" ON "strumenti_pesa"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strumenti_pesa_tenant_id_matricola_key" ON "strumenti_pesa"("tenant_id", "matricola");

-- CreateIndex
CREATE INDEX "automezzi_tenant_id_idx" ON "automezzi"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "automezzi_id_tenant_id_key" ON "automezzi"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "accessi_pesa_tenant_id_idx" ON "accessi_pesa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessi_pesa_id_tenant_id_key" ON "accessi_pesa"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessi_pesa_registro_id_anno_numero_key" ON "accessi_pesa"("registro_id", "anno", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "accessi_pesa_id_registro_tenant_verso_key" ON "accessi_pesa"("id", "registro_id", "tenant_id", "verso");

-- CreateIndex
CREATE INDEX "pesate_tenant_id_idx" ON "pesate"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pesate_id_tenant_id_key" ON "pesate"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pesate_accesso_id_ordine_key" ON "pesate"("accesso_id", "ordine");

-- CreateIndex
CREATE UNIQUE INDEX "pesate_tenant_id_chiave_idempotenza_key" ON "pesate"("tenant_id", "chiave_idempotenza");

-- CreateIndex
CREATE UNIQUE INDEX "pesate_strumento_id_alibi_id_key" ON "pesate"("strumento_id", "alibi_id");

-- CreateIndex
CREATE INDEX "rettifiche_peso_tenant_id_idx" ON "rettifiche_peso"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "rettifiche_peso_id_tenant_id_key" ON "rettifiche_peso"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "rettifiche_peso_pesata_id_numero_key" ON "rettifiche_peso"("pesata_id", "numero");

-- CreateIndex
CREATE INDEX "allegati_pesa_tenant_id_idx" ON "allegati_pesa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "allegati_pesa_id_tenant_id_key" ON "allegati_pesa"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "collegamenti_accesso_tenant_id_idx" ON "collegamenti_accesso"("tenant_id");

-- AddForeignKey
ALTER TABLE "strumenti_pesa" ADD CONSTRAINT "strumenti_pesa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strumenti_pesa" ADD CONSTRAINT "strumenti_pesa_registro_fkey" FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_trasportatore_fkey" FOREIGN KEY ("trasportatore_id") REFERENCES "trasportatori"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_tara_pesata_fkey" FOREIGN KEY ("tara_pesata_id", "tenant_id") REFERENCES "pesate"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accessi_pesa" ADD CONSTRAINT "accessi_pesa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessi_pesa" ADD CONSTRAINT "accessi_pesa_registro_fkey" FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accessi_pesa" ADD CONSTRAINT "accessi_pesa_automezzo_fkey" FOREIGN KEY ("automezzo_id", "tenant_id") REFERENCES "automezzi"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_accesso_fkey" FOREIGN KEY ("accesso_id", "tenant_id") REFERENCES "accessi_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_strumento_fkey" FOREIGN KEY ("strumento_id", "tenant_id") REFERENCES "strumenti_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_allegato_fkey" FOREIGN KEY ("allegato_id", "tenant_id") REFERENCES "allegati_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pesate" ADD CONSTRAINT "pesate_automezzo_fkey" FOREIGN KEY ("automezzo_id", "tenant_id") REFERENCES "automezzi"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rettifiche_peso" ADD CONSTRAINT "rettifiche_peso_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rettifiche_peso" ADD CONSTRAINT "rettifiche_peso_pesata_fkey" FOREIGN KEY ("pesata_id", "tenant_id") REFERENCES "pesate"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rettifiche_peso" ADD CONSTRAINT "rettifiche_peso_allegato_fkey" FOREIGN KEY ("allegato_id", "tenant_id") REFERENCES "allegati_pesa"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "allegati_pesa" ADD CONSTRAINT "allegati_pesa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_accesso_fkey" FOREIGN KEY ("accesso_id", "registro_id", "tenant_id", "verso") REFERENCES "accessi_pesa"("id", "registro_id", "tenant_id", "verso") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_movimento_fkey" FOREIGN KEY ("movimento_id", "registro_id", "tenant_id", "verso") REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_fir_fkey" FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- 3. CHECK e indici solo SQL -------------------------------------------------------------------

ALTER TABLE "strumenti_pesa" ADD CONSTRAINT "strumenti_pesa_valori_check" CHECK (
  btrim("descrizione") <> ''
  AND ("portata_max_kg" IS NULL OR "portata_max_kg" > 0)
  AND ("divisione_kg" IS NULL OR "divisione_kg" > 0)
);

ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_targa_check" CHECK (
  "targa" ~ '^[A-Z0-9]{2,15}$'
  AND ("targa_rimorchio" IS NULL OR "targa_rimorchio" ~ '^[A-Z0-9]{2,15}$')
);
-- La tara e' tutta o niente; PESATA <=> c'e' la pesata di origine <=> c'e' la data dell'ultima
-- pesata a vuoto.
ALTER TABLE "automezzi" ADD CONSTRAINT "automezzi_tara_check" CHECK (
  ("tara_kg" IS NULL) = ("tara_origine" IS NULL)
  AND ("tara_kg" IS NULL) = ("tara_aggiornata_il" IS NULL)
  AND ("tara_kg" IS NULL OR "tara_kg" > 0)
  AND ("tara_origine" IS NOT DISTINCT FROM 'PESATA'::"origine_tara") = ("tara_pesata_id" IS NOT NULL)
  AND ("tara_pesata_id" IS NOT NULL) = ("ultima_pesata_vuoto_il" IS NOT NULL)
);
CREATE UNIQUE INDEX "automezzi_targhe_uniche"
  ON "automezzi" ("tenant_id", "targa", COALESCE("targa_rimorchio", ''));

ALTER TABLE "accessi_pesa" ADD CONSTRAINT "accessi_pesa_valori_check" CHECK (
  "numero" >= 1 AND "anno" BETWEEN 2000 AND 2200
  AND ("targa" IS NULL OR "targa" ~ '^[A-Z0-9]{2,15}$')
  AND ("targa_rimorchio" IS NULL OR "targa_rimorchio" ~ '^[A-Z0-9]{2,15}$')
);
ALTER TABLE "accessi_pesa" ADD CONSTRAINT "accessi_pesa_stato_check" CHECK (
  ("stato" = 'APERTO'
    AND "chiuso_da" IS NULL AND "chiuso_il" IS NULL
    AND "annullato_da" IS NULL AND "annullato_il" IS NULL AND "motivo_annullamento" IS NULL)
  OR ("stato" = 'CHIUSO'
    AND "chiuso_da" IS NOT NULL AND "chiuso_il" IS NOT NULL
    AND "annullato_da" IS NULL AND "annullato_il" IS NULL AND "motivo_annullamento" IS NULL)
  OR ("stato" = 'ANNULLATO'
    AND "annullato_da" IS NOT NULL AND "annullato_il" IS NOT NULL
    AND "motivo_annullamento" IS NOT NULL AND btrim("motivo_annullamento") <> ''
    AND ("chiuso_da" IS NULL) = ("chiuso_il" IS NULL))
);

ALTER TABLE "pesate" ADD CONSTRAINT "pesate_coerenza_check" CHECK (
  "ordine" IN (1, 2)
  AND "peso_kg" > 0
  AND "impronta" ~ '^[0-9a-f]{64}$'
  AND ("alibi_id" IS NULL OR btrim("alibi_id") <> '')
  AND ("fonte" <> 'MANUALE' OR (
    "operatore_id" IS NOT NULL
    AND "motivo_manuale" IS NOT NULL AND btrim("motivo_manuale") <> ''
    AND ("strumento_id" IS NOT NULL OR ("strumento_esterno" IS NOT NULL AND btrim("strumento_esterno") <> ''))))
  AND ("fonte" <> 'TARA_ANAGRAFICA' OR (
    "ordine" = 2
    AND "automezzo_id" IS NOT NULL AND "tara_aggiornata_il" IS NOT NULL
    AND "strumento_id" IS NULL AND "alibi_id" IS NULL AND "allegato_id" IS NULL
    AND "operatore_id" IS NOT NULL))
  AND ("fonte" = 'TARA_ANAGRAFICA' OR ("automezzo_id" IS NULL AND "tara_aggiornata_il" IS NULL))
  AND ("fonte" NOT IN ('STRUMENTO', 'FILE') OR "strumento_id" IS NOT NULL)
);

ALTER TABLE "rettifiche_peso" ADD CONSTRAINT "rettifiche_peso_valori_check" CHECK (
  "numero" >= 1
  AND "peso_nuovo_kg" > 0
  AND "peso_nuovo_kg" <> "peso_precedente_kg"
  AND btrim("motivo") <> ''
  AND "impronta" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "allegati_pesa" ADD CONSTRAINT "allegati_pesa_valori_check" CHECK (
  "mime_type" IN ('image/jpeg', 'image/png', 'application/pdf')
  AND "dimensione_byte" BETWEEN 1 AND 4194304
  AND octet_length("contenuto") = "dimensione_byte"
  AND "sha256" ~ '^[0-9a-f]{64}$'
  AND btrim("nome_file") <> ''
);

ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_tipo_check" CHECK (
  ("tipo" = 'FIR' AND "fir_id" IS NOT NULL AND "movimento_id" IS NULL)
  OR ("tipo" = 'MOVIMENTO' AND "movimento_id" IS NOT NULL AND "fir_id" IS NULL)
);
ALTER TABLE "collegamenti_accesso" ADD CONSTRAINT "collegamenti_accesso_revoca_check" CHECK (
  ("revocato_da" IS NULL AND "revocato_il" IS NULL AND "motivo_revoca" IS NULL)
  OR ("revocato_da" IS NOT NULL AND "revocato_il" IS NOT NULL
      AND "motivo_revoca" IS NOT NULL AND btrim("motivo_revoca") <> '')
);
-- Un collegamento attivo per accesso e tipo, e un accesso per FIR / per movimento (Q4).
CREATE UNIQUE INDEX "collegamenti_accesso_un_fir_attivo" ON "collegamenti_accesso" ("accesso_id")
  WHERE "tipo" = 'FIR' AND "revocato_il" IS NULL;
CREATE UNIQUE INDEX "collegamenti_accesso_un_mov_attivo" ON "collegamenti_accesso" ("accesso_id")
  WHERE "tipo" = 'MOVIMENTO' AND "revocato_il" IS NULL;
CREATE UNIQUE INDEX "collegamenti_accesso_fir_unico" ON "collegamenti_accesso" ("fir_id")
  WHERE "revocato_il" IS NULL;
CREATE UNIQUE INDEX "collegamenti_accesso_mov_unico" ON "collegamenti_accesso" ("movimento_id")
  WHERE "revocato_il" IS NULL;

-- 4. Funzioni e trigger (non SECURITY DEFINER) ---------------------------------------------------

CREATE FUNCTION pesate_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'pesate: riga immutabile';
END;
$fn$;
CREATE TRIGGER pesate_immutabile BEFORE UPDATE ON "pesate"
  FOR EACH ROW EXECUTE FUNCTION pesate_immutabile();

CREATE FUNCTION rettifiche_peso_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'rettifiche_peso: riga immutabile';
END;
$fn$;
CREATE TRIGGER rettifiche_peso_immutabile BEFORE UPDATE ON "rettifiche_peso"
  FOR EACH ROW EXECUTE FUNCTION rettifiche_peso_immutabile();

CREATE FUNCTION allegati_pesa_immutabile() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'allegati_pesa: riga immutabile';
END;
$fn$;
CREATE TRIGGER allegati_pesa_immutabile BEFORE UPDATE ON "allegati_pesa"
  FOR EACH ROW EXECUTE FUNCTION allegati_pesa_immutabile();

-- Una pesata si aggiunge solo a un accesso APERTO e rispetta il modo dell'accesso.
CREATE FUNCTION pesate_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_accesso_pesa";
  v_modo "modo_pesatura";
BEGIN
  SELECT "stato", "modo" INTO v_stato, v_modo
    FROM "accessi_pesa" WHERE "id" = NEW."accesso_id" AND "tenant_id" = NEW."tenant_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pesate: accesso non trovato';
  END IF;
  IF v_stato <> 'APERTO' THEN
    RAISE EXCEPTION 'pesate: accesso non aperto';
  END IF;
  IF v_modo = 'SINGOLA' AND NEW."ordine" <> 1 THEN
    RAISE EXCEPTION 'pesate: la pesata singola ha solo l''ordine 1';
  END IF;
  IF v_modo = 'SINGOLA' AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
    RAISE EXCEPTION 'pesate: la pesata singola non ammette la tara dichiarata';
  END IF;
  IF v_modo = 'TARA_ANAGRAFICA' THEN
    IF NEW."ordine" = 1 AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
      RAISE EXCEPTION 'pesate: la prima pesata non puo'' essere la tara dichiarata';
    END IF;
    IF NEW."ordine" = 2 AND NEW."fonte" <> 'TARA_ANAGRAFICA' THEN
      RAISE EXCEPTION 'pesate: con la tara dichiarata la seconda pesata e'' la tara';
    END IF;
  END IF;
  IF v_modo = 'DOPPIA' AND NEW."fonte" = 'TARA_ANAGRAFICA' THEN
    RAISE EXCEPTION 'pesate: la doppia pesata non ammette la tara dichiarata';
  END IF;
  IF NEW."ordine" = 2 AND NOT EXISTS (
    SELECT 1 FROM "pesate" WHERE "accesso_id" = NEW."accesso_id" AND "ordine" = 1
  ) THEN
    RAISE EXCEPTION 'pesate: manca la prima pesata';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER pesate_controlli BEFORE INSERT ON "pesate"
  FOR EACH ROW EXECUTE FUNCTION pesate_controlli();

-- Una rettifica ha il numero successivo e parte dal peso in vigore.
CREATE FUNCTION rettifiche_peso_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_fonte "fonte_pesata";
  v_peso numeric;
  v_stato "stato_accesso_pesa";
  v_ult_num integer;
  v_ult_peso numeric;
BEGIN
  SELECT p."fonte", p."peso_kg", a."stato" INTO v_fonte, v_peso, v_stato
    FROM "pesate" p
    JOIN "accessi_pesa" a ON a."id" = p."accesso_id" AND a."tenant_id" = p."tenant_id"
   WHERE p."id" = NEW."pesata_id" AND p."tenant_id" = NEW."tenant_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rettifiche_peso: pesata non trovata';
  END IF;
  IF v_fonte = 'TARA_ANAGRAFICA' THEN
    RAISE EXCEPTION 'rettifiche_peso: la tara dichiarata non si rettifica';
  END IF;
  IF v_stato = 'ANNULLATO' THEN
    RAISE EXCEPTION 'rettifiche_peso: accesso annullato';
  END IF;
  SELECT "numero", "peso_nuovo_kg" INTO v_ult_num, v_ult_peso
    FROM "rettifiche_peso" WHERE "pesata_id" = NEW."pesata_id" AND "tenant_id" = NEW."tenant_id"
   ORDER BY "numero" DESC LIMIT 1;
  IF NEW."numero" <> COALESCE(v_ult_num, 0) + 1 THEN
    RAISE EXCEPTION 'rettifiche_peso: numero non consecutivo';
  END IF;
  IF NEW."peso_precedente_kg" <> COALESCE(v_ult_peso, v_peso) THEN
    RAISE EXCEPTION 'rettifiche_peso: il peso precedente non e'' quello in vigore';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER rettifiche_peso_controlli BEFORE INSERT ON "rettifiche_peso"
  FOR EACH ROW EXECUTE FUNCTION rettifiche_peso_controlli();

-- Transizioni dell'accesso: APERTO -> CHIUSO | ANNULLATO, CHIUSO -> ANNULLATO; da ANNULLATO nulla.
CREATE FUNCTION accessi_pesa_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_attese integer;
  v_presenti integer;
BEGIN
  IF OLD."stato" = 'ANNULLATO' THEN
    RAISE EXCEPTION 'accessi_pesa: accesso annullato, non modificabile';
  END IF;
  IF (NEW."tenant_id", NEW."registro_id", NEW."anno", NEW."numero", NEW."verso", NEW."modo",
      NEW."aperto_da", NEW."aperto_il")
     IS DISTINCT FROM
     (OLD."tenant_id", OLD."registro_id", OLD."anno", OLD."numero", OLD."verso", OLD."modo",
      OLD."aperto_da", OLD."aperto_il") THEN
    RAISE EXCEPTION 'accessi_pesa: azienda, registro, numero, verso, modo e apertura sono immutabili';
  END IF;
  IF OLD."stato" <> 'APERTO' AND (NEW."automezzo_id", NEW."targa", NEW."targa_rimorchio", NEW."cer_code")
     IS DISTINCT FROM (OLD."automezzo_id", OLD."targa", OLD."targa_rimorchio", OLD."cer_code") THEN
    RAISE EXCEPTION 'accessi_pesa: automezzo, targhe e CER non cambiano dopo la chiusura';
  END IF;
  IF OLD."chiuso_il" IS NOT NULL AND (NEW."chiuso_da", NEW."chiuso_il")
     IS DISTINCT FROM (OLD."chiuso_da", OLD."chiuso_il") THEN
    RAISE EXCEPTION 'accessi_pesa: la chiusura non cambia';
  END IF;
  IF NEW."stato" <> OLD."stato" THEN
    IF OLD."stato" = 'APERTO' AND NEW."stato" = 'CHIUSO' THEN
      v_attese := CASE WHEN NEW."modo" = 'SINGOLA' THEN 1 ELSE 2 END;
      SELECT count(*) INTO v_presenti FROM "pesate" WHERE "accesso_id" = OLD."id";
      IF v_presenti <> v_attese THEN
        RAISE EXCEPTION 'accessi_pesa: pesate insufficienti per chiudere l''accesso';
      END IF;
    ELSIF NEW."stato" = 'ANNULLATO' THEN
      IF EXISTS (
        SELECT 1 FROM "collegamenti_accesso" WHERE "accesso_id" = OLD."id" AND "revocato_il" IS NULL
      ) THEN
        RAISE EXCEPTION 'accessi_pesa: collegamento attivo, revocarlo prima di annullare';
      END IF;
    ELSE
      RAISE EXCEPTION 'accessi_pesa: transizione di stato non ammessa';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER accessi_pesa_controlli BEFORE UPDATE ON "accessi_pesa"
  FOR EACH ROW EXECUTE FUNCTION accessi_pesa_controlli();

-- Un collegamento si crea su un accesso CHIUSO e si puo' solo revocare, una volta.
CREATE FUNCTION collegamenti_accesso_controlli() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_stato "stato_accesso_pesa";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "stato" INTO v_stato
      FROM "accessi_pesa" WHERE "id" = NEW."accesso_id" AND "tenant_id" = NEW."tenant_id";
    IF NOT FOUND OR v_stato <> 'CHIUSO' THEN
      RAISE EXCEPTION 'collegamenti_accesso: l''accesso deve essere chiuso';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."revocato_il" IS NOT NULL THEN
    RAISE EXCEPTION 'collegamenti_accesso: collegamento gia'' revocato';
  END IF;
  IF (NEW."id", NEW."tenant_id", NEW."accesso_id", NEW."registro_id", NEW."verso", NEW."tipo",
      NEW."fir_id", NEW."movimento_id", NEW."creato_da", NEW."creato_il")
     IS DISTINCT FROM
     (OLD."id", OLD."tenant_id", OLD."accesso_id", OLD."registro_id", OLD."verso", OLD."tipo",
      OLD."fir_id", OLD."movimento_id", OLD."creato_da", OLD."creato_il") THEN
    RAISE EXCEPTION 'collegamenti_accesso: si puo'' solo revocare';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER collegamenti_accesso_controlli BEFORE INSERT OR UPDATE ON "collegamenti_accesso"
  FOR EACH ROW EXECUTE FUNCTION collegamenti_accesso_controlli();

-- 5. Privilegi (D4), solo se i ruoli esistono ----------------------------------------------------

DO $priv$
DECLARE
  v_ruolo text;
BEGIN
  FOREACH v_ruolo IN ARRAY ARRAY['wasteflow_app', 'wasteflow_sistema'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ruolo) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "pesate", "rettifiche_peso", "allegati_pesa" FROM %I', v_ruolo);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON "accessi_pesa", "collegamenti_accesso", "automezzi", "strumenti_pesa" FROM %I', v_ruolo);
    END IF;
  END LOOP;
END
$priv$;

-- 6. RLS, in fondo -------------------------------------------------------------------------------

ALTER TABLE "strumenti_pesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strumenti_pesa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "strumenti_pesa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "strumenti_pesa" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "automezzi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automezzi" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "automezzi"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "automezzi" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "accessi_pesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accessi_pesa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "accessi_pesa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "accessi_pesa" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "pesate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pesate" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "pesate"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "pesate" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "rettifiche_peso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rettifiche_peso" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rettifiche_peso"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "rettifiche_peso" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "allegati_pesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allegati_pesa" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "allegati_pesa"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "allegati_pesa" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "collegamenti_accesso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collegamenti_accesso" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "collegamenti_accesso"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "collegamenti_accesso" FOR SELECT TO wasteflow_lettura USING (true);
