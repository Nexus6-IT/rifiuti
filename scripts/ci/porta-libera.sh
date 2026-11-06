#!/usr/bin/env bash
# Sceglie porte TCP libere sull'host e le esporta su $GITHUB_ENV.
#
# Perche': i runner Gitea usano `container.network=host`, quindi backend e
# frontend di due run in parallelo si contenderebbero le stesse porte fisse
# (3000, 80). Le porte vengono chieste al kernel (bind su 0) tutte insieme,
# cosi' sono distinte fra loro; resta una finestra minima fra la chiusura del
# socket e l'avvio del servizio (stessa di qualunque "porta libera").
#
# Uso: bash scripts/ci/porta-libera.sh NOME_VAR [NOME_VAR...]
#   es. bash scripts/ci/porta-libera.sh E2E_BACKEND_PORT E2E_FRONTEND_PORT
set -euo pipefail

[ "$#" -ge 1 ] || { echo "uso: $0 NOME_VAR [NOME_VAR...]" >&2; exit 2; }

if command -v python3 >/dev/null 2>&1; then
  PORTE=$(python3 - "$#" <<'PY'
import socket, sys
n = int(sys.argv[1])
socks = [socket.socket() for _ in range(n)]
for s in socks:
    s.bind(("127.0.0.1", 0))
print(" ".join(str(s.getsockname()[1]) for s in socks))
PY
)
else
  PORTE=$(node -e '
const net = require("net");
const n = +process.argv[1], srv = [], porte = [];
(function next(){
  if (srv.length === n) { console.log(porte.join(" ")); srv.forEach(s => s.close()); return; }
  const s = net.createServer(); srv.push(s);
  s.listen(0, "127.0.0.1", () => { porte.push(s.address().port); next(); });
})();' "$#")
fi

set -- "$@"
read -r -a ARR <<< "$PORTE"
i=0
for nome in "$@"; do
  echo "$nome=${ARR[$i]}"
  [ -z "${GITHUB_ENV:-}" ] || echo "$nome=${ARR[$i]}" >> "$GITHUB_ENV"
  i=$((i + 1))
done
