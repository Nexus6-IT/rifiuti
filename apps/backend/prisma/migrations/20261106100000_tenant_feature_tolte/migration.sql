-- Moduli di un'azienda: colonna `feature_tolte`, i moduli del piano tolti a quella azienda.
--
-- `feature_flags` resta com'e' (moduli AGGIUNTI oltre al piano). Moduli effettivi =
-- (piano + feature_flags) - feature_tolte. Un modulo nuovo del piano arriva a tutte le aziende
-- che non l'hanno tolto. Json nullable: null = nessun modulo tolto. Nessun dato esistente cambia.
--
-- Additiva. La esegue `prisma migrate deploy` col proprietario.
--
-- Ripristino a mano (nessun altro dato dipende dalla colonna):
--   ALTER TABLE "tenants" DROP COLUMN "feature_tolte";

ALTER TABLE "tenants" ADD COLUMN "feature_tolte" JSONB;
