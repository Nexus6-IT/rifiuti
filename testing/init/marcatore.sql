-- Marcatore d'ambiente: testing-umano rifiuta di partire se il database non lo dichiara.
-- Da eseguire come superuser: psql -v ON_ERROR_STOP=1 -d wasteflow_prod -f marcatore.sql
-- Vale per le connessioni nuove; non tocca dati ne' sessioni aperte.
ALTER DATABASE wasteflow_prod SET testing.ambiente = 'staging';
