-- Migrazione additiva: aggiunge i campi obbligatori del FIR ai sensi del
-- DM 59/2023 (art. 193 D.Lgs 152/2006) non ancora persistiti, e il campo
-- effective_weight (peso effettivo destinatario, 4ª copia).
-- Forward-only. Mai modificare una migrazione già applicata.

ALTER TABLE "firs"
  -- Campo 2: stato fisico rifiuto (Solido/Liquido/Fangoso/Gassoso/Polvere/Misto)
  ADD COLUMN IF NOT EXISTS "waste_physical_state" VARCHAR(50),
  -- Campo 2: caratteristiche di pericolo HP (Reg. UE 1357/2014), comma-separated
  ADD COLUMN IF NOT EXISTS "waste_hazard_classes" TEXT,
  -- Campo 2: numero colli
  ADD COLUMN IF NOT EXISTS "waste_package_count" INTEGER,
  -- Campo 3: codice operazione R/D specifico (R1-R13, D1-D15)
  ADD COLUMN IF NOT EXISTS "waste_operation_code" VARCHAR(10),
  -- Campo 17: annotazioni libere
  ADD COLUMN IF NOT EXISTS "waste_notes" TEXT,
  -- Peso effettivo rilevato dal destinatario (4ª copia)
  ADD COLUMN IF NOT EXISTS "effective_weight" DECIMAL(10, 2),
  -- 4ª copia: data restituzione da destinatario
  ADD COLUMN IF NOT EXISTS "fourth_copy_returned_at" TIMESTAMPTZ,
  -- 4ª copia: note/esito destinatario
  ADD COLUMN IF NOT EXISTS "fourth_copy_notes" TEXT;
