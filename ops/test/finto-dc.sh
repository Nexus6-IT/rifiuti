#!/usr/bin/env bash
# ==============================================================================
# ops/test/finto-dc.sh — compose finto per i test di restore.sh
# ==============================================================================
# Si passa a restore.sh come WASTEFLOW_DC="bash .../finto-dc.sh". Non chiama docker:
# appende a $FINTO_DC_LOG una riga "TAG=<tag> <argomenti>" ed esce 0, salvo che gli
# argomenti contengano "run" e FINTO_DC_RUN_FALLISCE=1 (simula un migrate fallito).
# Con "ps" stampa $FINTO_DC_PS_IMMAGINE (l'immagine del container), se impostata.
# ==============================================================================
printf 'TAG=%s %s\n' "${TAG:-}" "$*" >> "${FINTO_DC_LOG:?FINTO_DC_LOG non impostata}"
case " $* " in
  *" run "*)
    if [ "${FINTO_DC_RUN_FALLISCE:-0}" = "1" ]; then
      exit 1
    fi
    ;;
  *" ps "*)
    if [ -n "${FINTO_DC_PS_IMMAGINE:-}" ]; then
      printf '%s\n' "${FINTO_DC_PS_IMMAGINE}"
    fi
    ;;
esac
exit 0
