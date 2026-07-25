#!/usr/bin/env bash
# Scarica gli OpenAPI ufficiali RENTRI e ne registra la provenienza.
# I documenti sono YAML anche se serviti con estensione .json.
set -euo pipefail

BASE="https://demoapi.rentri.gov.it/docs"
DEST="$(cd "$(dirname "$0")/../../../docs/contracts/rentri" && pwd)"
API_DISPONIBILI=("formulari" "anagrafiche" "codifiche")

mkdir -p "$DEST"
: > "$DEST/MANIFEST.md"
{
  echo "# Contratti ufficiali RENTRI"
  echo
  echo "Scaricati da \`$BASE\`. NON modificare a mano: rieseguire lo script."
  echo
  echo "| API | URL | Versione | SHA-256 | Scaricato il |"
  echo "|-----|-----|----------|---------|--------------|"
} >> "$DEST/MANIFEST.md"

for api in "${API_DISPONIBILI[@]}"; do
  url="$BASE/$api/v1.0/openapi.json"
  echo "Scarico $api da $url"
  curl -sfS --max-time 60 "$url" -o "$DEST/$api.yaml"
  versione="$(grep -m1 '^  version:' "$DEST/$api.yaml" | sed 's/^  version: *//')"
  digest="$(sha256sum "$DEST/$api.yaml" | cut -d' ' -f1)"
  echo "| $api | $url | $versione | \`$digest\` | $(date -u +%Y-%m-%d) |" >> "$DEST/MANIFEST.md"
done

echo
echo "Contratti scaricati in $DEST"
