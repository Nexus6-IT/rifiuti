-- Fase 4 pezzo 2b (Task 19): elenchi e righe di addebito del listino (D8, D9, D12, D14, D24 del piano
-- `2026-11-02-fase4-2-listino`). Seconda delle due migration del pezzo; dipende da
-- `20261102300000_listino_archivio_addebiti` (addebiti, codici IVA, codifiche) e da
-- `20261102200100_clienti_agenti_contratti_cliente` (contratti).
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i tre tipi enum (`tipo_quantita_addebito`,
-- `tipologia_rifiuto_addebito`, `applica_prezzo_speciale`); 3. le cinque tabelle
-- (`elenchi_addebiti`, `allegati_elenco_addebiti`, `righe_addebito`, `scaglioni_riga_addebito`,
-- `scadenze_riga_addebito`) con chiave primaria e CHECK (la rete di sicurezza: le regole vere
-- stanno in `domain/listino`); 4. indici e unici (i `*_id_tenant_id_key` sono il bersaglio delle
-- chiavi composite, quindi vengono prima); 5. chiavi esterne: verso `tenants`
-- `<tabella>_tenant_id_fkey` a cascata; composite `(id, tenant_id)` `<tabella>_<riferimento>_fkey`,
-- `NO ACTION` verso le tabelle d'archivio e `CASCADE` verso il padre (elenco -> contratto, righe,
-- allegati -> elenco, fasce e scadenze -> riga); 6. RLS ENABLE + FORCE con le policy
-- `isolamento_azienda` e `sola_lettura`, stessa forma della migration precedente.
--
-- L'unico della riga (`righe_addebito_elenco_tipo_cer_addebito_rif_key`) e' `NULLS NOT DISTINCT`
-- (PostgreSQL 15+, come `giacenze_iniziali`): due righe con lo stesso CER e lo stesso riferimento
-- nullo sono un duplicato. Prisma non rappresenta la clausola e non la confronta: il `@@unique`
-- dello schema ha lo stesso nome e `migrate diff` resta vuoto.
--
-- Le FK composite delle righe garantiscono solo che l'addebito, il codice IVA e le codifiche siano
-- della stessa azienda: NON controllano il genere della codifica ne' lo stato attivo. Lo fa
-- `application/listino/riferimenti-listino.ts`.
--
-- E' additiva e sicura in deploy: `CREATE TYPE`, `CREATE TABLE` e `CREATE INDEX` su tabelle nuove e
-- vuote, nessun `ALTER` di tabelle esistenti, nessun indice parziale. I CHECK non compaiono nel
-- `migrate diff` (Prisma non li conosce). Nessun GRANT qui: `wasteflow_app` e `wasteflow_sistema` li
-- ricevono dai default privileges di `ops/db-ruoli.sh`. La esegue `prisma migrate deploy` col ruolo
-- proprietario (`wasteflow`).
--
-- Ripristino a mano (QUESTA migration va ripristinata PRIMA della
-- `20261102300000_listino_archivio_addebiti`, perche' le sue FK citano addebiti, codici IVA e
-- codifiche; vedi anche il paragrafo "Elenchi e righe di addebito" di `ops/README.md`):
--   DROP TABLE scadenze_riga_addebito, scaglioni_riga_addebito, righe_addebito,
--     allegati_elenco_addebiti, elenchi_addebiti;
--   DROP TYPE applica_prezzo_speciale, tipologia_rifiuto_addebito, tipo_quantita_addebito;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261102300100_listino_elenchi_righe';
-- Le righe e gli elenchi contengono dati dei clienti: esportarli prima. Ripristino da migration
-- fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.righe_addebito')` sia NULL, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261102300100_listino_elenchi_righe`, poi si rilancia
-- il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi ----------------------------------------------------------------------

CREATE TYPE "tipo_quantita_addebito" AS ENUM ('PESO_NETTO', 'PESO_LORDO', 'VOLUME', 'UNO', 'ALTRO');
CREATE TYPE "tipologia_rifiuto_addebito" AS ENUM ('URBANO', 'URBANO_PERICOLOSO', 'SPECIALE', 'SPECIALE_PERICOLOSO');
CREATE TYPE "applica_prezzo_speciale" AS ENUM ('DOCUMENTO', 'PERIODO', 'PROGRESSIVO_DA_DATA', 'CONGUAGLIO_365', 'GIORNO');

-- 3. Tabelle -------------------------------------------------------------------

