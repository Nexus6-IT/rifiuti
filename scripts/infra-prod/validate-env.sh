#!/usr/bin/env bash
# ==============================================================================
# scripts/infra-prod/validate-env.sh — controllo del .env di produzione (infra-prod)
# ------------------------------------------------------------------------------
# Uso: bash validate-env.sh [--primo-avvio] <file .env.prod>
# Contratto del ruolo app_layout di infra-prod: gira come utente di deploy, in sola lettura,
# esce 0 se il file e' valido e 1 altrimenti. Il file NON viene eseguito (niente source) e
# i valori non vengono mai stampati: si elencano solo i NOMI delle variabili in difetto.
# --primo-avvio: accettato per contratto; TAG non e' richiesto (lo scrive il primo deploy).
# ==============================================================================
set -uo pipefail

PRIMO_AVVIO=0
[ "${1:-}" = "--primo-avvio" ] && { PRIMO_AVVIO=1; shift; }
FILE="${1:-}"
[ -n "$FILE" ] && [ -r "$FILE" ] || { echo "uso: validate-env.sh [--primo-avvio] <file .env.prod>" >&2; exit 2; }

valore() {
  local riga v
  riga=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$FILE" | tail -n 1) || riga=""
  v="${riga#*=}"; v="${v%$'\r'}"
  case "$v" in \"*\") v="${v:1:${#v}-2}" ;; \'*\') v="${v:1:${#v}-2}" ;; esac
  printf '%s' "$v"
}

ERRORI=()
err() { ERRORI+=("$1"); }

# Permessi: contiene segreti.
modo=$(stat -c '%a' "$FILE" 2>/dev/null || echo "")
case "$modo" in 600|400) ;; *) err "permessi del file $modo (attesi 600)" ;; esac

# Obbligatorie (stesse del compose: ${VAR:?...}) e non segnaposto.
OBBLIGATORIE=(DB_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET RENTRI_CREDENTIAL_ENC_KEY
  SIGNATURE_PROVIDER TSA_PROVIDER PERMISSION_CACHE_HMAC_SECRET ALLOWED_ORIGINS FRONTEND_URL PUBLIC_URL
  KEYCLOAK_URL KEYCLOAK_REALM SPID_IDP_ENTRY_POINT SPID_CALLBACK_URL METRICS_TOKEN)
# Obbligatorie per il funzionamento (nel compose senza `:?`): vuote = login SAML o mail rotti.
FUNZIONALI=(KEYCLOAK_CLIENT_SECRET SPID_IDP_CERT DEFAULT_TENANT_ID SMTP_USER SMTP_PASSWORD EMAIL_FROM ACCESS_REQUEST_NOTIFY_EMAIL)
for n in "${OBBLIGATORIE[@]}" "${FUNZIONALI[@]}"; do
  v=$(valore "$n")
  [ -n "$v" ] || { err "$n mancante o vuota"; continue; }
  case "$v" in *CAMBIA*|*changeme*|*CHANGE_ME*|*"<dominio"*|*"<DOMINIO"*|*xxxxxxxx*) err "$n e' ancora un segnaposto" ;; esac
done

# Segreti: almeno 32 caratteri, diversi fra loro.
# Anche con almeno 8 caratteri distinti (niente 32 volte la stessa lettera).
SEGRETI_32=(JWT_SECRET JWT_REFRESH_SECRET PERMISSION_CACHE_HMAC_SECRET RENTRI_CREDENTIAL_ENC_KEY METRICS_TOKEN)
for n in "${SEGRETI_32[@]}"; do
  v=$(valore "$n"); [ -z "$v" ] && continue
  [ "${#v}" -ge 32 ] || err "$n troppo corta (minimo 32 caratteri: openssl rand -hex 32)"
  distinti=$(printf '%s' "$v" | fold -w1 | sort -u | wc -l)
  [ "$distinti" -ge 8 ] || err "$n troppo regolare (meno di 8 caratteri distinti)"
done
v=$(valore KEYCLOAK_CLIENT_SECRET); [ -z "$v" ] || [ "${#v}" -ge 16 ] || err "KEYCLOAK_CLIENT_SECRET troppo corto (minimo 16 caratteri)"
# Nessun segreto riusato per due scopi (un valore trapelato non deve aprire altro).
DISTINTI=("${SEGRETI_32[@]}" KEYCLOAK_CLIENT_SECRET DB_PASSWORD REDIS_PASSWORD DB_APP_PASSWORD DB_SISTEMA_PASSWORD MONITORING_PG_PASSWORD)
for i in "${!DISTINTI[@]}"; do
  vi=$(valore "${DISTINTI[$i]}"); [ -n "$vi" ] || continue
  for j in "${!DISTINTI[@]}"; do
    [ "$j" -gt "$i" ] || continue
    [ "$vi" != "$(valore "${DISTINTI[$j]}")" ] || err "${DISTINTI[$i]} e ${DISTINTI[$j]} hanno lo stesso valore"
  done
done

# Nome e utente del database: gli exporter di infra-prod leggono DATABASE_*, il compose DB_*.
[ "$(valore DB_NAME)" = "$(valore DATABASE_NAME)" ] || [ -z "$(valore DB_NAME)$(valore DATABASE_NAME)" ] || err "DB_NAME e DATABASE_NAME devono coincidere (exporter)"
[ "$(valore DB_USER)" = "$(valore DATABASE_USER)" ] || [ -z "$(valore DB_USER)$(valore DATABASE_USER)" ] || err "DB_USER e DATABASE_USER devono coincidere (exporter)"

