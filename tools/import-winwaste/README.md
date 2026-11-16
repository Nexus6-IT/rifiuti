# import-winwaste: estrattore da SQL Server verso lo staging

Legge un database WinWaste.NET (`WW<ditta 4><anno 4>`) da SQL Server e scrive lo staging
`winwaste-staging/1` (manifest + JSON Lines, vedi `docs/migrazione/formato-staging-winwaste.md`).
E' l'inizio della catena di import (Fase 3): estrazione -> staging -> `npm run migrazione:analizza`
nel backend. **Non scrive mai nel database sorgente e non tocca il database di WasteFlow.**

## Dove sta la logica

- **Nucleo senza driver** (sempre testato in CI): `apps/backend/src/application/migrazione/estrazione/`.
  Costruisce le `SELECT`, riduce ogni valore a testo, rifiuta un login che puo' scrivere, oscura i
  segreti, scrive lo staging. Si prova con una sorgente finta (`estrai-staging.spec.ts`).
- **Adattatore e CLI** (questa cartella): `src/adattatore-mssql.ts` e `src/estrai.ts`. Il driver
  `mssql` sta **solo qui**, fuori dall'immagine del backend (`package.json` proprio).

## Garanzie

- **Sola lettura**: prima di leggere il login viene controllato (`fn_my_permissions` su database,
  server e tabella `MOVIMENTI`, piu' `sysadmin`, `db_owner`, `db_datawriter`, `db_ddladmin`). Se ha
  anche un solo permesso di scrittura l'estrazione non parte (`LOGIN_CON_SCRITTURA`, uscita 2).
- **Solo tabelle documentate** (`colonne-documentate.ts`): nomi mai presi dall'input, solo `SELECT`.
- **Testo identico a quello del server**: ogni colonna e' convertita in `NVARCHAR` sul server
  (nessun numero JavaScript, niente dipendenza dalla collation `Latin1_General_CI_AS`); `NULL`
  resta `null`, `''` resta `''`. Campi `text` con a capo, tabulazioni, `§` e accenti passano intatti.
- **Segreti**: da `VERSIS` le colonne `C1..C5` non vengono lette per nessuna riga (la `SELECT` le
  sostituisce con `N''`) e vengono comunque svuotate in Node.
- **Permessi e destinazione**: cartella 0700, file 0600; una cartella non vuota e' rifiutata, `--forza`
  la svuota. Cifrare la cartella intera (`tar | age`) prima di spostarla.
- **Ripetibile**: `ORDER BY` sulla chiave primaria; due estrazioni identiche danno file identici.
- **Destinazione fuori dal repository**: rifiutata se sta dentro un repo git, salvo una cartella
  chiamata `staging-winwaste` (ignorata da `.gitignore`).

## Uso

```bash
cd tools/import-winwaste && npm install
WASTEFLOW_MSSQL_PASSWORD=... npm run estrai -- \
  --server 127.0.0.1 --porta 1433 --database WW00012026 --utente lettore \
  --out ~/staging-winwaste [--fidati-del-certificato]
cd ../../apps/backend && npm run migrazione:analizza -- ~/staging-winwaste/WW00012026
```

La password passa **solo dall'ambiente**. Creare un login dedicato:

```sql
CREATE LOGIN [lettore] WITH PASSWORD = N'...';
USE [WW00012026];
CREATE USER [lettore] FOR LOGIN [lettore];
ALTER ROLE db_datareader ADD MEMBER [lettore];
```

Un archivio `.bak` si ripristina su un SQL Server di prova (mai in produzione) e si estrae da li'.

## Test

```bash
npm test                              # unita': regole della destinazione (sempre)
WASTEFLOW_TEST_MSSQL=1 npm test       # + integrazione contro SQL Server in un container
```

L'integrazione e' **opt-in** e non e' in CI: l'immagine `mcr.microsoft.com/mssql/server:2022-latest`
pesa ~1,5 GB e il container chiede ~1,5-2 GB di RAM (il runner ne ha 6, condivisi fra due job).
Cosa fa: container usa e getta `wasteflow-mssql-import` solo su `127.0.0.1` (porta libera diversa
da 4200), password casuale in un env-file temporaneo 0600 cancellato subito, attach
`FOR ATTACH_REBUILD_LOG` di **copie** dei `.mdf` modello dell'installer
(`WASTEFLOW_MDF_DIR`, default `~/Progetti/winwaste/estratto`, file `005_ww00002014_data.mdf`),
login di sola lettura. Verifica: rifiuto di `sa`; estrazione dei dati demo del modello; roundtrip
delle righe della fixture (con `§`, accenti, tab, a capo, `NULL`) con lo stesso rapporto
dell'analizzatore; ripetibilita'. A fine prova rimuove container e copie. I `.mdf` dell'installer
sono dati demo non fidati: si attaccano, non si eseguono.