CREATE TABLE "elenchi_addebiti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contratto_id" UUID NOT NULL,
    "codice" VARCHAR(3) NOT NULL,
    "descrizione" VARCHAR(45) NOT NULL,
    "nota1" VARCHAR(45),
    "nota2" VARCHAR(45),
    "valido_dal" DATE,
    "valido_al" DATE,
    "predefinito" BOOLEAN NOT NULL DEFAULT false,
    "codice_cig" VARCHAR(15),
    "codice_cup" VARCHAR(15),
    "id_documento_pa" VARCHAR(20),
    "data_documento_pa" DATE,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elenchi_addebiti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "elenchi_addebiti_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "elenchi_addebiti_codice_ammesso" CHECK ("codice" ~ '^[A-Za-z0-9]{1,3}$'),
    CONSTRAINT "elenchi_addebiti_validita_coerente" CHECK (("valido_dal" IS NULL) = ("valido_al" IS NULL) AND ("valido_al" IS NULL OR "valido_al" >= "valido_dal")),
    CONSTRAINT "elenchi_addebiti_documento_pa_coerente" CHECK ("data_documento_pa" IS NULL OR "id_documento_pa" IS NOT NULL)
);

CREATE TABLE "allegati_elenco_addebiti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "elenco_id" UUID NOT NULL,
    "posizione" INTEGER NOT NULL,
    "nome_file" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "dimensione_byte" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "contenuto" BYTEA NOT NULL,
    "caricato_da" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegati_elenco_addebiti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allegati_elenco_addebiti_valori" CHECK ("posizione" IN (1, 2) AND "mime_type" = 'application/pdf' AND "dimensione_byte" BETWEEN 1 AND 4194304)
);

CREATE TABLE "righe_addebito" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "elenco_id" UUID NOT NULL,
    "tipo" VARCHAR(4) NOT NULL,
    "cer_code" VARCHAR(10),
    "addebito_id" UUID,
    "riferimento" VARCHAR(8),
    "descrizione" VARCHAR(45),
    "tipo_quantita" "tipo_quantita_addebito",
    "quantita_fissa" DECIMAL(12,3),
    "unita_misura" VARCHAR(3) NOT NULL,
    "prezzo" DECIMAL(14,6),
    "prezzo_speciale" BOOLEAN NOT NULL DEFAULT false,
    "sconto" VARCHAR(20),
    "provvigione" VARCHAR(20),
    "tipo_provvigione" "tipo_provvigione",
    "codice_iva_id" UUID NOT NULL,
    "tipologia_rifiuto" "tipologia_rifiuto_addebito",
    "stato_fisico" VARCHAR(10),
    "operazione" VARCHAR(10),
    "categoria_id" UUID,
    "centro_ricavo_id" UUID,
    "applica_a" "applica_prezzo_speciale",
    "condizioni_riferite" VARCHAR(10),
    "condizione" INTEGER,
    "minimo_fatturabile" DECIMAL(12,2),
    "minimo_per_categoria" BOOLEAN NOT NULL DEFAULT false,
    "riferimento_giorno" INTEGER,
    "riferimento_mese" INTEGER,
    "periodo_scadenze" VARCHAR(2),
    "periodo_extra_dal" DATE,
    "periodo_extra_al" DATE,
    "cer_proposta" VARCHAR(20)[] DEFAULT ARRAY[]::VARCHAR(20)[],
    "addebiti_proposti" VARCHAR(5)[] DEFAULT ARRAY[]::VARCHAR(5)[],
    "stima_annua_kg" DECIMAL(12,2),
    "appunti" VARCHAR(135),
    "nota_uso_interno" VARCHAR(45),
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "righe_addebito_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "righe_addebito_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "righe_addebito_tipo_ammesso" CHECK ("tipo" ~ '^(CER|V|F|T[SPRQTF]|T[0-9]{3}|N[MPGR]|M[FW]|M[0-9]{3}|[$][ADR])$'),
    CONSTRAINT "righe_addebito_cer_coerente" CHECK (("tipo" = 'CER') = ("cer_code" IS NOT NULL)),
    CONSTRAINT "righe_addebito_addebito_coerente" CHECK (("tipo" = 'CER') = ("addebito_id" IS NULL)),
    CONSTRAINT "righe_addebito_unita_misura_ammessa" CHECK ("unita_misura" ~ '^[A-Z0-9/%#]{1,3}$'),
    CONSTRAINT "righe_addebito_tipo_quantita_coerente" CHECK (("tipo" IN ('CER', 'V')) = ("tipo_quantita" IS NOT NULL)),
    CONSTRAINT "righe_addebito_quantita_fissa_ammessa" CHECK ("quantita_fissa" IS NULL OR ("tipo" = 'F' AND "quantita_fissa" >= 0)),
    CONSTRAINT "righe_addebito_prezzo_ammesso" CHECK ("prezzo" IS NULL OR "prezzo" >= 0),
    CONSTRAINT "righe_addebito_prezzo_presente" CHECK ("prezzo_speciale" OR "prezzo" IS NOT NULL),
    CONSTRAINT "righe_addebito_speciale_senza_minimo" CHECK (NOT ("prezzo_speciale" AND "minimo_fatturabile" IS NOT NULL)),
    CONSTRAINT "righe_addebito_minimo_ammesso" CHECK ("minimo_fatturabile" IS NULL OR "minimo_fatturabile" >= 0),
    CONSTRAINT "righe_addebito_stima_annua_ammessa" CHECK ("stima_annua_kg" IS NULL OR "stima_annua_kg" >= 0),
    CONSTRAINT "righe_addebito_condizione_ammessa" CHECK ("condizione" IS NULL OR "condizione" BETWEEN 1 AND 9),
    CONSTRAINT "righe_addebito_condizioni_riferite_ammesse" CHECK ("condizioni_riferite" IS NULL OR "condizioni_riferite" ~ '^[1-9]{1,9}[CP]$'),
    CONSTRAINT "righe_addebito_riferimento_giorno_ammesso" CHECK ("riferimento_giorno" IS NULL OR "riferimento_giorno" BETWEEN 1 AND 31),
    CONSTRAINT "righe_addebito_riferimento_mese_ammesso" CHECK ("riferimento_mese" IS NULL OR "riferimento_mese" BETWEEN 1 AND 12),
    CONSTRAINT "righe_addebito_periodo_scadenze_ammesso" CHECK ("periodo_scadenze" IS NULL OR "periodo_scadenze" IN ('MP', 'BA', 'BP', 'TA', 'TP', 'QA', 'QP', 'SA', 'SP', 'AA', 'AP', 'DA', 'DP', 'XA', 'XD', 'YC')),
    CONSTRAINT "righe_addebito_periodo_extra_coerente" CHECK (("periodo_extra_dal" IS NULL) = ("periodo_extra_al" IS NULL) AND ("periodo_extra_al" IS NULL OR "periodo_extra_al" >= "periodo_extra_dal")),
    CONSTRAINT "righe_addebito_proposte_ammesse" CHECK ("cer_proposta" IS NOT NULL AND cardinality("cer_proposta") <= 50 AND "addebiti_proposti" IS NOT NULL AND cardinality("addebiti_proposti") <= 50)
);

