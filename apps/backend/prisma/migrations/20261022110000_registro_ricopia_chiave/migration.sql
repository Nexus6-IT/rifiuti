-- C-W-03: piu' movimenti dello stesso verso dallo stesso FIR (come WinWaste), per i
-- flussi futuri dei gestori (produttori percentuali, spurghi). Oggi la ricopia
-- ordinaria scrive sempre la chiave vuota, quindi per i produttori non cambia nulla.
--
-- Additiva e non puo' fallire: tutte le righe esistenti ricevono '' dal DEFAULT, e il
-- vecchio indice (tenant_id, fir_id_ricopia, type) garantiva gia' l'unicita' su un
-- sottoinsieme delle colonne del nuovo, quindi nessuna coppia di righe puo' collidere.
-- Il nuovo indice si crea PRIMA di togliere il vecchio: se lo script si interrompe a
-- meta', la tabella non resta mai senza vincolo sulla ricopia.
-- Nome dell'indice: quello che Prisma deriva dallo schema, gia' accorciato a 63
-- caratteri (limite degli identificatori di Postgres), cosi' migrate diff non vede scarti.
ALTER TABLE "waste_movements" ADD COLUMN "ricopia_chiave" VARCHAR(100) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "waste_movements_tenant_id_fir_id_ricopia_type_ricopia_chiav_key"
  ON "waste_movements"("tenant_id", "fir_id_ricopia", "type", "ricopia_chiave");
DROP INDEX "waste_movements_tenant_id_fir_id_ricopia_type_key";
