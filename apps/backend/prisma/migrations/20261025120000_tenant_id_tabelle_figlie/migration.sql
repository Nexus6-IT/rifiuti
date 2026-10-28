-- RLS pezzo 3: le quattro tabelle figlie ricevono tenant_id, copiato dal padre.
-- Servono perche' la policy per azienda (migration successiva) ragiona su una colonna
-- della riga stessa: senza, firme, trasportatori, allegati e discariche resterebbero fuori.
--
-- Per ciascuna figlia: colonna nullable, riempimento dal padre, NOT NULL, indice, poi la
-- chiave esterna composta (padre_id, tenant_id) -> padre(id, tenant_id). Questa e' la
-- garanzia vera: una figlia con un tenant_id diverso da quello del padre viene rifiutata
-- dal database anche per il ruolo owner e per quello di sistema. Il bersaglio e' un
-- vincolo unico (id, tenant_id) sul padre (ridondante con la chiave primaria, ma Postgres
-- lo richiede).
-- La chiave esterna semplice esistente viene SOSTITUITA, non affiancata: la composta
-- implica la semplice (se (fir_id, tenant_id) esiste nel padre, fir_id esiste) e ha lo
-- stesso ON DELETE CASCADE, quindi lasciarle entrambe sarebbe solo un doppio controllo.
-- Il comportamento di cancellazione non cambia. Nessun valore di default sulla colonna.
-- Nomi accorciati a 63 caratteri come li deriva Prisma, cosi' migrate diff non vede scarti.

-- Vincoli unici sui padri (bersaglio delle chiavi composte).
CREATE UNIQUE INDEX "firs_id_tenant_id_key" ON "firs"("id", "tenant_id");
CREATE UNIQUE INDEX "autorizzazioni_impianto_id_tenant_id_key" ON "autorizzazioni_impianto"("id", "tenant_id");

-- fir_signatures
ALTER TABLE "fir_signatures" ADD COLUMN "tenant_id" UUID;
UPDATE "fir_signatures" f SET "tenant_id" = p."tenant_id" FROM "firs" p WHERE f."fir_id" = p."id";
ALTER TABLE "fir_signatures" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "fir_signatures_tenant_id_idx" ON "fir_signatures"("tenant_id");
ALTER TABLE "fir_signatures" DROP CONSTRAINT "fir_signatures_fir_id_fkey";
ALTER TABLE "fir_signatures" ADD CONSTRAINT "fir_signatures_fir_id_tenant_id_fkey"
  FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- fir_transporters
ALTER TABLE "fir_transporters" ADD COLUMN "tenant_id" UUID;
UPDATE "fir_transporters" f SET "tenant_id" = p."tenant_id" FROM "firs" p WHERE f."fir_id" = p."id";
ALTER TABLE "fir_transporters" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "fir_transporters_tenant_id_idx" ON "fir_transporters"("tenant_id");
ALTER TABLE "fir_transporters" DROP CONSTRAINT "fir_transporters_fir_id_fkey";
ALTER TABLE "fir_transporters" ADD CONSTRAINT "fir_transporters_fir_id_tenant_id_fkey"
  FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- fir_allegati_rentri
ALTER TABLE "fir_allegati_rentri" ADD COLUMN "tenant_id" UUID;
UPDATE "fir_allegati_rentri" f SET "tenant_id" = p."tenant_id" FROM "firs" p WHERE f."fir_id" = p."id";
ALTER TABLE "fir_allegati_rentri" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "fir_allegati_rentri_tenant_id_idx" ON "fir_allegati_rentri"("tenant_id");
ALTER TABLE "fir_allegati_rentri" DROP CONSTRAINT "fir_allegati_rentri_fir_id_fkey";
ALTER TABLE "fir_allegati_rentri" ADD CONSTRAINT "fir_allegati_rentri_fir_id_tenant_id_fkey"
  FOREIGN KEY ("fir_id", "tenant_id") REFERENCES "firs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- autorizzazioni_impianto_discariche
ALTER TABLE "autorizzazioni_impianto_discariche" ADD COLUMN "tenant_id" UUID;
UPDATE "autorizzazioni_impianto_discariche" f SET "tenant_id" = p."tenant_id" FROM "autorizzazioni_impianto" p WHERE f."autorizzazione_id" = p."id";
ALTER TABLE "autorizzazioni_impianto_discariche" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "autorizzazioni_impianto_discariche_tenant_id_idx" ON "autorizzazioni_impianto_discariche"("tenant_id");
ALTER TABLE "autorizzazioni_impianto_discariche" DROP CONSTRAINT "autorizzazioni_impianto_discariche_autorizzazione_id_fkey";
ALTER TABLE "autorizzazioni_impianto_discariche" ADD CONSTRAINT "autorizzazioni_impianto_discariche_autorizzazione_id_tenan_fkey"
  FOREIGN KEY ("autorizzazione_id", "tenant_id") REFERENCES "autorizzazioni_impianto"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