CREATE TABLE "scaglioni_riga_addebito" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "riga_id" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "fino_a" DECIMAL(14,3),
    "prezzo" DECIMAL(14,6) NOT NULL,
    "sconto" VARCHAR(20),
    "provvigione" VARCHAR(20),
    "tipo_calcolo" VARCHAR(1) NOT NULL,

    CONSTRAINT "scaglioni_riga_addebito_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scaglioni_riga_addebito_ordine_ammesso" CHECK ("ordine" BETWEEN 1 AND 7),
    CONSTRAINT "scaglioni_riga_addebito_fino_a_ammesso" CHECK ("fino_a" IS NULL OR "fino_a" > 0),
    CONSTRAINT "scaglioni_riga_addebito_prezzo_ammesso" CHECK ("prezzo" >= 0),
    CONSTRAINT "scaglioni_riga_addebito_tipo_calcolo_ammesso" CHECK ("tipo_calcolo" IN ('A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z', 'W', 'H'))
);

CREATE TABLE "scadenze_riga_addebito" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "riga_id" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "giorno" INTEGER NOT NULL,
    "mese" INTEGER NOT NULL,
    "anno" SMALLINT,

    CONSTRAINT "scadenze_riga_addebito_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scadenze_riga_addebito_valori" CHECK ("ordine" BETWEEN 1 AND 12 AND "giorno" BETWEEN 1 AND 31 AND "mese" BETWEEN 1 AND 12 AND ("anno" IS NULL OR "anno" BETWEEN 1900 AND 2999))
);

-- 4. Indici e unici (prima delle chiavi esterne composite, che li usano) --------

