# Formato di staging WinWaste (`winwaste-staging/1`)

Lo staging e' la **frontiera fra estrazione e trasformazione** dell'import da WinWaste.NET
(Fase 3). L'estrattore (`tools/import-winwaste`) legge da SQL Server e scrive questo formato;
l'analizzatore (`npm run migrazione:analizza`) e, dal blocco 2, il caricatore lo leggono.
Il database dell'applicazione non vede mai i valori grezzi.

Decisione: Q2 del piano Fase 3 (14/11/2026) — dati grezzi **fuori dal database**, in file, con
manifest e impronte. Nel database vanno solo i lotti (`lotti_import`) e, in 3.6, i rapporti.

## Dove stanno i file

- Sulla **workstation** di chi estrae, mai sul VPS condiviso e mai nel repository.
- Una cartella per archivio, col nome del database d'origine: `WW<ditta 4 cifre><anno 4 cifre>`
  (esempio `WW00012026` = ditta 0001, anno 2026).
- `.gitignore` blocca `**/staging-winwaste/**` e `*.bak`; un test verifica che i pattern
  funzionino e che la fixture sintetica NON sia ignorata. Consiglio: tenere gli staging in una
  cartella `staging-winwaste/` fuori dal repo.
- Le fixture sintetiche dei test stanno in `apps/backend/test/fixtures/winwaste/`
  (generate da `genera-fixture.ts`, deterministiche).

## Contenuto della cartella

```
WW00012026/
  manifest.json
  movimenti.jsonl
  formulari.jsonl
  giacenze-rifiuti.jsonl
  causali-rifiuti.jsonl
  registri-rifiuti.jsonl
  versis.jsonl
  renregistrazioni.jsonl
```

Le tabelle sono quelle del catalogo in `colonne-documentate.ts`. Una tabella assente e'
ammessa (l'analizzatore lo dice nel rapporto); una tabella in piu' produce l'avviso
`TABELLA_NON_DOCUMENTATA`.

## `manifest.json`

```json
{
  "formato": "winwaste-staging/1",
  "ditta": "0001",
  "anno": 2026,
  "databaseOrigine": "WW00012026",
  "estrattoIl": "2026-11-14T00:00:00.000Z",
  "estrattore": { "nome": "import-winwaste", "versione": "1" },
  "tabelle": {
    "MOVIMENTI": {
      "file": "movimenti.jsonl",
      "righe": 18,
      "sha256": "<64 cifre esadecimali minuscole>",
      "colonne": ["COD", "CAUS", "OPER"]
    }
  }
}
```

- `ditta` 4 cifre, `anno` intero 1990-2100; `databaseOrigine` DEVE essere `WW<ditta><anno>` e
  coincidere col nome della cartella (altrimenti `ARCHIVIO_INCOERENTE`).
- La chiave di `tabelle` e' il **nome SQL Server esatto** (puo' contenere spazi:
  `GIACENZE RIFIUTI`, `CAUSALI RIFIUTI`).
- `file`: solo nome (`^[a-z0-9][a-z0-9-]*\.jsonl$`), mai un percorso; due tabelle non possono
  usare lo stesso file.
- `righe`: righe non vuote del file. `sha256`: impronta dei byte del file.
- `colonne`: nomi nell'ordine dei valori in ogni riga.
- L'**impronta del manifest** (SHA-256 di `manifest.json`) e' il `hash_staging` che finira' in
  `lotti_import`.

## File `*.jsonl`

Una riga di testo per riga di tabella, UTF-8, a capo `\n` (si accetta anche `\r\n` in lettura).
Ogni riga e' un **array JSON** di valori nell'ordine di `colonne`:

- ogni valore e' una **stringa** oppure `null` (NULL di SQL Server): `null` e `""` sono distinti;
- i valori sono quelli di SQL Server **senza interpretazione**: date, pesi e prezzi restano il
  testo originale (`'05-01'`, `'1.234,56'`, `'20260105'`);
- le colonne numeriche vere (`COD` int, `GIASCAR`/`KGNUM`/`MCNUM` decimal) viaggiano come testo
  in formato invariante col punto decimale (`'1000.000000'`), con `CAST` in SQL Server: mai
  tramite numeri JavaScript (si perderebbe la precisione);
- a capo, tabulazioni e `§` dentro un valore sono preservati (JSON li escapa); U+2028 e U+2029
  sono escapati dallo scrittore perche' `readline` li tratterebbe come fine riga;
- **dati segreti**: da `VERSIS` l'estrattore non copia `C1..C5` di NESSUNA riga (nelle righe hub
  `HUBRW/HUBRP/HUBRD/HUBWW` sono host, utente, password cifrata, licenza): sono sostituiti da
  stringa vuota gia' dalla `SELECT`. Il parser non li copia comunque nei record.
- **permessi**: cartella 0700, file 0600 (anagrafiche, registro e FIR in chiaro). Una cartella di
  destinazione non vuota e' rifiutata (`CARTELLA_NON_VUOTA`) o svuotata con `--forza`. Per portare
  lo staging fuori dalla workstation cifrare la cartella intera (`tar | age`).
- **manifest non ripetibile**: `estrattoIl` cambia a ogni estrazione, quindi anche `hashManifest`;
  la ripetibilita' vale per i file `.jsonl`.
