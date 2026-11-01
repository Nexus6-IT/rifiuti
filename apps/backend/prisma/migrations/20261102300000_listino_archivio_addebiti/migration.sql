-- Fase 4 pezzo 2a (Task 7): archivio degli addebiti e tabelle collegate del listino (D2-D4, D6, D7,
-- D24, D29 del piano `2026-11-02-fase4-2-listino`). Prima delle due migration del pezzo; la seconda
-- (`20261102300100_listino_elenchi_righe`, Task 19) dipende da questa. Dipende da
-- `20261102200100_clienti_agenti_contratti_cliente` (tabella `clienti`).
--
-- Cosa fa, in quest'ordine: 1. lock_timeout; 2. i due tipi enum (`genere_codifica_addebito`,
-- `tipo_provvigione`); 3. le quattro tabelle (`codici_iva`, `codifiche_addebito`, `addebiti`,
-- `prezzi_listino_addebito`) con chiave primaria e CHECK (la rete di sicurezza: le regole vere
-- stanno in `domain/listino`); 4. indici e unici (i `*_id_tenant_id_key` sono il bersaglio delle
-- chiavi composite, quindi vengono prima); 5. chiavi esterne: verso `tenants`
-- `<tabella>_tenant_id_fkey` a cascata; composite `(id, tenant_id)` `<tabella>_<riferimento>_fkey`
-- sempre `NO ACTION` e mai `RESTRICT` (con `NO ACTION` il controllo e' a fine statement, quindi la
-- cancellazione a cascata di un tenant passa); i prezzi a cascata sull'addebito; 6. le tre colonne
-- nullable su `clienti` (D7, Q3) con i due CHECK; 7. RLS ENABLE + FORCE con le policy
-- `isolamento_azienda` e `sola_lettura`, stessa forma di
-- `20261102200100_clienti_agenti_contratti_cliente`.
--
-- Le FK composite di `addebiti` verso `codifiche_addebito` garantiscono solo che la codifica sia
-- della stessa azienda: NON controllano il genere (un gruppo nel posto della categoria) ne' lo stato
-- attivo. Lo fa `application/listino/riferimenti-listino.ts` (R10).
--
-- E' additiva e sicura in deploy: `CREATE TYPE`, `CREATE TABLE` e `CREATE INDEX` su tabelle nuove e
-- vuote, nessun indice parziale. UNICA eccezione, sull'unica tabella esistente toccata: le tre
-- `ADD COLUMN` nullable e senza default su `clienti` (solo catalogo, nessuna riscrittura), con due
-- CHECK. I CHECK sono aggiunti `NOT VALID` e poi `VALIDATE`, per uniformita' col precedente, ma
-- questo NON vuol dire che non blocchino le scritture: la migration e' una sola transazione, e
-- l'`ALTER TABLE` prende un lock ACCESS EXCLUSIVE su `clienti` che tiene fino al commit, quindi
-- letture e scritture sui clienti aspettano per tutta la durata della migration. Il blocco e'
-- breve (colonne nulle, nessuna riscrittura, `VALIDATE` su colonne tutte nulle scorre la tabella
-- una volta) e `lock_timeout` di 5 secondi fa fallire la migration invece di accodare tutto
-- dietro una transazione lunga gia' aperta su `clienti`; in quel caso si rilancia il deploy. I CHECK non compaiono nel `migrate diff`
-- (Prisma non li conosce). Nessun GRANT qui: `wasteflow_app` e `wasteflow_sistema` li ricevono dai
-- default privileges di `ops/db-ruoli.sh`. La esegue `prisma migrate deploy` col ruolo
-- proprietario (`wasteflow`).
--
-- Ripristino a mano (SOLO dopo aver ripristinato la `20261102300100_listino_elenchi_righe`, che
-- cita queste tabelle; vedi anche il paragrafo "Archivio addebiti e codici IVA" di `ops/README.md`):
--   DROP TABLE prezzi_listino_addebito, addebiti, codifiche_addebito, codici_iva;
--   ALTER TABLE clienti DROP COLUMN tipo_provvigione_predefinita, DROP COLUMN provvigione_predefinita,
--     DROP COLUMN listino;
--   DROP TYPE tipo_provvigione, genere_codifica_addebito;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261102300000_listino_archivio_addebiti';
-- I due CHECK di `clienti` spariscono con le colonne. Le tre colonne di `clienti` contengono dati
-- (listino e provvigione dei clienti): esportarli prima. Ripristino da migration fallita (P3009):
-- la migration e' transazionale, quindi si controlla che `SELECT to_regclass('public.addebiti')` sia
-- NULL e che `clienti` non abbia la colonna `listino`, si corregge la causa e si lancia
-- `npx prisma migrate resolve --rolled-back 20261102300000_listino_archivio_addebiti`, poi si
-- rilancia il deploy (vedi `ops/README.md`).

