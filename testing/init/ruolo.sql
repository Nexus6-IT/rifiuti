-- Ruolo in sola lettura per testing-umano sul database wasteflow_prod.
-- Da eseguire come superuser, tutto in una transazione, con la password in un file:
--   psql -v ON_ERROR_STOP=1 -1 -v password="$(cat <file>)" -d wasteflow_prod -f ruolo.sql
-- Se il ruolo esiste gia' il CREATE fallisce e non viene applicato nulla.
CREATE ROLE rifiuti_testing LOGIN PASSWORD :'password' CONNECTION LIMIT 3 NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE rifiuti_testing SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE wasteflow_prod TO rifiuti_testing;
GRANT USAGE ON SCHEMA public TO rifiuti_testing;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rifiuti_testing;
ALTER DEFAULT PRIVILEGES FOR ROLE wasteflow IN SCHEMA public GRANT SELECT ON TABLES TO rifiuti_testing;
