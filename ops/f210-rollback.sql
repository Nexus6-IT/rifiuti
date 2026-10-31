-- Rollback di 20261031110100_anagrafiche_su_ditte (F2-10). NON si lancia da solo: lo invoca la
-- procedura "Rollback" di ops/README.md, che antepone BEGIN; e la definizione di
-- f210_collega_anagrafiche() (presa dalla 110000) e passa tutto su STDIN a psql nel container.
UPDATE produttori r
   SET ragione_sociale = d.ragione_sociale, partita_iva = d.partita_iva,
       via = s.via, civico = s.civico, cap = s.cap, comune = s.comune, provincia = s.provincia,
       email = s.email, telefono = s.telefono, pec = s.pec
  FROM ditte d, sedi_ditte s
 WHERE d.id = r.ditta_id AND s.id = r.sede_id;
ALTER TABLE produttori
  ALTER COLUMN ragione_sociale SET NOT NULL, ALTER COLUMN partita_iva SET NOT NULL,
  ALTER COLUMN via SET NOT NULL, ALTER COLUMN civico SET NOT NULL, ALTER COLUMN cap SET NOT NULL,
  ALTER COLUMN comune SET NOT NULL, ALTER COLUMN provincia SET NOT NULL,
  ALTER COLUMN ditta_id DROP NOT NULL, ALTER COLUMN sede_id DROP NOT NULL;
CREATE UNIQUE INDEX produttori_tenant_id_partita_iva_key ON produttori (tenant_id, partita_iva);
UPDATE trasportatori r
   SET ragione_sociale = d.ragione_sociale, partita_iva = d.partita_iva,
       via = s.via, civico = s.civico, cap = s.cap, comune = s.comune, provincia = s.provincia,
       email = s.email, telefono = s.telefono, pec = s.pec
  FROM ditte d, sedi_ditte s
 WHERE d.id = r.ditta_id AND s.id = r.sede_id;
ALTER TABLE trasportatori
  ALTER COLUMN ragione_sociale SET NOT NULL, ALTER COLUMN partita_iva SET NOT NULL,
  ALTER COLUMN via SET NOT NULL, ALTER COLUMN civico SET NOT NULL, ALTER COLUMN cap SET NOT NULL,
  ALTER COLUMN comune SET NOT NULL, ALTER COLUMN provincia SET NOT NULL,
  ALTER COLUMN ditta_id DROP NOT NULL, ALTER COLUMN sede_id DROP NOT NULL;
CREATE UNIQUE INDEX trasportatori_tenant_id_partita_iva_key ON trasportatori (tenant_id, partita_iva);
UPDATE destinatari r
   SET ragione_sociale = d.ragione_sociale, partita_iva = d.partita_iva,
       via = s.via, civico = s.civico, cap = s.cap, comune = s.comune, provincia = s.provincia,
       email = s.email, telefono = s.telefono, pec = s.pec
  FROM ditte d, sedi_ditte s
 WHERE d.id = r.ditta_id AND s.id = r.sede_id;
ALTER TABLE destinatari
  ALTER COLUMN ragione_sociale SET NOT NULL, ALTER COLUMN partita_iva SET NOT NULL,
  ALTER COLUMN via SET NOT NULL, ALTER COLUMN civico SET NOT NULL, ALTER COLUMN cap SET NOT NULL,
  ALTER COLUMN comune SET NOT NULL, ALTER COLUMN provincia SET NOT NULL,
  ALTER COLUMN ditta_id DROP NOT NULL, ALTER COLUMN sede_id DROP NOT NULL;
CREATE UNIQUE INDEX destinatari_tenant_id_partita_iva_key ON destinatari (tenant_id, partita_iva);
DELETE FROM _prisma_migrations WHERE migration_name = '20261031110100_anagrafiche_su_ditte';
COMMIT;
