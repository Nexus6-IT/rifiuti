-- Fase 4 pezzo 0 (4.0): modifica e cancellazione del contratto.
--
-- Cosa fa:
--   * `versione` (lock ottimistico, D1, come FIR.versione);
--   * `eliminato_il` / `eliminato_da` (cancellazione logica, D3, nessuna FK all'utente);
--   * CHECK sui due gruppi di colonne;
--   * chiave esterna `contracts.tenant_id -> tenants(id)` (D12), finora mancante.
--
-- E' additiva: colonne nuove con default o nullable, nessun dato riscritto. La FK richiede che
-- non esistano contratti senza azienda: il blocco DO sotto lo verifica e, se ce ne sono, ferma la
-- migration con un messaggio (il proprietario e' superuser e vede tutte le righe nonostante
-- FORCE ROW LEVEL SECURITY).
--
-- Ripristino a mano:
--   ALTER TABLE contracts DROP CONSTRAINT contracts_tenant_id_fkey,
--     DROP CONSTRAINT contracts_eliminazione_coerente, DROP CONSTRAINT contracts_versione_positiva,
--     DROP COLUMN eliminato_da, DROP COLUMN eliminato_il, DROP COLUMN versione;
--   DELETE FROM _prisma_migrations
--     WHERE migration_name = '20261101200000_contratti_modifica_eliminazione';
-- ATTENZIONE (D3): togliere `eliminato_il` fa riapparire i contratti eliminati. Prima del
-- ripristino: SELECT tenant_id, count(*) FROM contracts WHERE eliminato_il IS NOT NULL GROUP BY 1;
-- vedere ops/README.md, sezione Rollback.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "contracts" ADD COLUMN "versione" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contracts" ADD COLUMN "eliminato_il" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN "eliminato_da" UUID;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_versione_positiva" CHECK ("versione" >= 1);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_eliminazione_coerente"
  CHECK ("eliminato_da" IS NULL OR "eliminato_il" IS NOT NULL);

DO $$
DECLARE
  contratti_senza_azienda integer;
BEGIN
  SELECT count(*) INTO contratti_senza_azienda
  FROM "contracts" c
  WHERE NOT EXISTS (SELECT 1 FROM "tenants" t WHERE t."id" = c."tenant_id");
  IF contratti_senza_azienda > 0 THEN
    RAISE EXCEPTION '4.0 contratti: % contratti senza azienda, la FK non si puo'' aggiungere. Correggerli o rimuoverli a mano prima del deploy.',
      contratti_senza_azienda;
  END IF;
END
$$;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
