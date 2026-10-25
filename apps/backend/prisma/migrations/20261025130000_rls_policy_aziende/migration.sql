-- RLS pezzo 3: Row Level Security attiva e forzata, con la policy isolamento_azienda,
-- su ogni tabella dello schema public che ha la colonna tenant_id (29 tabelle).
--
-- La policy e' uguale per tutte: una riga e' visibile e scrivibile solo se il suo
-- tenant_id coincide con app.tenant_id della transazione. Senza app.tenant_id
-- NULLIF(..., '') da' NULL, il confronto non e' mai vero: non si vede e non si scrive
-- nulla (fail-closed). Nessuna clausola TO, quindi vale per tutti i ruoli; wasteflow
-- (superuser, proprietario) e wasteflow_sistema (BYPASSRLS) la ignorano, percio' finche'
-- l'app si collega con wasteflow in produzione non cambia nulla.
--
-- Fuori di proposito: role_permissions (senza tenant_id, protetta indirettamente da
-- roles, che ha la policy), tenants, access_requests e le tabelle globali.
-- Nessun GRANT (i ruoli si creano dopo il migrate con ops/db-ruoli.sh).
--
-- Indici su tenant_id dove mancava un indice con tenant_id in testa (la policy lo usa
-- in ogni query): temporary_permission_grants e permission_requests. Nomi derivati da
-- Prisma, cosi' migrate diff non vede scarti.
CREATE INDEX "temporary_permission_grants_tenant_id_idx" ON "temporary_permission_grants"("tenant_id");
CREATE INDEX "permission_requests_tenant_id_idx" ON "permission_requests"("tenant_id");

ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "activity_logs"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "autorizzazioni_impianto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "autorizzazioni_impianto" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "autorizzazioni_impianto"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "autorizzazioni_impianto_discariche" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "autorizzazioni_impianto_discariche" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "autorizzazioni_impianto_discariche"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "company_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "company_templates"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "consultant_tenant_associations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultant_tenant_associations" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "consultant_tenant_associations"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "contracts"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "destinatari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "destinatari" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "destinatari"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "fir_allegati_rentri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fir_allegati_rentri" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "fir_allegati_rentri"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "fir_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fir_signatures" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "fir_signatures"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "fir_transporters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fir_transporters" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "fir_transporters"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "firs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "firs" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "firs"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "mud_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mud_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "mud_reports"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "notifications"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "permission_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission_audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "permission_audit_logs"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "permission_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "permission_requests"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "produttori" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "produttori" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "produttori"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "registro_progressivi_iniziali" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registro_progressivi_iniziali" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "registro_progressivi_iniziali"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rentri_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rentri_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rentri_credentials"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rentri_numeri_vidimati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rentri_numeri_vidimati" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rentri_numeri_vidimati"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rentri_sync_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rentri_sync_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rentri_sync_logs"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rentri_unita_locali" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rentri_unita_locali" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "rentri_unita_locali"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "resource_ownership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_ownership" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "resource_ownership"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "role_change_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_change_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "role_change_history"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "roles"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "temporary_permission_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "temporary_permission_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "temporary_permission_grants"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "trasportatori" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trasportatori" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "trasportatori"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "user_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_role_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "user_role_assignments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "users"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "waste_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "waste_movements"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

