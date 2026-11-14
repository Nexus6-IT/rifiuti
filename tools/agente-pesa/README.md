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
   .\agente-pesa.exe abbina --server https://<backend>/api/v1 --codice XXXX-XXXX-XXXX
   ```
   Per non lasciare il codice nella cronologia di PowerShell si puo' passare `--codice -` (lo legge da
   stdin) o impostare la variabile `WASTEFLOW_CODICE`.
   Crea `C:\ProgramData\WasteFlow\AgentePesa` con la chiave privata e il token (cifrati con DPAPI della
   macchina) e il file `agente-pesa.json`. La chiave privata non lascia mai il PC. La cartella viene
   riservata ad amministratori e SYSTEM (senza ereditare i permessi di `ProgramData`) **prima** di
   scrivere le credenziali, quindi non c'e' una finestra in cui siano leggibili da altri utenti.
   Limite noto: DPAPI e' a livello di macchina (serve al servizio, che gira con un altro account),
   quindi la protezione delle credenziali e' l'ACL della cartella, non la cifratura: chi e'
   amministratore del PC le puo' leggere. Se `abbina` non riesce a salvare le credenziali dopo che il
   server ha consumato il codice, l'agente risulta ATTIVO senza credenziali: va revocato in WasteFlow
   e ricreato.
   L'indirizzo `server` comprende **sempre** il prefisso `/api/v1` (`https://rifiuti.ignicraft.com/api/v1`):
   senza, ogni chiamata dell'agente risponde 404. Il comando completo, con l'indirizzo giusto, e' quello
   che la pagina Agenti di WasteFlow mostra insieme al codice.
3. Aprire `agente-pesa.json` e, per ogni strumento, indicare `driver` e `parametri`. Esempio di collaudo:
   ```json
   { "server": "https://<backend>/api/v1", "simulazione": true,
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
   ad amministratori, SYSTEM e a quell'account) e si riavvia dopo un errore (10 s, 60 s, 5 min), anche
   quando esce con un errore (configurazione non valida, coda bloccata dall'antivirus). Se un passo
   dell'installazione fallisce il servizio viene rimosso.
   Dopo l'installazione `agente-pesa.exe stato` si legge solo da un terminale da amministratore: la
   cartella dati non e' piu' leggibile dagli utenti normali.

Comandi: `abbina`, `esegui` (in primo piano, per le prove), `stato`, `servizio installa|rimuovi|avvia|ferma`,
`versione`. Un solo agente alla volta per cartella dati: un `esegui` lanciato a mano mentre il servizio
e' attivo (o un secondo `esegui`) si ferma con «agente gia' in esecuzione». Tutti accettano `--dati <cartella>` (predefinita `C:\ProgramData\WasteFlow\AgentePesa`).

## Risoluzione dei problemi

- `agente-pesa.exe stato`: ultimo battito, coda (in attesa, inviate, scartate), strumenti e ultimo errore.
- Log: `C:\ProgramData\WasteFlow\AgentePesa\log\agente-pesa.log` (JSON, ruotato a `maxMB` x `file`; i token
  sono sostituiti da `[token]`).
- Senza rete le letture restano in `in-attesa\` e partono da sole, in ordine, al ritorno della
  connessione (fino a 100.000; oltre, le nuove letture sono scartate e il log lo dice).
- Letture rifiutate dal server: in `scartate\`, con il motivo in `<nome>.motivo.txt`. Un rifiuto per un
  motivo che il tempo puo' risolvere NON scarta la lettura: resta in `in-attesa\` e si riprova dopo 10
  minuti, poi 20, 40 e ogni ora (senza bloccare le letture successive); dopo 7 giorni passa in
  `scartate\` col motivo. I codici transitori sono `OROLOGIO_AVANTI` (orologio del PC avanti: correggerlo
  basta, le letture gia' in coda diventano valide), `STRUMENTO_NON_ASSEGNATO`, `STRUMENTO_NON_ATTIVO` (assegnare
  o riattivare lo strumento in WasteFlow) e `FUORI_PORTATA` (correggere la portata). Ogni altro codice, anche
  sconosciuto, e' definitivo (firma, agente, peso, simulazione, driver non ammesso (`DRIVER_NON_AMMESSO`: il backend accetta solo i driver dell'elenco `DRIVER_AMMESSI`, oggi `SIMULATA`), chiave o alibi gia' usati, payload non valido).
- Contatore delle sequenze perso (file `sequenza` cancellato e cartelle vuote): all'avvio l'agente parte da
  `max(locale, ultimaSequenza del server)`; se il server risponde `SEQUENZA_GIA_USATA` (con `ultimaSequenza`)
  l'agente riallinea il contatore e ri-numera la lettura con una nuova sequenza e una nuova chiave,
  ri-firmandola: non si perde nulla. L'originale va in `scartate\` col motivo «ri-numerata». Il server non
  accetta mai due volte la stessa lettura: una ritrasmissione identica e' `GIA_RICEVUTA`. Se la
  ri-numerazione fallisce la lettura resta in coda e si riprova come un rifiuto transitorio.
- Se il server rifiuta un intero lotto per formato (400, 413, 422) le letture sono reinviate una a una: solo
  quella malformata va in `scartate\` (motivo `HTTP_400`...) e le altre partono.
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
