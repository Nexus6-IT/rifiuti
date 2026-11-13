-- Fase 4 pezzo 8b, D11 (1/2): valore `SIMULATA` dell'enum `fonte_pesata`.
--
-- Sta in una migration a se' perche' un valore enum aggiunto non e' usabile nella stessa
-- transazione in cui nasce: `20261113100100_pese_agenti` lo usa nel CHECK `pesate_lettura_check`.
--
-- Ripristino: un valore NON si toglie da un enum PostgreSQL. Resta inutilizzato (nessuna riga lo
-- usa se la migration successiva viene annullata). Vedi `ops/README.md`.

SET LOCAL lock_timeout = '5s';

ALTER TYPE "fonte_pesata" ADD VALUE IF NOT EXISTS 'SIMULATA';