CREATE UNIQUE INDEX "elenchi_addebiti_id_tenant_id_key" ON "elenchi_addebiti"("id", "tenant_id");
CREATE UNIQUE INDEX "elenchi_addebiti_contratto_id_codice_key" ON "elenchi_addebiti"("contratto_id", "codice");
CREATE INDEX "elenchi_addebiti_tenant_id_contratto_id_idx" ON "elenchi_addebiti"("tenant_id", "contratto_id");
CREATE UNIQUE INDEX "allegati_elenco_addebiti_id_tenant_id_key" ON "allegati_elenco_addebiti"("id", "tenant_id");
CREATE UNIQUE INDEX "allegati_elenco_addebiti_elenco_id_posizione_key" ON "allegati_elenco_addebiti"("elenco_id", "posizione");
CREATE INDEX "allegati_elenco_addebiti_tenant_id_idx" ON "allegati_elenco_addebiti"("tenant_id");
CREATE UNIQUE INDEX "righe_addebito_id_tenant_id_key" ON "righe_addebito"("id", "tenant_id");
CREATE UNIQUE INDEX "righe_addebito_elenco_tipo_cer_addebito_rif_key" ON "righe_addebito"("elenco_id", "tipo", "cer_code", "addebito_id", "riferimento") NULLS NOT DISTINCT;
CREATE INDEX "righe_addebito_tenant_id_addebito_id_idx" ON "righe_addebito"("tenant_id", "addebito_id");
CREATE INDEX "righe_addebito_tenant_id_codice_iva_id_idx" ON "righe_addebito"("tenant_id", "codice_iva_id");
CREATE INDEX "righe_addebito_tenant_id_categoria_id_idx" ON "righe_addebito"("tenant_id", "categoria_id");
CREATE INDEX "righe_addebito_tenant_id_centro_ricavo_id_idx" ON "righe_addebito"("tenant_id", "centro_ricavo_id");
CREATE UNIQUE INDEX "scaglioni_riga_addebito_riga_id_ordine_key" ON "scaglioni_riga_addebito"("riga_id", "ordine");
CREATE INDEX "scaglioni_riga_addebito_tenant_id_idx" ON "scaglioni_riga_addebito"("tenant_id");
CREATE UNIQUE INDEX "scadenze_riga_addebito_riga_id_ordine_key" ON "scadenze_riga_addebito"("riga_id", "ordine");
CREATE INDEX "scadenze_riga_addebito_tenant_id_idx" ON "scadenze_riga_addebito"("tenant_id");

-- 5. Chiavi esterne -------------------------------------------------------------

ALTER TABLE "elenchi_addebiti" ADD CONSTRAINT "elenchi_addebiti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "elenchi_addebiti" ADD CONSTRAINT "elenchi_addebiti_contratto_fkey" FOREIGN KEY ("contratto_id", "tenant_id") REFERENCES "contratti_cliente"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "allegati_elenco_addebiti" ADD CONSTRAINT "allegati_elenco_addebiti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegati_elenco_addebiti" ADD CONSTRAINT "allegati_elenco_addebiti_elenco_fkey" FOREIGN KEY ("elenco_id", "tenant_id") REFERENCES "elenchi_addebiti"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_elenco_fkey" FOREIGN KEY ("elenco_id", "tenant_id") REFERENCES "elenchi_addebiti"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_addebito_fkey" FOREIGN KEY ("addebito_id", "tenant_id") REFERENCES "addebiti"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_codice_iva_fkey" FOREIGN KEY ("codice_iva_id", "tenant_id") REFERENCES "codici_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_categoria_fkey" FOREIGN KEY ("categoria_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "righe_addebito" ADD CONSTRAINT "righe_addebito_centro_ricavo_fkey" FOREIGN KEY ("centro_ricavo_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "scaglioni_riga_addebito" ADD CONSTRAINT "scaglioni_riga_addebito_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scaglioni_riga_addebito" ADD CONSTRAINT "scaglioni_riga_addebito_riga_fkey" FOREIGN KEY ("riga_id", "tenant_id") REFERENCES "righe_addebito"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "scadenze_riga_addebito" ADD CONSTRAINT "scadenze_riga_addebito_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scadenze_riga_addebito" ADD CONSTRAINT "scadenze_riga_addebito_riga_fkey" FOREIGN KEY ("riga_id", "tenant_id") REFERENCES "righe_addebito"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- 6. RLS, in fondo --------------------------------------------------------------

ALTER TABLE "elenchi_addebiti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "elenchi_addebiti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "elenchi_addebiti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "elenchi_addebiti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "allegati_elenco_addebiti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allegati_elenco_addebiti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "allegati_elenco_addebiti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "allegati_elenco_addebiti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "righe_addebito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "righe_addebito" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "righe_addebito"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "righe_addebito" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "scaglioni_riga_addebito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scaglioni_riga_addebito" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "scaglioni_riga_addebito"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "scaglioni_riga_addebito" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "scadenze_riga_addebito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scadenze_riga_addebito" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "scadenze_riga_addebito"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "scadenze_riga_addebito" FOR SELECT TO wasteflow_lettura USING (true);
