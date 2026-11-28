#!/usr/bin/env bash
# Provider SDI finto (tools/sdi-fake) per un job CI: un solo processo Node, nessuna dipendenza npm,
# nessun container (pochi MB di RAM: il runner ha capacity 1 e poca memoria). Porta scelta dal
# kernel (scripts/ci/porta-libera.sh), come gli altri servizi di collaudo.
#
# Uso:
#   bash scripts/ci/sdi-fake-job.sh avvia   -> esporta SDI_FAKE_URL su $GITHUB_ENV
#   bash scripts/ci/sdi-fake-job.sh ferma   -> termina il processo (if: always())
set -euo pipefail

SUFFISSO="${GITHUB_RUN_ID:-locale}-${GITHUB_JOB:-job}"
PID_FILE="/tmp/sdi-fake-${SUFFISSO}.pid"
LOG_FILE="/tmp/sdi-fake-${SUFFISSO}.log"
RADICE="$(cd "$(dirname "$0")/../.." && pwd)"

case "${1:-}" in
  avvia)
    GITHUB_ENV="${GITHUB_ENV:-/dev/null}" bash "$RADICE/scripts/ci/porta-libera.sh" SDI_FAKE_PORT
    PORTA=$(grep -E '^SDI_FAKE_PORT=' "$GITHUB_ENV" | tail -1 | cut -d= -f2)
    PORT="$PORTA" nohup node "$RADICE/tools/sdi-fake/src/server.js" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    for i in $(seq 1 20); do
      if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORTA}/__salute" || true)" = "200" ]; then
        echo "sdi-fake pronto su 127.0.0.1:${PORTA} dopo ${i}s"
        echo "SDI_FAKE_URL=http://127.0.0.1:${PORTA}" >> "$GITHUB_ENV"
        exit 0
      fi
      sleep 1
    done
    echo "::error::sdi-fake non raggiungibile su 127.0.0.1:${PORTA} dopo 20s."
    cat "$LOG_FILE" || true
    exit 1
    ;;
  ferma)
    if [ -f "$PID_FILE" ]; then kill "$(cat "$PID_FILE")" 2>/dev/null || true; fi
    ;;
  *)
    echo "uso: $0 avvia|ferma" >&2
    exit 2
    ;;
esac
