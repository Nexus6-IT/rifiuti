#!/usr/bin/env bash
# PostgreSQL usa e getta per un job CI, su una porta host assegnata dal kernel.
#
# Perche' non `--network host -c port=NNNNN`: i runner Gitea girano con
# `container.network=host` e capacity 2 (x2 runner), quindi due run della CI
# possono stare insieme sullo stesso host. Con una porta fissa il secondo
# Postgres non riesce ad aprirla, il controllo /dev/tcp passa lo stesso (la
# porta e' aperta dal primo) e i test della seconda run girano sul database
# della prima. Qui il container sta sulla rete bridge e pubblica 5432 su una
# porta host scelta dal kernel (`-p 127.0.0.1::5432`). Stessa ricetta di
# redis-job.sh.
#
# Uso:
#   bash scripts/ci/postgres-job.sh avvia   -> esporta su $GITHUB_ENV:
#       PG_CI_PORT, DATABASE_URL, POSTGRES_CI_CONTAINER
#   bash scripts/ci/postgres-job.sh ferma   -> rimuove il container (if: always())
#
# Variabili opzionali (default = valori storici della CI):
#   PG_CI_QUERY     query string dell'URL        (default: schema=public)
#   PG_CI_USER / PG_CI_PASSWORD / PG_CI_DB       (default: wasteflow / wasteflow_ci / wasteflow_ci)
#
# PG_EXEC per gli script che usano `docker exec`: porta INTERNA 5432, quindi
#   PG_EXEC="docker exec -i $POSTGRES_CI_CONTAINER"   (niente PGPORT)
#
# Il label `neat.ci.job` permette alla pulizia del runner di rimuovere gli
# orfani piu' vecchi di 3 ore.
set -euo pipefail

SUFFISSO="${GITHUB_RUN_ID:-locale}-${GITHUB_JOB:-job}"
NOME="rifiuti-ci-pg-${SUFFISSO}"
UTENTE="${PG_CI_USER:-wasteflow}"
PASSWORD="${PG_CI_PASSWORD:-wasteflow_ci}"
DB="${PG_CI_DB:-wasteflow_ci}"
QUERY="${PG_CI_QUERY:-schema=public}"

case "${1:-}" in
  avvia)
    docker rm -f "$NOME" >/dev/null 2>&1 || true
    # POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256: le connessioni TCP
    # chiedono la password (il test "la vecchia password non entra piu'" di
    # ruoli-db.postgres.spec.ts non dimostrerebbe nulla con `trust`); il socket
    # locale (docker exec psql, db-ruoli.sh, test bash) resta `trust`.
    docker run -d --rm \
      --name "$NOME" \
      --label "neat.ci.job=${SUFFISSO}" \
      -p 127.0.0.1::5432 \
      -e POSTGRES_USER="$UTENTE" \
      -e POSTGRES_PASSWORD="$PASSWORD" \
      -e POSTGRES_DB="$DB" \
      -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256" \
      postgres:16-alpine \
      -c log_lock_waits=on -c deadlock_timeout=1s \
      -c log_min_duration_statement=3000 >/dev/null

    PORTA=$(docker port "$NOME" 5432/tcp | head -1 | sed 's/.*://')
    if [ -z "$PORTA" ]; then
      echo "::error::Impossibile leggere la porta host pubblicata da $NOME (docker port vuoto)."
      docker logs "$NOME" --tail 100 || true
      exit 1
    fi

    for i in $(seq 1 60); do
      if docker exec "$NOME" pg_isready -q -U "$UTENTE" -d "$DB" 2>/dev/null \
        && (exec 3<>/dev/tcp/127.0.0.1/"$PORTA") 2>/dev/null; then
        echo "PostgreSQL pronto su 127.0.0.1:$PORTA (container $NOME) dopo ${i} tentativi"
        {
          echo "PG_CI_PORT=$PORTA"
          echo "DATABASE_URL=postgresql://${UTENTE}:${PASSWORD}@127.0.0.1:${PORTA}/${DB}?${QUERY}"
          echo "POSTGRES_CI_CONTAINER=$NOME"
        } >> "$GITHUB_ENV"
        exit 0
      fi
      sleep 1
    done
    echo "::error::PostgreSQL del job non pronto su 127.0.0.1:$PORTA dopo 60s."
    docker logs "$NOME" --tail 100 || true
    exit 1
    ;;
  ferma)
    docker rm -f "$NOME" >/dev/null 2>&1 || true
    # Rete di sicurezza: qualunque container di questo job, anche con nome diverso.
    docker ps -aq --filter "label=neat.ci.job=${SUFFISSO}" \
      | xargs -r docker rm -f >/dev/null || true
    ;;
  *)
    echo "uso: $0 avvia|ferma" >&2
    exit 2
    ;;
esac
