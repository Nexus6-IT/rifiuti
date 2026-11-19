# Consegna dei dati dal cliente WinWaste (pezzo I1)

Decisione di Graziano (18/11): il `.bak` lo fa l'IT del cliente con il nostro script, `COPY_ONLY`,
cifrato con age; noi lo ripristiniamo in un container usa e getta ed estraiamo lo staging. Nessun
binario di WinWaste viene eseguito da noi.

## File

| File | Dove gira | Cosa fa |
|---|---|---|
| `tools/import-winwaste/consegna/backup-copy-only.sql` | server SQL del cliente (`sqlcmd`) | un solo `BACKUP DATABASE ... COPY_ONLY, CHECKSUM`, database ammessi `WW<ditta><anno>` e `ww<ditta>MU<aa>` |
| `tools/import-winwaste/consegna/LEGGIMI-cliente.md` | si consegna al cliente | istruzioni per l'IT: backup, impronte `SHA256SUMS`, cifratura age |
| `tools/import-winwaste/consegna/ripristina.sh` | nostra macchina | decifra, verifica l'impronta, ripristina in un container, crea il login di sola lettura, (opz.) estrae |

## Percorso completo

1. Mandiamo al cliente `backup-copy-only.sql` e `LEGGIMI-cliente.md` con la **chiave pubblica age**
   (la privata resta a noi, fuori dal repository).
2. L'IT produce i `.bak`, `SHA256SUMS` e i `.bak.age`; ce li invia.
3. Noi: `ripristina.sh --identita <chiave-privata> --estrai-in ~/staging-winwaste WW00012026_COPYONLY_*.bak.age`.
   `SHA256SUMS` (calcolato dall'IT sui `.bak` in chiaro) sta nella stessa cartella: dopo la decifratura lo script verifica l'impronta del `.bak`; per i file `.age` e' obbligatorio, se manca la riga o l'impronta e' diversa si ferma con uscita 2, prima di avviare Docker.
4. Lo staging esce in `~/staging-winwaste/WW<ditta><anno>/`; `npm run migrazione:analizza` come prima.
5. A fine uso container (`rm -f -v`), rete e file di lavoro spariscono. Il `.bak` in chiaro si decifra in
   una cartella di lavoro 0700 (`WASTEFLOW_CONSEGNA_TMP`, default `/tmp`: su Fedora e' in RAM, per `.bak`
   grandi indicare una cartella su disco). `docker cp` e i file del ripristino finiscono comunque
   nello strato scrivibile del container, su disco: la workstation deve avere il disco cifrato (LUKS).
   Lo staging prodotto con `--estrai-in` resta in chiaro (0600) nella cartella scelta: lo cancella chi
   lancia lo script a fine lotto, e la cancellazione si registra come da piano. Cancellare anche i file
   ricevuti (`.bak.age`, `SHA256SUMS`).

`ripristina.sh --tieni` lascia container e cartella di lavoro per provare l'estrazione a mano e
stampa il comando per eliminarli.

## Garanzie dello script di ripristino

- Container su una rete Docker `--internal` creata e rimossa dallo script: **nessuna uscita verso
  Internet** e nessuna porta pubblicata; l'estrattore si collega all'IP del container sul bridge (raggiungibile
  dall'host Linux). Telemetria spenta (`MSSQL_TELEMETRY_ENABLED=FALSE`), tag dell'immagine fisso
  (`2022-CU16-ubuntu-22.04`; per un `.bak` di SQL Server piu' recente `WASTEFLOW_MSSQL_IMMAGINE=<immagine>`), 2 GB di memoria.
  Nota licenza: l'edizione Developer e' per sviluppo e test; per dati reali di un cliente valutare Express (limite 10 GB).
- Password di `sa` generata a caso, in un env-file 0600 dentro la cartella di lavoro 0700: mai in
  riga di comando (nemmeno `sqlcmd -P`: si usa `SQLCMDPASSWORD`), mai nell'output. I comandi SQL con la password del login `lettore` passano da
  standard input.
- Il login `lettore` ha **solo** `db_datareader`; l'estrattore rifiuta comunque un login che puo' scrivere.
- Il nome del database viene dal nome del file e deve rispettare il pattern; `adminwwnet` e' rifiutato.
- Il `.bak` si ripristina (`RESTORE ... WITH CHECKSUM`): non si esegue nulla del cliente.

## Prove

Senza SQL Server (sempre, in CI): `npx jest src/application/migrazione/consegna` nel backend.
Controlla il testo dello script T-SQL (solo `BACKUP`, `COPY_ONLY`, `CHECKSUM`; nessun
`RESTORE`/`DROP`/`ALTER`/`sp_configure`/`xp_cmdshell`...) ed esegue `ripristina.sh` con un `docker`
finto (loopback, password, pulizia, decifratura, impronta, login di sola lettura).

Con SQL Server vero (opt-in, non in CI: immagine ~1,5 GB, container da ~2 GB di RAM):

```bash
# 1. backup COPY_ONLY del database modello, DA UN SQL SERVER DI PROVA (mai quello del cliente)
sqlcmd -S 127.0.0.1,<porta> -U sa -C -b -i tools/import-winwaste/consegna/backup-copy-only.sql \
       -v DATABASE="WW00002014" DESTINAZIONE="/var/opt/mssql/backup"
# 2. ripristino + estrazione con lo script
tools/import-winwaste/consegna/ripristina.sh --estrai-in ~/staging-winwaste <file>.bak
```

Il `.mdf` modello (`~/Progetti/winwaste/estratto/005_ww00002014_data.mdf`) si **attacca** a un SQL
Server di prova (come fa `WASTEFLOW_TEST_MSSQL=1 npm test` in `tools/import-winwaste`), non si esegue.
Il nome del modello e' `ww00002014` (anno 2014): per `ripristina.sh` va rinominato in
`WW00002014_COPYONLY_<data>.bak`. Confronto atteso: l'estrazione e' identica a quella diretta dal
database attaccato (stesse righe, stesso `improntaSchema`).

## Aperti (da confermare sul primo `.bak` reale)

- **Pezzo ancora aperto (I-3):** la prova reale opt-in (`WASTEFLOW_TEST_MSSQL=1`, backup COPY_ONLY del
  modello, `ripristina.sh`, estrazione identica) non e' mai stata eseguita; il catalogo viene da
  `schema-db-winwaste.md` e il T-SQL non e' stato eseguito. Va fatta su una macchina con Docker
  (sulla workstation c'e' solo podman) prima del primo cliente.

- Versione di WinWaste: non e' in una colonna certa del database; si usa `origine.improntaSchema`.
- `MUDAZ`/`MUDTERZI`: tipi dei campi di testo da `docs/mud.md`, non dal catalogo; estrazione dal
  database MUD nel pezzo I11.
- Il container SQL Server deve avere una versione >= di quella del cliente (un `.bak` non si
  ripristina su una versione piu' vecchia): `2022-latest` copre fino a SQL Server 2022.