SET LOCAL lock_timeout = '5s';

-- 2. Tipi ----------------------------------------------------------------------

CREATE TYPE "genere_codifica_addebito" AS ENUM ('GRUPPO', 'CATEGORIA', 'CATEGORIA_STATISTICA_1', 'CATEGORIA_STATISTICA_2', 'CENTRO_RICAVO');
CREATE TYPE "tipo_provvigione" AS ENUM ('SCONTATO', 'LORDO');

-- 3. Tabelle -------------------------------------------------------------------

CREATE TABLE "codici_iva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "codice" VARCHAR(3) NOT NULL,
    "descrizione" VARCHAR(60) NOT NULL,
    "aliquota" DECIMAL(5,2) NOT NULL,
    "natura" VARCHAR(4),
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codici_iva_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "codici_iva_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "codici_iva_codice_ammesso" CHECK ("codice" ~ '^[A-Za-z0-9]{1,3}$'),
    CONSTRAINT "codici_iva_aliquota_ammessa" CHECK ("aliquota" BETWEEN 0 AND 100),
    CONSTRAINT "codici_iva_natura_coerente" CHECK (("aliquota" = 0) = ("natura" IS NOT NULL)),
    CONSTRAINT "codici_iva_natura_ammessa" CHECK ("natura" IS NULL OR "natura" IN ('N1', 'N2.1', 'N2.2', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5', 'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7'))
);

CREATE TABLE "codifiche_addebito" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "genere" "genere_codifica_addebito" NOT NULL,
    "codice" VARCHAR(3) NOT NULL,
    "descrizione" VARCHAR(45) NOT NULL,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codifiche_addebito_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "codifiche_addebito_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "codifiche_addebito_codice_ammesso" CHECK ("codice" ~ '^[0-9]{3}$' AND "codice" <> '000')
);

CREATE TABLE "addebiti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "codice" VARCHAR(5) NOT NULL,
    "descrizione" VARCHAR(45) NOT NULL,
    "gruppo_id" UUID NOT NULL,
    "unita_misura" VARCHAR(3) NOT NULL,
    "codice_iva_id" UUID,
    "tipo" VARCHAR(4) NOT NULL DEFAULT 'V',
    "categoria_id" UUID,
    "tipo_provvigione" "tipo_provvigione" NOT NULL DEFAULT 'SCONTATO',
    "centro_ricavo_id" UUID,
    "categoria_statistica_1_id" UUID,
    "categoria_statistica_2_id" UUID,
    "nota_uso_interno" VARCHAR(45),
    "appunti" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addebiti_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "addebiti_versione_positiva" CHECK ("versione" >= 1),
    CONSTRAINT "addebiti_codice_ammesso" CHECK ("codice" ~ '^[0-9]{5}$' AND "codice" <> '00000'),
    CONSTRAINT "addebiti_unita_misura_ammessa" CHECK ("unita_misura" ~ '^[A-Z0-9/%#]{1,3}$'),
    CONSTRAINT "addebiti_tipo_ammesso" CHECK ("tipo" ~ '^(V|F|T[SPRQTF]|T[0-9]{3}|N[MPGR]|M[FW]|M[0-9]{3}|[$][ADR])$'),
    CONSTRAINT "addebiti_tipo_t_unita_misura" CHECK ("tipo" !~ '^T' OR "unita_misura" IN ('KG', 'TON'))
);

CREATE TABLE "prezzi_listino_addebito" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "addebito_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "prezzo" DECIMAL(14,6),
    "sconto" VARCHAR(20),
    "provvigione" VARCHAR(20),

    CONSTRAINT "prezzi_listino_addebito_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prezzi_listino_addebito_numero_ammesso" CHECK ("numero" BETWEEN 1 AND 6),
    CONSTRAINT "prezzi_listino_addebito_prezzo_ammesso" CHECK ("prezzo" IS NULL OR "prezzo" >= 0)
);

