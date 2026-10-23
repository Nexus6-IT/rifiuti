-- Un FIR si ricopia nel registro una sola volta per tipo di movimento.
-- Additiva e senza vincoli sui dati esistenti: la colonna nasce NULL per tutte le
-- righe storiche (anche per i doppi gia' presenti) e in Postgres i NULL sono
-- distinti, quindi l'indice unico non puo' fallire alla creazione. Lo valorizzano
-- solo i movimenti registrati dal codice nuovo.
ALTER TABLE "waste_movements" ADD COLUMN "fir_id_ricopia" UUID;
CREATE UNIQUE INDEX "waste_movements_tenant_id_fir_id_ricopia_type_key"
  ON "waste_movements"("tenant_id", "fir_id_ricopia", "type");
