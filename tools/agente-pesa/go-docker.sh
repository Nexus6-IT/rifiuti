#!/usr/bin/env bash
# Esegue il toolchain Go nel container fissato da GO_IMAGE (Go non e' installato sulla workstation).
# Uso: tools/agente-pesa/go-docker.sh test ./...   |   GOOS=windows ./go-docker.sh build -o dist/agente-pesa.exe ./cmd/agente-pesa
set -euo pipefail
cd "$(dirname "$0")"
exec docker run --rm --security-opt label=disable -u "$(id -u):$(id -g)" \
  -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOMODCACHE=/tmp/gomod -e CGO_ENABLED=0 \
  -e GOOS="${GOOS:-}" -e GOARCH="${GOARCH:-}" \
  -v "$PWD":/src -w /src "$(cat GO_IMAGE)" go "$@"
