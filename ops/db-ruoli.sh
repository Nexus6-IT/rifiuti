#!/usr/bin/env bash
# ==============================================================================
# db-ruoli.sh — esegue apps/backend/prisma/sql/ruoli-db.sql nel container postgres
# ------------------------------------------------------------------------------
# Un solo punto d'ingresso per sviluppo, CI, deploy e restore. Va lanciato SEMPRE
# DOPO `prisma migrate deploy` (lo script SQL si ferma se _prisma_migrations non
# esiste) e come owner superuser.
#
# Uso:
#   PG_EXEC="<comando che esegue un processo nel container, con stdin>" \
#     bash ops/db-ruoli.sh          # produzione/CI: password dall'ambiente del container
#   bash ops/db-ruoli.sh --dev      # sviluppo: container wasteflow-postgres, password di sviluppo
#
# PASSWORD: DB_APP_PASSWORD e DB_SISTEMA_PASSWORD vengono lette DENTRO il container
# (variabili d'ambiente del servizio postgres, o passate con `-e NOME` senza
# valore a `docker exec`), mai interpolate nella riga di comando di questo script:
# cosi' non compaiono nel log del job. Niente `set -x` qui. Se una delle due manca
# lo script stampa "ruoli DB non configurati: salto" ed esce con 0.
#
# Il container fornisce anche POSTGRES_USER, POSTGRES_DB e (in CI) PGPORT.
# ==============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${RUOLI_DB_SQL:-${DIR}/../apps/backend/prisma/sql/ruoli-db.sql}"

if [[ "${1:-}" == "--dev" ]]; then
  # Password di sviluppo: sono pubbliche per costruzione (valgono solo in locale).
  export DB_APP_PASSWORD="${DB_APP_PASSWORD:-wasteflow_app_dev}"
  export DB_SISTEMA_PASSWORD="${DB_SISTEMA_PASSWORD:-wasteflow_sistema_dev}"
  PG_EXEC="${PG_EXEC:-docker exec -i -e DB_APP_PASSWORD -e DB_SISTEMA_PASSWORD wasteflow-postgres}"
fi

[[ -n "${PG_EXEC:-}" ]] || { echo "ERRORE: PG_EXEC non impostato (oppure usare --dev)" >&2; exit 2; }
[[ -f "${SQL}" ]] || { echo "ERRORE: ${SQL} non trovato" >&2; exit 2; }

# Il corpo gira nel container: lo shell esterno NON espande le variabili (apici
# singoli), quindi le password restano fuori dalla riga di comando.
# shellcheck disable=SC2016
CORPO='
set -e
if [ -z "${DB_APP_PASSWORD:-}" ] || [ -z "${DB_SISTEMA_PASSWORD:-}" ]; then
  echo "ruoli DB non configurati: salto"
  cat >/dev/null
  exit 0
fi
# -o /dev/null: i SELECT set_config(...) dello script restituirebbero le password.
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -o /dev/null \
  -v app_password="$DB_APP_PASSWORD" -v sistema_password="$DB_SISTEMA_PASSWORD" -f -
echo "ruoli DB applicati (wasteflow_app, wasteflow_sistema)"
'

# shellcheck disable=SC2086 # word splitting voluto, come PG_EXEC in restore.sh
${PG_EXEC} sh -c "${CORPO}" < "${SQL}"
