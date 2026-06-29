-- Estende il registro cronologico carico/scarico (WasteMovement) con i campi
-- obbligatori ex art. 190 D.Lgs 152/2006 e DM 59/2023:
--   - numero progressivo per tenant/anno
--   - data di registrazione separata dalla data operazione
--   - causale specifica CARICO/SCARICO
--   - stato fisico, caratteristiche pericolo HP, codice R/D
--   - denominazione e indirizzo della controparte
--   - utente che ha registrato l'annotazione
--   - hash di vidimazione digitale (art. 4 DM 59/2023)
-- Amplia cer_code a VARCHAR(10) (coerente con la colonna firs.cer_code).
-- Migrazione additiva forward-only.

-- 1. Amplia cer_code VARCHAR(6) → VARCHAR(10)
ALTER TABLE "waste_movements" ALTER COLUMN "cer_code" TYPE VARCHAR(10);

-- 2. Numero progressivo e anno (NOT NULL; default 0 per backfill row pre-esistenti —
--    l'app assegnerà valori corretti a partire da questa migrazione).
ALTER TABLE "waste_movements" ADD COLUMN "progressive_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "waste_movements" ADD COLUMN "progressive_year"   INTEGER NOT NULL DEFAULT 0;

-- 3. Data di annotazione (default now() — si applica ai record pre-esistenti)
ALTER TABLE "waste_movements" ADD COLUMN "registration_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Causale specifica del movimento (default 'ALTRO_CARICO' per backfill)
ALTER TABLE "waste_movements" ADD COLUMN "causale" VARCHAR(100) NOT NULL DEFAULT 'ALTRO_CARICO';

-- 5. Descrizione rifiuto
ALTER TABLE "waste_movements" ADD COLUMN "waste_description" VARCHAR(500);

-- 6. Stato fisico
ALTER TABLE "waste_movements" ADD COLUMN "waste_physical_state" VARCHAR(50);

-- 7. Caratteristiche pericolo HP
ALTER TABLE "waste_movements" ADD COLUMN "waste_hazard_classes" VARCHAR(100);

-- 8. Codice operazione R/D
ALTER TABLE "waste_movements" ADD COLUMN "operation_code" VARCHAR(10);

-- 9. Controparte
ALTER TABLE "waste_movements" ADD COLUMN "counterpart_name"    VARCHAR(255);
ALTER TABLE "waste_movements" ADD COLUMN "counterpart_address" VARCHAR(500);

-- 10. Utente che ha registrato
ALTER TABLE "waste_movements" ADD COLUMN "recorded_by_user_id" UUID;

-- 11. Hash vidimazione digitale (default stringa vuota — backfill applicazione)
ALTER TABLE "waste_movements" ADD COLUMN "entry_hash" VARCHAR(64) NOT NULL DEFAULT '';

-- 12. Foreign key verso users (nullable — retrocompat.)
ALTER TABLE "waste_movements"
  ADD CONSTRAINT "waste_movements_recorded_by_user_id_fkey"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 13. Foreign key verso tenants
ALTER TABLE "waste_movements"
  ADD CONSTRAINT "waste_movements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 14. Unique constraint progressivo (per tenant/anno)
--     Esclude le righe di backfill (progressive_year=0) per evitare violazioni.
ALTER TABLE "waste_movements"
  ADD CONSTRAINT "waste_movements_tenant_id_progressive_year_progressive_number_key"
  UNIQUE ("tenant_id", "progressive_year", "progressive_number");

-- 15. Indici aggiuntivi
CREATE INDEX "waste_movements_tenant_id_type_idx" ON "waste_movements"("tenant_id", "type");
CREATE INDEX "waste_movements_fir_id_idx"         ON "waste_movements"("fir_id");
