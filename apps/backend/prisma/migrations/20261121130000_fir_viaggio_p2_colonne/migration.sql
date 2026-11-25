-- FIR RENTRI in viaggio, pezzo P2: quantita' e dati di trasporto.
--
-- Solo colonne nuove, tutte NULLABLE e senza DEFAULT: nessuna riga esistente viene riscritta
-- (ADD COLUMN senza default e' un'operazione sul solo catalogo). Nessuna colonna entra nell'hash
-- di integrita' ne' nel documento firmato.
--
--   firs
--     verificato_in_partenza, rinfusa      campi di `QuantitaRifiutoModel`.
--     conducente_nome/_cognome,            dati di trasporto della tratta PRINCIPALE (il trasportatore
--     targa_rimorchio, percorso            principale vive inline su `firs`); la data di inizio
--                                          trasporto e' `transport_date`, la targa `carrier_vehicle_plate`.
--     rentri_dichiarato                    COPIA SEPARATA di cio' che l'ente ha accettato (quantita' e targa
--                                          dell'automezzo): le colonne firmate all'emissione (`quantity`,
--                                          `unit`, `waste_package_count`, `carrier_vehicle_plate`) non si
--                                          riscrivono mai dopo l'emissione. Scritta solo dal repository dei
--                                          dati di viaggio, mai dal `save` dell'aggregate.
--   fir_transporters                       gli stessi dati, per le tratte aggiuntive (il trasbordo
--                                          totale, P6, aggiunge una tratta con un altro conducente).
--
-- Lunghezze = limiti del contratto (`ConducenteModel`: 50; targa: 10; percorso: 250).
--
-- ROLLBACK (solo prima dell'uso):
--   ALTER TABLE firs DROP COLUMN verificato_in_partenza, DROP COLUMN rinfusa, DROP COLUMN conducente_nome,
--     DROP COLUMN conducente_cognome, DROP COLUMN targa_rimorchio, DROP COLUMN percorso, DROP COLUMN rentri_dichiarato;
--   ALTER TABLE fir_transporters DROP COLUMN conducente_nome, DROP COLUMN conducente_cognome,
--     DROP COLUMN targa_rimorchio, DROP COLUMN percorso, DROP COLUMN data_ora_inizio_trasporto;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261121130000_fir_viaggio_p2_colonne';

SET LOCAL lock_timeout = '5s';

ALTER TABLE "firs"
  ADD COLUMN "verificato_in_partenza" BOOLEAN,
  ADD COLUMN "rinfusa" BOOLEAN,
  ADD COLUMN "conducente_nome" VARCHAR(50),
  ADD COLUMN "conducente_cognome" VARCHAR(50),
  ADD COLUMN "targa_rimorchio" VARCHAR(10),
  ADD COLUMN "percorso" VARCHAR(250),
  ADD COLUMN "rentri_dichiarato" JSONB;

ALTER TABLE "fir_transporters"
  ADD COLUMN "conducente_nome" VARCHAR(50),
  ADD COLUMN "conducente_cognome" VARCHAR(50),
  ADD COLUMN "targa_rimorchio" VARCHAR(10),
  ADD COLUMN "percorso" VARCHAR(250),
  ADD COLUMN "data_ora_inizio_trasporto" TIMESTAMPTZ(3);
