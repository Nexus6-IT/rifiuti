-- Fase 2 pezzo 10 (F2-10), Task 5a, D9.4: sede e codice fiscale delle parti del FIR.
--
-- Additiva: cinque colonne NULL su `firs`, nessun default, nessun backfill (i FIR esistenti restano
-- con NULL: il documento firmato e lo snapshot non cambiano). Nessuna FK sulle sedi (snapshot) e
-- nessuna policy: `firs` e' gia sotto RLS e le colonne nuove ereditano `isolamento_azienda`.
-- `lock_timeout` di 5 secondi perche' `firs` e' una tabella viva: meglio fallire che accodare le
-- scritture dietro un lock.
--
-- Ripristino: ALTER TABLE firs DROP COLUMN producer_sede_id, DROP COLUMN receiver_sede_id,
-- DROP COLUMN producer_codice_fiscale, DROP COLUMN carrier_codice_fiscale,
-- DROP COLUMN receiver_codice_fiscale; poi `prisma migrate resolve --rolled-back
-- 20261031110200_fir_parti_sede_cf` (v. ops/README.md).

SET LOCAL lock_timeout = '5s';

ALTER TABLE "firs"
  ADD COLUMN "producer_sede_id" UUID,
  ADD COLUMN "receiver_sede_id" UUID,
  ADD COLUMN "producer_codice_fiscale" VARCHAR(16),
  ADD COLUMN "carrier_codice_fiscale" VARCHAR(16),
  ADD COLUMN "receiver_codice_fiscale" VARCHAR(16);
