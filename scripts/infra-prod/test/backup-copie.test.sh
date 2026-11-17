#!/usr/bin/env bash
# Le copie sotto scripts/backup/ (le sole che infra-prod porta ai job di root) devono restare
# identiche agli originali in ops/ (in esercizio sul VPS attuale). Se ops/ cambia, aggiornare la copia.
set -u
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fail=0
for coppia in "ops/backup-offsite.sh scripts/backup/backup-offsite.sh" "ops/lib/backup-verifica.sh scripts/backup/lib/backup-verifica.sh"; do
  set -- $coppia
  if cmp -s "$R/$1" "$R/$2"; then echo "ok: $2 identico a $1"; else echo "FALLITO: $2 diverge da $1"; fail=1; fi
done
# Nulla di cio' che i job di root eseguono deve puntare a ops/.
if grep -n '\$CODE_DIR/ops/\|\.\./ops/' "$R"/scripts/backup/backup-database.sh "$R"/scripts/backup/backup-secrets.sh "$R"/scripts/backup/sync-offsite.sh; then
  echo "FALLITO: script di backup che dipendono da ops/"; fail=1
else echo "ok: nessun riferimento a ops/ negli script di backup"; fi
exit $fail
