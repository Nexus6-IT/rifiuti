# agente-pesa

Agente locale di pesa di WasteFlow: legge lo strumento di pesa, firma ogni lettura stabile con
Ed25519 e la invia al backend, anche a intermittenza (coda su file). Eseguibile unico per Windows,
nessuna dipendenza da installare. Piano:
`docs/superpowers/plans/2026-11-13-fase4-8b-agente-pesa.md`.

Requisiti: Windows 10 o Windows Server 2016 (o successivi), a 64 bit. In 4.8b esiste solo il driver
`SIMULATA` (collaudo e dimostrazioni): l'interfaccia dei driver e' pronta per seriale e TCP, ma
nessun driver reale e' ancora scritto.

## Verifica dell'eseguibile

L'eseguibile non e' firmato con Authenticode (decisione per il pilota). Prima di installarlo si
confronta l'impronta SHA-256 con quella pubblicata nella pagina Agenti di WasteFlow e nel file
`agente-pesa.exe.sha256` della release:

```powershell
Get-FileHash .\agente-pesa.exe -Algorithm SHA256
```

Windows SmartScreen puo' avvisare di un editore sconosciuto: e' atteso.

## Installazione (PowerShell come amministratore)

1. Copiare `agente-pesa.exe` in `C:\Program Files\WasteFlow\AgentePesa\`.
2. In WasteFlow, pagina Agenti, creare un agente e copiare il codice di abbinamento
   (`XXXX-XXXX-XXXX`, vale 15 minuti):
   ```powershell
   .\agente-pesa.exe abbina --server https://<backend> --codice XXXX-XXXX-XXXX
   ```
   Crea `C:\ProgramData\WasteFlow\AgentePesa` con la chiave privata e il token (cifrati con DPAPI della
   macchina) e il file `agente-pesa.json`. La chiave privata non lascia mai il PC.
3. Aprire `agente-pesa.json` e, per ogni strumento, indicare `driver` e `parametri`. Esempio di collaudo:
   ```json
   { "server": "https://<backend>", "simulazione": true,
     "strumenti": [{ "strumentoId": "<uuid>", "driver": "SIMULATA",
                     "parametri": { "pesi": [24880, 12540], "intervalloS": 30 } }],
     "log": { "livello": "info", "maxMB": 10, "file": 5 } }
   ```
   `SIMULATA` funziona solo con `"simulazione": true` **e** con il permesso di simulazione dato
   dall'amministratore alla singola azienda; altrimenti l'agente non avvia il driver e lo dice in `stato`.
4. Installare e avviare il servizio:
   ```powershell
   .\agente-pesa.exe servizio installa
   .\agente-pesa.exe servizio avvia
   ```
   Il servizio `WasteFlowAgentePesa` parte in automatico (ritardato), gira con l'account virtuale
   `NT SERVICE\WasteFlowAgentePesa` (privilegi minimi; `servizio installa` limita la cartella dati
   ad amministratori, SYSTEM e a quell'account) e si riavvia dopo un errore (10 s, 60 s, 5 min).

Comandi: `abbina`, `esegui` (in primo piano, per le prove), `stato`, `servizio installa|rimuovi|avvia|ferma`,
`versione`. Tutti accettano `--dati <cartella>` (predefinita `C:\ProgramData\WasteFlow\AgentePesa`).

## Risoluzione dei problemi

- `agente-pesa.exe stato`: ultimo battito, coda (in attesa, inviate, scartate), strumenti e ultimo errore.
- Log: `C:\ProgramData\WasteFlow\AgentePesa\log\agente-pesa.log` (JSON, ruotato a `maxMB` x `file`; i token
  sono sostituiti da `[token]`).
- Senza rete le letture restano in `in-attesa\` e partono da sole, in ordine, al ritorno della
  connessione (fino a 100.000; oltre, le nuove letture sono scartate e il log lo dice).
- Letture rifiutate dal server: in `scartate\`, con il motivo in `<nome>.motivo.txt`.
- «agente revocato»: l'agente e' stato revocato in WasteFlow; l'invio e' fermo (controllo ogni 10 minuti) e
  la coda e' conservata. Serve un agente nuovo (cancellare la cartella dati e rifare `abbina`).
- `http://` e' accettato solo verso `localhost`; per il resto serve `https://` con certificato valido.

## Sviluppo

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

Per un driver nuovo: implementare `driver.Driver` (o fornire solo un `driver.Protocollo` a
`driver.NuovaDomandaRisposta`, vedi `internal/driver/esempio_test.go`) e registrarlo con
`driver.Registra` nell'`init()`.
