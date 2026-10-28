-- Fase 2 pezzo 3: rettifica e annullamento dei movimenti del registro, additiva.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea l'enum `tipo_annotazione_movimento` (ORDINARIA, RETTIFICA, ANNULLAMENTO);
--   2. aggiunge a `waste_movements` cinque colonne: `tipo_annotazione` (default ORDINARIA),
--      `movimento_rettificato_id` (predecessore diretto), `movimento_originale_id` (radice della
--      catena), `motivo_annotazione`, `hash_versione` (default 1). Le righe esistenti restano
--      ORDINARIA, senza riferimenti e con hash v1: nessun backfill;
--   3. indice unico (id, registro_id, tenant_id, type), bersaglio delle chiavi esterne composte:
--      indice normale (non CONCURRENTLY), la tabella e' piccola in produzione;
--   4. unico su `movimento_rettificato_id` (una riga si corregge una sola volta) e indice su
--      `movimento_originale_id`;
--   5. due chiavi esterne composte (predecessore e radice) verso l'unico: una correzione sta nello
--      stesso registro, azienda e tipo della riga corretta. NO ACTION (controllo a fine statement) e
--      non RESTRICT: la cancellazione a cascata di un'azienda e la pulizia dei test tolgono intere
--      catene in un solo statement. MATCH SIMPLE: le righe con le colonne NULL non sono controllate;
--   6. CHECK: ORDINARIA <=> riferimenti e motivo tutti NULL; altrimenti tutti valorizzati e motivo non
--      vuoto; una riga non corregge se stessa.
--
-- Nessun GRANT: i ruoli applicativi li ricevono dai default privileges (ops/db-ruoli.sh). Nessuna
-- nuova policy RLS: la tabella ha gia' le sue.
--
-- Ripristino (a mano), SOLO dopo aver controllato `SELECT count(*) FROM waste_movements WHERE
-- tipo_annotazione <> 'ORDINARIA'`: dopo un rollback del codice le correzioni conterebbero come
-- movimenti ordinari. Poi: ALTER TABLE waste_movements DROP CONSTRAINT waste_movements_annotazione_coerente,
-- DROP CONSTRAINT waste_movements_non_corregge_se_stessa, DROP CONSTRAINT waste_movements_originale_fkey,
-- DROP CONSTRAINT waste_movements_rettificato_fkey; DROP INDEX waste_movements_movimento_originale_id_idx,
-- waste_movements_movimento_rettificato_id_key, waste_movements_id_registro_tenant_type_key; DROP COLUMN
-- delle cinque colonne; DROP TYPE tipo_annotazione_movimento.

-- 1. Enum.
CREATE TYPE "tipo_annotazione_movimento" AS ENUM ('ORDINARIA', 'RETTIFICA', 'ANNULLAMENTO');

-- 2. Colonne.
ALTER TABLE "waste_movements"
  ADD COLUMN "tipo_annotazione" "tipo_annotazione_movimento" NOT NULL DEFAULT 'ORDINARIA',
  ADD COLUMN "movimento_rettificato_id" UUID,
  ADD COLUMN "movimento_originale_id" UUID,
  ADD COLUMN "motivo_annotazione" VARCHAR(500),
  ADD COLUMN "hash_versione" SMALLINT NOT NULL DEFAULT 1;

-- 3, 4. Indici.
CREATE UNIQUE INDEX "waste_movements_id_registro_tenant_type_key"
  ON "waste_movements"("id", "registro_id", "tenant_id", "type");
CREATE UNIQUE INDEX "waste_movements_movimento_rettificato_id_key"
  ON "waste_movements"("movimento_rettificato_id");
CREATE INDEX "waste_movements_movimento_originale_id_idx"
  ON "waste_movements"("movimento_originale_id");

-- 5. Chiavi esterne composte (nomi espliciti: quelli di default supererebbero 63 caratteri).
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_rettificato_fkey"
  FOREIGN KEY ("movimento_rettificato_id", "registro_id", "tenant_id", "type")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_originale_fkey"
  FOREIGN KEY ("movimento_originale_id", "registro_id", "tenant_id", "type")
  REFERENCES "waste_movements"("id", "registro_id", "tenant_id", "type")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 6. CHECK.
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_annotazione_coerente" CHECK (
  (
    "tipo_annotazione" = 'ORDINARIA'
    AND "movimento_rettificato_id" IS NULL
    AND "movimento_originale_id" IS NULL
    AND "motivo_annotazione" IS NULL
  ) OR (
    "tipo_annotazione" <> 'ORDINARIA'
    AND "movimento_rettificato_id" IS NOT NULL
    AND "movimento_originale_id" IS NOT NULL
    AND "motivo_annotazione" IS NOT NULL
    AND btrim("motivo_annotazione") <> ''
  )
);
ALTER TABLE "waste_movements" ADD CONSTRAINT "waste_movements_non_corregge_se_stessa"
  CHECK ("movimento_rettificato_id" IS NULL OR "movimento_rettificato_id" <> "id");
