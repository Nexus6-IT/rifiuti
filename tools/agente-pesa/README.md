# agente-pesa

Agente locale di pesa di WasteFlow (Go, eseguibile unico per Windows). Piano:
`docs/superpowers/plans/2026-11-13-fase4-8b-agente-pesa.md`.

Go non serve sulla workstation: tutti i comandi passano dal container fissato in `GO_IMAGE`.

```bash
cd tools/agente-pesa
./go-docker.sh test ./...                                   # test
./go-docker.sh vet ./...                                    # vet (anche con GOOS=windows)
GOOS=windows GOARCH=amd64 ./go-docker.sh build -trimpath -ldflags "-s -w -X main.versione=dev" \
  -o dist/agente-pesa.exe ./cmd/agente-pesa                 # build Windows
```

Il file `testdata/contratto/lettura-v1.json` e' il contratto di firma con il backend: si rigenera con
`./go-docker.sh test ./internal/lettura -run TestContratto -update` ed e' verificato anche da
`payload-lettura.spec.ts`.
