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
2. Creare un'azienda di prova (con registri/sedi della mappa).
3. Preparare il pacchetto:
   `npm run migrazione:prepara -- ~/staging-winwaste/WW00012026 --mappa mappa-import.json --destinazione ~/pacchetti-winwaste`
4. Verifica: `DATABASE_URL=<url del ruolo wasteflow_app> npm run migrazione:carica -- --tenant <uuid> --pacchetto ~/pacchetti-winwaste/WW00012026 --ambito ANAGRAFICHE --verifica`
   (uscita 2 = ci sono bloccanti: leggere i codici, correggere mappa o dati, ripetere).
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
