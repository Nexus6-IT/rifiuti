-- RLS pezzo 4, Task 2: ruolo di gruppo di sola lettura per i controlli esterni.
--
-- A cosa serve: i controlli esterni (testing-umano, ruolo `rifiuti_testing`) leggono il
-- database di tutte le aziende per verificare che i dati tornino. Con la RLS accesa e FORCE,
-- senza contesto vedono zero righe. Invece di dare BYPASSRLS (che permetterebbe anche di
-- scrivere, se avesse i diritti), si introduce `wasteflow_lettura`: ruolo di gruppo NOLOGIN,
-- senza password, con una policy `sola_lettura` FOR SELECT ... USING (true) sulle 29 tabelle
-- con tenant_id e su role_permissions.
--
-- E' SOLO lettura: la policy vale per il comando SELECT; INSERT/UPDATE/DELETE restano
-- negati dalla RLS (nessuna policy li consente a questo ruolo) oltre che, di norma, dalla
-- mancanza di privilegi. NON da' alcun privilegio sulle tabelle: i diritti SELECT restano
-- quelli che ha gia' chi usa il ruolo (oggi `rifiuti_testing` li ha dai default privileges).
-- wasteflow_app e wasteflow_sistema NON sono membri e non lo devono diventare.
--
-- Per abilitare un utente, fuori dalle migration, da un superuser:
--   GRANT wasteflow_lettura TO <utente>;
-- e per il rientro:
--   REVOKE wasteflow_lettura FROM <utente>;
--
-- Il ruolo e' dell'intero cluster (non del database): si crea solo se manca. Un dump con
-- policy `TO wasteflow_lettura` richiede che il ruolo esista nel cluster di destinazione
-- (ops/restore.sh lo crea prima del caricamento).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wasteflow_lettura') THEN
    CREATE ROLE wasteflow_lettura NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE POLICY sola_lettura ON "activity_logs" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "autorizzazioni_impianto" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "autorizzazioni_impianto_discariche" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "company_templates" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "consultant_tenant_associations" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "contracts" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "destinatari" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "fir_allegati_rentri" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "fir_signatures" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "fir_transporters" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "firs" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "mud_reports" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "notifications" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "permission_audit_logs" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "permission_requests" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "produttori" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "registro_progressivi_iniziali" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "rentri_credentials" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "rentri_numeri_vidimati" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "rentri_sync_logs" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "rentri_unita_locali" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "resource_ownership" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "role_change_history" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "roles" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "temporary_permission_grants" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "trasportatori" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "user_role_assignments" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "users" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "waste_movements" FOR SELECT TO wasteflow_lettura USING (true);
CREATE POLICY sola_lettura ON "role_permissions" FOR SELECT TO wasteflow_lettura USING (true);
