-- Fase 2 pezzo 2: giacenze iniziali (aperture) del registro, additiva.
--
-- Cosa fa, in quest'ordine (un solo script):
--   1. crea l'enum `giacenza_iniziale_provenienza` (MANUALE, IMPORTAZIONE);
--   2. crea `giacenze_iniziali`: una riga per registro, CER, stato fisico e unita' con la quantita'
--      gia' in deposito dalla `data_riferimento`; `CHECK (quantita > 0)`;
--   3. indici, chiavi esterne (azienda CASCADE; registro, composta (registro_id, tenant_id) ->
--      registri_rifiuti(id, tenant_id), RESTRICT: un registro con un'apertura non si cancella) e
--      l'indice unico (registro, CER, stato fisico, unita') con `NULLS NOT DISTINCT`, cosi' due
--      aperture con stato fisico NULL sono un duplicato anche nel database (richiede PostgreSQL
--      15 o superiore; Prisma non confronta la clausola, quindi `migrate diff` resta pulito);
--   4. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` (come la Fase 1) in
--      FONDO, dopo la creazione della tabella.
--
-- Nessun backfill: la tabella nasce vuota. Nessun GRANT: `wasteflow_app` e `wasteflow_sistema` li
-- ricevono dai default privileges che `ops/db-ruoli.sh` (prisma/sql/ruoli-db.sql) imposta per le
-- tabelle create dal proprietario.
--
-- Ripristino (a mano): DROP TABLE giacenze_iniziali; DROP TYPE giacenza_iniziale_provenienza.
-- Prima controllare `SELECT count(*) FROM giacenze_iniziali`: dopo un rollback del codice le
-- aperture sono ignorate e gli scarichi che contavano su di loro tornano bloccati.

-- 1. Enum.
CREATE TYPE "giacenza_iniziale_provenienza" AS ENUM ('MANUALE', 'IMPORTAZIONE');

-- 2. Tabella.
CREATE TABLE "giacenze_iniziali" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "cer_code" VARCHAR(10) NOT NULL,
    "stato_fisico" VARCHAR(50),
    "quantita" DECIMAL(10,2) NOT NULL,
    "unita" VARCHAR(10) NOT NULL,
    "data_riferimento" DATE NOT NULL,
    "origini" JSONB NOT NULL DEFAULT '[]',
    "provenienza" "giacenza_iniziale_provenienza" NOT NULL DEFAULT 'MANUALE',
    "note" VARCHAR(500),
    "impostato_da" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giacenze_iniziali_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "giacenze_iniziali_quantita_positiva" CHECK ("quantita" > 0)
);

-- 3. Indici e chiavi esterne.
CREATE UNIQUE INDEX "giacenze_iniziali_id_tenant_id_key" ON "giacenze_iniziali"("id", "tenant_id");
CREATE UNIQUE INDEX "giacenze_iniziali_registro_cer_stato_unita_key"
  ON "giacenze_iniziali"("registro_id", "cer_code", "stato_fisico", "unita") NULLS NOT DISTINCT;
CREATE INDEX "giacenze_iniziali_tenant_id_idx" ON "giacenze_iniziali"("tenant_id");
CREATE INDEX "giacenze_iniziali_registro_id_idx" ON "giacenze_iniziali"("registro_id");

ALTER TABLE "giacenze_iniziali" ADD CONSTRAINT "giacenze_iniziali_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "giacenze_iniziali" ADD CONSTRAINT "giacenze_iniziali_registro_id_tenant_id_fkey"
  FOREIGN KEY ("registro_id", "tenant_id") REFERENCES "registri_rifiuti"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. RLS, in fondo (stessa forma della Fase 1: 20261025130000 e 20261026100000).
ALTER TABLE "giacenze_iniziali" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "giacenze_iniziali" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "giacenze_iniziali"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "giacenze_iniziali" FOR SELECT TO wasteflow_lettura USING (true);