-- 4. Indici e unici (prima delle chiavi esterne composite, che li usano) --------

CREATE INDEX "codici_iva_tenant_id_idx" ON "codici_iva"("tenant_id");
CREATE UNIQUE INDEX "codici_iva_id_tenant_id_key" ON "codici_iva"("id", "tenant_id");
CREATE UNIQUE INDEX "codici_iva_tenant_id_codice_key" ON "codici_iva"("tenant_id", "codice");
CREATE INDEX "codifiche_addebito_tenant_id_idx" ON "codifiche_addebito"("tenant_id");
CREATE UNIQUE INDEX "codifiche_addebito_id_tenant_id_key" ON "codifiche_addebito"("id", "tenant_id");
CREATE UNIQUE INDEX "codifiche_addebito_tenant_id_genere_codice_key" ON "codifiche_addebito"("tenant_id", "genere", "codice");
CREATE INDEX "addebiti_tenant_id_idx" ON "addebiti"("tenant_id");
CREATE UNIQUE INDEX "addebiti_id_tenant_id_key" ON "addebiti"("id", "tenant_id");
CREATE UNIQUE INDEX "addebiti_tenant_id_codice_key" ON "addebiti"("tenant_id", "codice");
CREATE INDEX "prezzi_listino_addebito_tenant_id_idx" ON "prezzi_listino_addebito"("tenant_id");
CREATE UNIQUE INDEX "prezzi_listino_addebito_addebito_id_numero_key" ON "prezzi_listino_addebito"("addebito_id", "numero");

-- 5. Chiavi esterne -------------------------------------------------------------

ALTER TABLE "codici_iva" ADD CONSTRAINT "codici_iva_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "codifiche_addebito" ADD CONSTRAINT "codifiche_addebito_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_gruppo_fkey" FOREIGN KEY ("gruppo_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_codice_iva_fkey" FOREIGN KEY ("codice_iva_id", "tenant_id") REFERENCES "codici_iva"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_categoria_fkey" FOREIGN KEY ("categoria_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_centro_ricavo_fkey" FOREIGN KEY ("centro_ricavo_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_categoria_statistica_1_fkey" FOREIGN KEY ("categoria_statistica_1_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "addebiti" ADD CONSTRAINT "addebiti_categoria_statistica_2_fkey" FOREIGN KEY ("categoria_statistica_2_id", "tenant_id") REFERENCES "codifiche_addebito"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "prezzi_listino_addebito" ADD CONSTRAINT "prezzi_listino_addebito_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prezzi_listino_addebito" ADD CONSTRAINT "prezzi_listino_addebito_addebito_fkey" FOREIGN KEY ("addebito_id", "tenant_id") REFERENCES "addebiti"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- 6. Clienti: listino e provvigione predefiniti (D7, Q3) -------------------------

ALTER TABLE "clienti" ADD COLUMN "listino" SMALLINT, ADD COLUMN "provvigione_predefinita" VARCHAR(20), ADD COLUMN "tipo_provvigione_predefinita" "tipo_provvigione";
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_listino_ammesso" CHECK ("listino" IS NULL OR "listino" BETWEEN 1 AND 6) NOT VALID;
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_provvigione_con_tipo" CHECK (("provvigione_predefinita" IS NULL) = ("tipo_provvigione_predefinita" IS NULL)) NOT VALID;
ALTER TABLE "clienti" VALIDATE CONSTRAINT "clienti_listino_ammesso";
ALTER TABLE "clienti" VALIDATE CONSTRAINT "clienti_provvigione_con_tipo";

-- 7. RLS, in fondo --------------------------------------------------------------

ALTER TABLE "codici_iva" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "codici_iva" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "codici_iva"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "codici_iva" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "codifiche_addebito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "codifiche_addebito" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "codifiche_addebito"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "codifiche_addebito" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "addebiti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "addebiti" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "addebiti"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "addebiti" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "prezzi_listino_addebito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prezzi_listino_addebito" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "prezzi_listino_addebito"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "prezzi_listino_addebito" FOR SELECT TO wasteflow_lettura USING (true);
