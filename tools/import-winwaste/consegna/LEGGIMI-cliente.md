# Consegna dei dati a WasteFlow: istruzioni per l'IT

Questo documento e' per chi gestisce il server SQL Server su cui gira WinWaste.NET. Serve a
consegnarci una **copia** dei database, una volta, senza fermare WinWaste e senza modificare nulla.

## Cosa fa lo script

`backup-copy-only.sql` scrive un file di backup per ogni database che gli indichi. E' un backup
`COPY_ONLY`: **non** altera la catena dei backup che gia' fate e **non** modifica il database. Come ogni backup, SQL Server annota l'operazione nello storico di
`msdb` (`backupset`, marcata `is_copy_only`): e' normale e innocuo. Se il database usa **TDE** o i
backup sono cifrati, il `.bak` non si ripristina senza il certificato: avvisateci prima. Lo
script e' breve e leggibile: potete farlo rivedere prima di lanciarlo. Non cambia impostazioni del
server, non lancia programmi, non si collega ad altri server, non cancella nulla.

## Cosa serve

- Un accesso al server SQL con un utente che puo' fare i backup (per esempio membro di `db_backupoperator`).
- `sqlcmd` (di solito gia' presente dove c'e' SQL Server).
- Nomi di database e percorsi **senza apici** (`'`): lo script li rifiuterebbe male.
- Una cartella con spazio libero (come la dimensione dei database) in cui il servizio SQL puo' scrivere.
- `age` (https://age-encryption.org), per cifrare i file prima di mandarli. E' un singolo eseguibile.
- La **chiave pubblica** che vi abbiamo mandato (una riga che comincia per `age1...`).

## Quali database

Scrivete il nome come `WW<ditta><anno>` (maiuscolo; se sul server compare in minuscolo, il nome del file viene normalizzato da noi).
Per ogni ditta da migrare: il database dell'anno in corso e quelli dei **cinque anni precedenti**
(`WW<ditta 4 cifre><anno 4 cifre>`, per esempio `WW00012026`, `WW00012025`, ...). Se esiste anche
l'archivio MUD (`ww<ditta 4 cifre>MU<aa>`) indicatelo e mandateci anche quello. Non serve e non va
inviato `adminwwnet`: lo script lo rifiuta.

## Passi

1. Aprite un prompt dei comandi sul server SQL.
2. Per ciascun database:

   ```
   sqlcmd -S <server>\<istanza> -E -b -i backup-copy-only.sql -v DATABASE="WW00012026" DESTINAZIONE="D:\Consegna"
   ```

   Alla fine compare `Backup scritto in: D:\Consegna\WW00012026_COPYONLY_<data><ora>.bak`.
   Se compare un errore, copiatelo e mandatecelo: non c'e' nulla da riparare.
3. Calcolate le impronte dei `.bak` **in chiaro** (PowerShell, prima di cifrare) e salvatele nel file
   `SHA256SUMS`. Noi le controlliamo sul file decifrato, e senza `SHA256SUMS` non lo ripristiniamo:

   ```
   cd D:\Consegna
   Get-ChildItem *.bak | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_ -Algorithm SHA256).Hash.ToLower(), $_.Name } | Set-Content -Encoding ascii SHA256SUMS
   ```
4. **Cifrate ogni file** (i dati contengono dati personali: non devono viaggiare in chiaro):

   ```
   age -r age1...LA-NOSTRA-CHIAVE-PUBBLICA... -o WW00012026_COPYONLY_<data><ora>.bak.age WW00012026_COPYONLY_<data><ora>.bak
   ```
5. Inviateci i file `.bak.age` **e** il file `SHA256SUMS` (che elenca i nomi dei `.bak`) con il canale concordato. Poi cancellate dal
   server i `.bak` in chiaro e i `.age`: non servono piu'.

## Cosa non succede

- WinWaste continua a funzionare. Il backup puo' rallentarlo per qualche minuto.
- Nessun nostro programma gira sul vostro server: lo script e' l'unica cosa che lanciate.
- Noi ripristiniamo i file su una macchina nostra, isolata, e cancelliamo tutto a fine lavoro.
