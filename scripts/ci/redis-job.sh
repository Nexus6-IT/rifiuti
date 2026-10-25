#!/usr/bin/env bash
# Redis usa e getta per un job CI, su una porta host assegnata dal kernel.
#
# Perche' non `services:` ne' la 6379 fissa: i runner Gitea girano con
# `container.network=host` e con la rete host Docker IGNORA il port mapping.
# Un service ascolta quindi sempre sulla 6379, e due job in parallelo (2 runner
# x capacita' 2, anche di progetti diversi) si contendono la stessa porta.
# Stessa ricetta di ignicraft (scripts/ci/postgres-job.sh).
#
# Uso:
#   bash scripts/ci/redis-job.sh avvia   -> esporta REDIS_CI_PORT su $GITHUB_ENV
#   bash scripts/ci/redis-job.sh ferma   -> rimuove il container (if: always())
#
# Il label `neat.ci.job` permette alla pulizia del runner di rimuovere gli
# orfani piu' vecchi di 3 ore.
set -euo pipefail

SUFFISSO="${GITHUB_RUN_ID:-locale}-${GITHUB_JOB:-job}"
NOME="rifiuti-ci-redis-${SUFFISSO}"

case "${1:-}" in
  avvia)
    docker rm -f "$NOME" >/dev/null 2>&1 || true
    docker run -d --name "$NOME" \
      --label "neat.ci.job=${SUFFISSO}" \
      -p 127.0.0.1::6379 \
      redis:7-alpine >/dev/null

    PORTA=$(docker port "$NOME" 6379/tcp | head -1 | sed 's/.*://')
    if [ -z "$PORTA" ]; then
      echo "::error::Impossibile leggere la porta host pubblicata da $NOME (docker port vuoto)."
      docker logs "$NOME" --tail 100 || true
      exit 1
    fi

    for i in $(seq 1 30); do
      if [ "$(docker exec "$NOME" redis-cli ping 2>/dev/null || true)" = "PONG" ] \
        && (exec 3<>/dev/tcp/127.0.0.1/"$PORTA") 2>/dev/null; then
        echo "Redis pronto su 127.0.0.1:$PORTA dopo ${i}s"
        echo "REDIS_CI_PORT=$PORTA" >> "$GITHUB_ENV"
        exit 0
      fi
      sleep 1
    done
    echo "::error::Redis del job non raggiungibile su 127.0.0.1:$PORTA dopo 30s."
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