- **float/real/money**: convertiti con `CONVERT(..., 3)` (17 cifre) e `CONVERT(..., 2)` (4 decimali);
  il float esce in notazione scientifica e il parser lo scarta (`DECIMALE_SQL`) invece di alterarlo.

## Verifiche del lettore

`apriStaging` rifiuta, con errore tipato e **prima di decodificare qualunque valore**:

| Codice | Quando |
|---|---|
| `CARTELLA_NON_VALIDA` | la cartella non esiste o non e' una cartella |
| `MANIFEST_ASSENTE` / `MANIFEST_NON_VALIDO` | manifest mancante, non JSON o con campi errati |
| `FORMATO_SCONOSCIUTO` | `formato` diverso da `winwaste-staging/1` |
| `ARCHIVIO_INCOERENTE` | ditta, anno, database d'origine e nome cartella non coincidono |
| `FILE_ASSENTE` | un file dichiarato non c'e' |
| `HASH_NON_CORRISPONDE` | l'impronta del file e' diversa da `sha256` |
| `RIGHE_NON_CORRISPONDENTI` | le righe lette sono diverse da `righe` |

Sono **avvisi**, non errori: `COLONNA_MANCANTE` (colonna documentata assente dal manifest),
`COLONNA_NON_DOCUMENTATA` (colonna in piu': le versioni di WinWaste cambiano lo schema),
`TABELLA_NON_DOCUMENTATA`.

La lettura (`leggi`) e' in streaming. Una riga illeggibile diventa uno **scarto** con il
numero di riga e la lettura prosegue: `RIGA_JSON_MALFORMATA`, `RIGA_NON_ARRAY`,
`RIGA_LUNGHEZZA` (numero di valori diverso dalle colonne), `VALORE_NON_STRINGA`.

## Fonte delle colonne

Schema reale ricavato il 14/11/2026 dai database modello dell'installer
(`docs/schema-db-winwaste.md` del progetto WinWaste: 157 tabelle, nessuna foreign key, quasi
tutto `varchar` con default `''`). Differenze che contano per chi legge lo staging:

- `MOVIMENTI` e `FORMULARI` hanno le stesse 101 colonne ma tipi diversi: `STATO` varchar(5)
  contro varchar(1), `NFATT` 10 contro 8, `LEGAME` 255 contro 10, `KGNUM`/`MCNUM` decimal(18,6)
  contro decimal(18,0).
- `NETTO`, `LORDO`, `TARA` sono `varchar(8)`; `DES` e `NOT3` `varchar(50)` nel modello (il codice
  le allarga: un database reale puo' averle piu' larghe).
- Il modello e' del 2014: l'introspezione del database del cliente (stessa query del §4 dello
  schema) va fatta prima di mappare.

## Formati verificati sui dati del database modello (14/11/2026)

L'estrattore e' stato provato su una copia del database modello dell'installer (`WW00002014`,
dati demo: 16 `MOVIMENTI`, 4 `FORMULARI`, 14 causali, 4 registri). Cio' che i dati hanno
confermato o corretto rispetto alla documentazione scritta dal codice:

| Campo | Osservato | Decisione |
|---|---|---|
| `DTUK` annullato | `$$140131`: il prefisso `$$` **sostituisce** le prime due cifre dell'anno (8 caratteri, non 10) | il secolo si prende dall'anno del database; `$$` + altro = scarto `DTUK_NON_VALIDA` |
| `DTUK` attivo | `aaaammgg` (`20140102`) | come documentato |
| `RELAZ` in `MOVIMENTI` | `C1       R1000                   0`: codice del carico a sinistra su 8, kg a sinistra su 12 e **interi**, m3 a destra su 12 | il decodificatore tronca gli spazi e accetta interi e virgola decimale |
| `RELAZ` in `FORMULARI` | **testo libero** (note) imbottito con `Chr(255)`, non una relazione | avviso `RELAZ_NON_DECODIFICABILE`, FIR tenuto, testo nel `grezzo` (in `MOVIMENTI` resta uno scarto) |
| `PROD`/`SMAL` | `000001.0001` (6 + `.` + 4) | forma presunta confermata |
| `STATO` | `R002`, `R002$` (esaurito) | come documentato |
| `C7` dei FIR | `0`, `1`, `2` (richieste del portale) | classe `PORTALE` |
| colonne | identiche a quelle documentate (nessun avviso `COLONNA_*`) | — |

Con questi aggiustamenti i dati demo si decodificano senza scarti; il registro `0002` ha
protocolli 1..7 senza buchi e l'ultimo coincide con `PRT` del registro; le giacenze calcolate da
`RELAZ` coincidono con `GIASCAR`. Restano **da riverificare su un `.bak` reale**: il secolo dei
`$$`, la forma dei decimali dentro `RELAZ`, `OPER` 27/51/52 (non presenti nel modello) e le
colonne del database di un cliente (che puo' avere tipi piu' larghi, vedi sopra).

## Estrazione da SQL Server

`tools/import-winwaste` (README proprio) legge da un SQL Server con un login di **sola
lettura** (rifiuta chi puo' scrivere) e scrive questo formato. Il nucleo senza driver sta in
`apps/backend/src/application/migrazione/estrazione/` ed e' sempre testato; il driver `mssql`
sta solo nel tool. La prova contro un SQL Server vero e' opt-in (`WASTEFLOW_TEST_MSSQL=1`).