# Password nei URL di Postgres: solo A-Za-z0-9 _ . - (db-ruoli.sh e DATABASE_URL), minimo 16.
for n in DB_PASSWORD REDIS_PASSWORD DB_APP_PASSWORD DB_SISTEMA_PASSWORD; do
  v=$(valore "$n"); [ -z "$v" ] && continue
  [[ "$v" =~ ^[A-Za-z0-9_.-]{16,}$ ]] || err "$n: ammessi solo A-Za-z0-9 _ . - e almeno 16 caratteri"
done

# Ruoli DB: tutti e tre o nessuno (il compose lo impone, qui si dice prima).
n_ruoli=0
for n in DB_APP_USER DB_APP_PASSWORD DB_SISTEMA_PASSWORD; do [ -n "$(valore "$n")" ] && n_ruoli=$((n_ruoli + 1)); done
[ "$n_ruoli" -eq 0 ] || [ "$n_ruoli" -eq 3 ] || err "ruoli DB a meta': DB_APP_USER, DB_APP_PASSWORD e DB_SISTEMA_PASSWORD vanno impostate tutte o nessuna"
[ -z "$(valore DB_APP_USER)" ] || [ "$(valore DB_APP_USER)" = "wasteflow_app" ] || err "DB_APP_USER deve valere wasteflow_app"

# Valori ammessi e forma degli URL.
case "$(valore SIGNATURE_PROVIDER)" in sandbox|qes|"") ;; *) err "SIGNATURE_PROVIDER: ammessi sandbox|qes" ;; esac
case "$(valore TSA_PROVIDER)" in mock|rfc3161|"") ;; *) err "TSA_PROVIDER: ammessi mock|rfc3161" ;; esac
for n in FRONTEND_URL PUBLIC_URL KEYCLOAK_URL SPID_IDP_ENTRY_POINT SPID_CALLBACK_URL; do
  v=$(valore "$n"); [ -z "$v" ] || [[ "$v" =~ ^https:// ]] || err "$n deve cominciare con https://"
done
v=$(valore KEYCLOAK_REALM); [ -z "$v" ] || [ "$v" != "ignicraft" ] || err "KEYCLOAK_REALM: sul server nuovo il realm e' rifiuti, non ignicraft"
# Il Keycloak di sviluppo (auth.ignicraft.com) e il suo realm non devono comparire in nessun URL di
# produzione: con un SPID_IDP_CERT vecchio si accetterebbero asserzioni SAML di un altro IdP.
for n in KEYCLOAK_URL SPID_IDP_ENTRY_POINT ALLOWED_ORIGINS FRONTEND_URL PUBLIC_URL SPID_CALLBACK_URL; do
  v=$(valore "$n")
  case "$v" in *auth.ignicraft.com*|*/realms/ignicraft*) err "$n punta al Keycloak di sviluppo (auth.ignicraft.com / realm ignicraft)" ;; esac
done
kc=$(valore KEYCLOAK_URL); kc="${kc%/}"; realm=$(valore KEYCLOAK_REALM)
v=$(valore SPID_IDP_ENTRY_POINT)
[ -z "$v" ] || [ -z "$kc" ] || [ -z "$realm" ] || [[ "$v" == "$kc/realms/$realm/"* ]] || err "SPID_IDP_ENTRY_POINT deve cominciare con KEYCLOAK_URL/realms/KEYCLOAK_REALM/"
# CORS: solo origini https esplicite, mai '*', e comprendono l'app e il Keycloak.
ao=$(valore ALLOWED_ORIGINS)
if [ -n "$ao" ]; then
  IFS=',' read -ra ORIGINI <<< "$ao"
  for o in "${ORIGINI[@]}"; do
    o="${o// /}"
    [[ "$o" =~ ^https://[^/*]+$ ]] || err "ALLOWED_ORIGINS: '$o' non e' un'origine https esplicita (niente '*', niente percorsi)"
  done
  for n in FRONTEND_URL KEYCLOAK_URL; do
    v=$(valore "$n"); v="${v%/}"
    [ -z "$v" ] || [[ ",${ao// /}," == *",$v,"* ]] || err "ALLOWED_ORIGINS non comprende $n"
  done
fi
[ "$(valore SMTP_PORT)" = "" ] || [ "$(valore SMTP_PORT)" = "465" ] || err "SMTP_PORT diversa da 465: il codice attiva TLS solo con 465 e la 587 e' spesso bloccata"

# TAG: sha reale, mai latest (lo scrive deploy.sh; al primo avvio puo' mancare).
tag=$(valore TAG)
if [ -n "$tag" ]; then
  [[ "$tag" =~ ^sha-[0-9a-f]{7,}$ ]] || err "TAG deve essere sha-<7+ esadecimali>, mai latest"
  [[ ! "$tag" =~ ^sha-0+$ ]] || [ "$PRIMO_AVVIO" -eq 1 ] || err "TAG segnaposto (sha-000...): il deploy deve scrivere uno sha reale"
elif [ "$PRIMO_AVVIO" -eq 0 ]; then
  err "TAG mancante (lo scrive il deploy; con --primo-avvio e' ammesso)"
fi

if [ "${#ERRORI[@]}" -gt 0 ]; then
  echo "validate-env: $FILE NON valido (${#ERRORI[@]} problemi):" >&2
  printf ' - %s\n' "${ERRORI[@]}" >&2
  exit 1
fi
echo "validate-env: $FILE valido"
