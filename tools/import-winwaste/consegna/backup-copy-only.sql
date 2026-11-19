/*
  WasteFlow - consegna dei dati: copia di un database WinWaste.NET
  ----------------------------------------------------------------
  Questo script fa UNA sola cosa: scrive un file di backup COPY_ONLY del database indicato.
  Non modifica il database, non tocca la catena dei backup del cliente (COPY_ONLY), non
  cambia impostazioni del server, non lancia programmi esterni, non apre connessioni verso
  altri server. Il file contiene i dati del cliente in chiaro: va cifrato prima di uscire
  dal server (vedi LEGGIMI-cliente.md).

  Uso (da un prompt dei comandi sul server SQL, con un utente che puo' fare i backup):

    sqlcmd -S <server>\<istanza> -E -b -i backup-copy-only.sql ^
           -v DATABASE="WW00012026" DESTINAZIONE="D:\Consegna"

  Database ammessi: WW<ditta 4 cifre><anno 4 cifre> (esempio WW00012026) e
  ww<ditta 4 cifre>MU<anno 2 cifre> (archivio MUD, esempio ww0001MU25). Qualunque altro nome
  (per esempio il database di sistema di WinWaste) viene rifiutato. I valori delle variabili
  non devono contenere apici.

  La cartella DESTINAZIONE deve esistere e il servizio SQL Server deve poterci scrivere.
  Il file prodotto si chiama <DATABASE>_COPYONLY_<anno mese giorno ora minuti>.bak.
*/
:on error exit
SET NOCOUNT ON;

DECLARE @db      sysname        = N'$(DATABASE)';
DECLARE @dest    nvarchar(260)  = N'$(DESTINAZIONE)';

-- Solo database di una ditta WinWaste. Il confronto ignora maiuscole e minuscole.
IF NOT (   @db LIKE N'WW[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' COLLATE Latin1_General_CI_AS
        OR @db LIKE N'ww[0-9][0-9][0-9][0-9]MU[0-9][0-9]'         COLLATE Latin1_General_CI_AS)
   OR @db LIKE N'%adminwwnet%' COLLATE Latin1_General_CI_AS
BEGIN
    THROW 50001, N'Database non ammesso: attesi WWddddaaaa oppure wwddddMUaa.', 1;
END

IF DB_ID(@db) IS NULL
BEGIN
    THROW 50002, N'Il database indicato non esiste su questo server.', 1;
END

IF @dest IS NULL OR LEN(@dest) = 0
BEGIN
    THROW 50003, N'Cartella di destinazione mancante.', 1;
END

DECLARE @istante nvarchar(12) =
      CONVERT(nvarchar(8), GETDATE(), 112)
    + REPLACE(CONVERT(nvarchar(5), GETDATE(), 108), N':', N'');
DECLARE @file nvarchar(400) =
      @dest + CASE WHEN RIGHT(@dest, 1) IN (N'\', N'/') THEN N'' ELSE N'\' END
    + @db + N'_COPYONLY_' + @istante + N'.bak';
DECLARE @nome nvarchar(128) = N'WasteFlow consegna ' + @db;

BACKUP DATABASE @db
    TO DISK = @file
    WITH COPY_ONLY, CHECKSUM, INIT, FORMAT, STATS = 10, NAME = @nome;

PRINT N'Backup scritto in: ' + @file;
