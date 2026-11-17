#!/usr/bin/env bash
# Test di deploy.sh con `docker`, `curl` e gli script collaterali finti: nessun host reale.
# Casi: deploy riuscito; fallimento di `up` con ripristino del tag precedente e log;
# fallimento al primo deploy (nessun tag da ripristinare); smoke test fallito.
set -u
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
T="$(mktemp -d "${TMPDIR:-$HOME/.cache/claude-tmp}/deploy-test.XXXXXX")"; trap 'rm -rf "$T"' EXIT
fail=0
ok()  { echo "ok: $1"; }
ko()  { echo "FALLITO: $1"; fail=1; }

# Albero di codice finto: solo deploy.sh e' vero, il resto e' stub.
C="$T/code"; mkdir -p "$C/scripts/infra-prod" "$C/scripts/backup" "$C/ops" "$T/bin"
cp "$R/scripts/infra-prod/deploy.sh" "$C/scripts/infra-prod/deploy.sh"
printf '#!/bin/bash\nexit 0\n' > "$C/scripts/infra-prod/validate-env.sh"
printf '#!/bin/bash\necho backup >> "$STACK_DIR/chiamate"\n' > "$C/scripts/backup/backup-offsite.sh"
printf '#!/bin/bash\nexit 0\n' > "$C/ops/db-ruoli.sh"
: > "$C/docker-compose.infra-prod.yml"
# docker finto: registra TAG e argomenti; `up -d --remove-orphans` fallisce se FALLISCI_TAG coincide col TAG del .env.
cat > "$T/bin/docker" <<'D'
#!/bin/bash
envf=""; prev=""
for a in "$@"; do [ "$prev" = "--env-file" ] && envf="$a"; prev="$a"; done
tag="$(grep -E '^TAG=' "$envf" | tail -n1 | cut -d= -f2-)"
echo "docker[$tag] $*" >> "$STACK_DIR/chiamate"
case " $* " in
  *" up -d --remove-orphans "*) [ "$tag" = "${FALLISCI_TAG:-}" ] && { echo "backend unhealthy" >&2; exit 1; } ;;
  *" logs "*) echo "log-del-backend" ;;
esac
exit 0
D
cat > "$T/bin/curl" <<'D'
#!/bin/bash
[ "${SMOKE_KO:-0}" = "1" ] && exit 22
exit 0
D
chmod +x "$T/bin/docker" "$T/bin/curl"

nuovo_stack() { S="$T/stack-$1"; mkdir -p "$S"; : > "$S/chiamate"; E="$S/.env.prod"
  [ -n "${2:-}" ] && echo "TAG=$2" > "$E" || : > "$E"; echo "X=1" >> "$E"; chmod 600 "$E"; }
lancia() { PATH="$T/bin:$PATH" STACK_DIR="$S" SMOKE_TENTATIVI=2 SMOKE_PAUSA=0 \
  bash "$C/scripts/infra-prod/deploy.sh" "$1" >"$S/out" 2>&1; }
tagenv() { grep -E '^TAG=' "$E" | cut -d= -f2-; }

# 1) riuscito
nuovo_stack 1 sha-aaaaaaa
lancia sha-bbbbbbb; rc=$?
[ $rc -eq 0 ] && [ "$(tagenv)" = "sha-bbbbbbb" ] && ok "deploy riuscito scrive il nuovo tag" || ko "deploy riuscito (rc=$rc, tag=$(tagenv))"
[ "$(stat -c %a "$E")" = "600" ] && ok "permessi 600 conservati" || ko "permessi del .env"

# 2) up fallisce: ripristino + diagnostica + log
nuovo_stack 2 sha-aaaaaaa
FALLISCI_TAG=sha-ccccccc lancia sha-ccccccc; rc=$?
[ $rc -ne 0 ] && ok "fallimento propagato (rc=$rc)" || ko "il deploy fallito esce 0"
[ "$(tagenv)" = "sha-aaaaaaa" ] && ok "TAG precedente rimesso nel .env" || ko "TAG dopo fallimento: $(tagenv)"
grep -q 'docker\[sha-aaaaaaa\] .* up -d --remove-orphans' "$S/chiamate" && ok "up rieseguito col tag precedente" || ko "nessun up col tag precedente"
grep -q ' ps' "$S/chiamate" && grep -q ' logs ' "$S/chiamate" && ok "ps e logs eseguiti" || ko "diagnostica mancante"
grep -q 'ripristino riuscito' "$S/deploy.log" && grep -q 'FALLITO' "$S/deploy.log" && ok "log persistente scritto" || ko "log persistente"
grep -q 'log-del-backend' "$S/deploy.log" && ok "log del backend nel log persistente" || ko "log del backend assente"

# 3) smoke test fallito (up ok, curl ko): ripristino
nuovo_stack 3 sha-aaaaaaa
SMOKE_KO=1 lancia sha-ddddddd; rc=$?
[ $rc -ne 0 ] && [ "$(tagenv)" = "sha-aaaaaaa" ] && ok "smoke test fallito: ripristino" || ko "smoke test fallito (rc=$rc, tag=$(tagenv))"

# 4) primo deploy fallito: niente tag da ripristinare, ma diagnostica e log
nuovo_stack 4 ""
FALLISCI_TAG=sha-eeeeeee lancia sha-eeeeeee; rc=$?
[ $rc -ne 0 ] && grep -q 'nessun tag precedente' "$S/deploy.log" && ok "primo deploy fallito: loggato, nessun ripristino" || ko "primo deploy fallito (rc=$rc)"

# 5) tag non valido: nessuna modifica
nuovo_stack 5 sha-aaaaaaa
lancia latest; rc=$?
[ $rc -eq 2 ] && [ "$(tagenv)" = "sha-aaaaaaa" ] && ok "tag latest rifiutato" || ko "tag latest (rc=$rc)"
exit $fail
