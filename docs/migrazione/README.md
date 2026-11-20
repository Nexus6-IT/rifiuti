# Runbook dell'import WinWaste: dal pacchetto al database

Percorso completo (pezzo I2). Prima: consegna dei dati e staging (`consegna-dati-cliente.md`,
`formato-staging-winwaste.md`). Qui: staging -> pacchetto -> caricamento. Formati in
`formato-pacchetto.md`.

Regola generale: i file con dati del cliente stanno solo su disco cifrato (LUKS), con permessi 0600,
mai nel repository; si cancellano a fine lotto e la cancellazione si registra.

## 1. Preparare la mappa

Sulla workstation, scrivere `mappa-import.json` (formato in `formato-pacchetto.md`, con il `tenantId` dell'azienda). Serve l'elenco di
registri, sedi e unita' locali creati in WasteFlow per l'azienda (`admin/tenants` per l'azienda del
gruppo: nessun tenant si crea in automatico). **Niente dati personali nella mappa.** Confermare una per
una le corrispondenze `OPER` -> causale `dedotta` (`confermata: true`).

## 2. Prova generale in locale (i dati restano sulla workstation)

1. PostgreSQL usa e getta con le migration e i ruoli:
   `bash scripts/ci/postgres-job.sh avvia` (o un container `postgres:16-alpine`), poi
   `npx prisma migrate deploy` e `bash ops/db-ruoli.sh` (ruoli `wasteflow_app` e `wasteflow_sistema`).
2. Creare un'azienda di prova (con registri/sedi della mappa). **Le aziende dell'import non si creano
   mai da qui: il tenant va creato col flusso di amministrazione esistente (`admin/tenants`) e il suo id
   va in `mappa.tenantId`; `--verifica` esce 2 con `TENANT_INESISTENTE` se l'azienda non c'e'.**
   Le ditte con P.IVA gia' in azienda si dichiarano in `agganci` (altrimenti `--verifica` segnala la collisione).
3. Preparare il pacchetto:
   `npm run migrazione:prepara -- ~/staging-winwaste/WW00012026 --mappa mappa-import.json --destinazione ~/pacchetti-winwaste`
4. Verifica: `DATABASE_URL=<url del ruolo wasteflow_app> npm run migrazione:carica -- --tenant <uuid> --pacchetto ~/pacchetti-winwaste/WW00012026 --ambito ANAGRAFICHE --verifica`
   (uscita 2 = ci sono bloccanti: leggere i codici, correggere mappa o dati, ripetere).
   Il rapporto di preparazione elenca anche scarti (`scarto <tabella> <codice>: n`), duplicati (chiavi
   WinWaste) e avvisi (`avviso ...`: scelte dedotte da controllare, vedi `formato-pacchetto.md` §I4):
   vanno letti con l'operatore prima di caricare. Il pacchetto di I4 contiene ditte, sedi, ruoli
   (produttori, trasportatori, destinatari) e automezzi.
   FIR (I5): dopo ANAGRAFICHE, stesso comando con `--ambito FIR --operatore <uuid utente dell'azienda>`.
   I FIR in viaggio senza peso a destino BLOCCANO il caricamento (`FIR_IN_VIAGGIO_SENZA_PESO`, uscita 2, con
   elenco numero + chiave CLIFOR): completarli in WinWaste prima dell'estrazione e rifare staging e pacchetto.
   I FIR digitali non si caricano: il rapporto di `prepara` li elenca (`fir-digitale <numero> <idRentri>`) e si
   riacquisiscono da RENTRI con `migrazione:riacquisisci-fir` (prima in simulazione, poi `--esegui`;
   sola lettura sull'ente, con limite di frequenza: vedi `formato-pacchetto.md`).
   Giacenze al taglio (I6): `--ambito GIACENZE --operatore <uuid>`, anche dopo o prima di ANAGRAFICHE (non ne
   dipende). Il rapporto di `prepara` elenca `differenza-giascar <COD> <GIASCAR> <ricalcolato>` (carichi il cui
   `GIASCAR` non coincide col ricalcolo da `RELAZ`: vanno al cliente, mai corretti in silenzio) e gli scarti
   `GIACENZE MAGAZZINO_NON_IN_MAPPA` (aggiungere il magazzino a `registri` nella mappa e rifare il pacchetto).
   Una giacenza iniziale gia' inserita a mano sulla stessa famiglia e' un bloccante: va tolta a mano
   dall'applicazione (se non e' ancora usata da scarichi) prima del caricamento; l'import non la sovrascrive.
5. Caricare (stesso comando senza `--verifica`), poi **ricaricare**: la seconda volta deve dire
   `inserite: 0` e `saltate` = `lette`.
6. Il rapporto di destinazione della prova va al cliente insieme al rapporto sorgente.

## 3. Copia cifrata sul server

```
age -r <chiave-pubblica-del-server> -o WW00012026.tar.age <(tar -C ~/pacchetti-winwaste -c WW00012026)
scp WW00012026.tar.age <server>:...
```
Sul server: decifrare in una cartella 0700 su disco cifrato, `tar -x`. Controllare le impronte: il
caricamento le verifica da solo (impronte, righe, mappa) e rifiuta un pacchetto alterato.

## 4. Caricare

Dentro l'immagine del backend (compilato, niente ts-node), col ruolo applicativo:

```
node dist/cli/migrazione-carica.js --tenant <uuid> --pacchetto <cartella>/WW00012026 --ambito ANAGRAFICHE --verifica
node dist/cli/migrazione-carica.js --tenant <uuid> --pacchetto <cartella>/WW00012026 --ambito ANAGRAFICHE
```

Il pacchetto va montato in sola lettura e leggibile dall'utente del container (`USER nodejs`, uid 1001):
`docker compose run --rm -v <cartella>:/pacchetto:ro backend node dist/cli/migrazione-carica.js ... --pacchetto /pacchetto/WW00012026`
(i file sono 0600: assegnarli all'uid 1001 o usare `--user`). **Non ancora provato nell'immagine reale.**

`DATABASE_URL` deve essere quello del ruolo `wasteflow_app` (non quello del proprietario: il comando
si rifiuta). Un'azienda alla volta. Se il lotto fallisce (uscita 1) il lotto e' `FALLITO` con il
numero del blocco e la classe dell'errore; correggere la causa e rilanciare: i blocchi gia' scritti
restano e vengono saltati.

## 5. Cancellazione

A fine lotto **conservare** `manifest.json` e `mappa-import.json` (non contengono dati personali, per
costruzione) insieme al rapporto di destinazione e alle tre impronte stampate dalla CLI
(`hashStaging`, `hashMappa`, `hashManifest`): sono l'unico legame fra il lotto e lo staging/la mappa
che l'hanno prodotto. Cancellare invece i `.jsonl` del pacchetto, il `.tar.age`, lo staging, i
`.bak.age` e `SHA256SUMS` ricevuti, e registrare la cancellazione (data, chi, cosa) come da piano.
