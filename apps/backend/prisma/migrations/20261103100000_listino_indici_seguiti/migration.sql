-- Seguiti della fase 4.2b (3 novembre 2026): indici e un CHECK, tutto additivo. La migration
-- `20261102300100_listino_elenchi_righe` e' gia' in produzione e non si tocca.
--
-- 1. `activity_logs (tenant_id, action)`: la lettura delle applicazioni ISTAT passate
--    (`ultimeApplicazioniIstat`, azione `PREZZI_ISTAT`) filtrava per azienda e azione sull'intero
--    storico dell'audit (M16).
-- 2. Sei indici `addebiti (tenant_id, <colonna>)` sulle colonne delle FK composite verso
--    `codici_iva` e `codifiche_addebito`, rimaste senza indice: senza, ogni disattivazione o
--    cancellazione di una codifica (e il conteggio degli usi) scorre l'intera tabella degli
--    addebiti. Le altre FK della 4.2b sono gia' coperte da un indice o da un unico che parte dalla
--    stessa colonna (righe, fasce, scadenze, allegati, prezzi di listino, elenchi).
-- 3. `elenchi_addebiti_codice_non_000`: il codice `000` e' riservato come nelle codifiche (in
--    WinWaste l'elenco 0 vuol dire "prendi il predefinito"); `NOT VALID` poi `VALIDATE`. Nella
--    stessa transazione l'`ADD CONSTRAINT` tiene comunque il lock esclusivo fino al commit (il
--    vantaggio del due tempi si avrebbe solo con due migration separate): va bene perche' la
--    tabella e' piccola. PRIMA DEL DEPLOY: `SELECT count(*) FROM elenchi_addebiti WHERE
--    codice = '000'` deve dare 0, altrimenti `VALIDATE` fallisce e la migration si ferma.
--
-- Rollback (a mano, in quest'ordine; nessun dato da recuperare):
--   ALTER TABLE "elenchi_addebiti" DROP CONSTRAINT "elenchi_addebiti_codice_non_000";
--   DROP INDEX "addebiti_tenant_id_gruppo_id_idx";
--   DROP INDEX "addebiti_tenant_id_codice_iva_id_idx";
--   DROP INDEX "addebiti_tenant_id_categoria_id_idx";
--   DROP INDEX "addebiti_tenant_id_centro_ricavo_id_idx";
--   DROP INDEX "addebiti_tenant_id_categoria_statistica_1_id_idx";
--   DROP INDEX "addebiti_tenant_id_categoria_statistica_2_id_idx";
--   DROP INDEX "activity_logs_tenant_id_action_idx";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261103100000_listino_indici_seguiti';

SET LOCAL lock_timeout = '5s';

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_action_idx" ON "activity_logs"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "addebiti_tenant_id_gruppo_id_idx" ON "addebiti"("tenant_id", "gruppo_id");
CREATE INDEX "addebiti_tenant_id_codice_iva_id_idx" ON "addebiti"("tenant_id", "codice_iva_id");
CREATE INDEX "addebiti_tenant_id_categoria_id_idx" ON "addebiti"("tenant_id", "categoria_id");
CREATE INDEX "addebiti_tenant_id_centro_ricavo_id_idx" ON "addebiti"("tenant_id", "centro_ricavo_id");
CREATE INDEX "addebiti_tenant_id_categoria_statistica_1_id_idx" ON "addebiti"("tenant_id", "categoria_statistica_1_id");
CREATE INDEX "addebiti_tenant_id_categoria_statistica_2_id_idx" ON "addebiti"("tenant_id", "categoria_statistica_2_id");

-- Codice elenco 000 vietato (decisione del 3 novembre 2026).
ALTER TABLE "elenchi_addebiti" ADD CONSTRAINT "elenchi_addebiti_codice_non_000" CHECK ("codice" <> '000') NOT VALID;
ALTER TABLE "elenchi_addebiti" VALIDATE CONSTRAINT "elenchi_addebiti_codice_non_000";
