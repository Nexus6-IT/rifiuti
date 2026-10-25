-- RLS pezzo 4, Task 1: policy su role_permissions tramite il ruolo.
--
-- role_permissions e' una tabella ponte (role_id, permission_id) e non ha tenant_id:
-- l'azienda di una riga e' quella del suo ruolo. Una colonna tenant_id duplicata andrebbe
-- tenuta allineata a mano e non aggiunge nulla, quindi la policy passa per roles: una riga
-- e' visibile e scrivibile solo se il suo ruolo e' visibile. La subquery su roles e'
-- a sua volta filtrata dalla policy isolamento_azienda di roles, per cui col ruolo app e
-- app.tenant_id = A si vedono e si scrivono solo righe di ruoli di A; senza app.tenant_id
-- nessuna (fail-closed). wasteflow (superuser) e wasteflow_sistema (BYPASSRLS) la ignorano.
-- La policy si lega a role_id e non a una colonna: l'indice sulla chiave primaria
-- (role_id, permission_id) serve la subquery.
-- Nessun GRANT (li fa ops/db-ruoli.sh).
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_via_ruolo ON "role_permissions"
  USING (EXISTS (SELECT 1 FROM "roles" r WHERE r.id = "role_permissions".role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "roles" r WHERE r.id = "role_permissions".role_id));
