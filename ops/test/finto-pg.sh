#!/usr/bin/env bash
# PG_EXEC finto per i test di db-ruoli.sh: ignora gli argomenti e salva lo stdin
# (le righe \set e il file SQL) in $FINTO_PG_OUT.
cat > "${FINTO_PG_OUT:?FINTO_PG_OUT non impostata}"
