# Formato del pacchetto di caricamento (`wasteflow-pacchetto/1`) e della mappa (`wasteflow-mappa/1`)

Il pacchetto e' la **frontiera fra trasformazione e caricamento** dell'import da WinWaste.NET
(pezzo I2 del piano `2026-11-18-import-winwaste`). `npm run migrazione:prepara` lo scrive sulla
workstation partendo dallo staging (`winwaste-staging/1`) e dalla mappa; `migrazione:carica` lo
legge sul server e lo scrive nel database a blocchi, col solo client applicativo (RLS).

Contiene dati dell'azienda e personali **in chiaro**: file 0600, cartella 0700, mai nel repository
(`**/pacchetti-winwaste/**` e' ignorato da git), cifrato (age) per il trasferimento e cancellato a
fine lotto. Vedi `README.md` di questa cartella per il percorso completo.

## Cartella

Una cartella per archivio, col nome del database d'origine `WW<ditta 4 cifre><anno 4 cifre>`:

```
WW00012026/
  manifest.json            formato, impronte, elenco dei file
  mappa-import.json        la mappa (JSON canonico: chiavi ordinate)
  anagrafiche-ditte.jsonl  un file per (ambito, fase): <ambito minuscolo>-<fase>.jsonl
  ...
```

## `manifest.json`

| Campo | Contenuto |
|---|---|
| `formato` | `wasteflow-pacchetto/1`. Un altro valore e' rifiutato (`FORMATO_SCONOSCIUTO`) |
| `importSource` | `WINWASTE` |
| `archivio` | `WW<ditta><anno>`: deve coincidere col nome della cartella e con ditta/anno della mappa |
| `hashStaging` | SHA-256 del `manifest.json` dello staging d'origine |
| `hashMappa` | impronta canonica della mappa (SHA-256 del JSON con chiavi ordinate e senza spazi) |
| `creatoIl` | istante ISO 8601 |
| `file[]` | `{ ambito, fase, file, righe, sha256 }`: `ambito` fra `ANAGRAFICHE`, `REGISTRO`, `GIACENZE`, `FIR`; `file` solo il nome; `righe` = righe non vuote; `sha256` = byte del file |

Un file JSON Lines per fase: una riga = un oggetto JSON (UTF-8, `\n`, U+2028/2029 escapati) nella
forma dei modelli di WasteFlow, con `legacyKey` (stesse chiavi di `chiavi-legacy.ts`).

Fasi definite oggi: `ANAGRAFICHE/ditte` con record `{ legacyKey, ragioneSociale, partitaIva|null,
codiceFiscale|null }`. Sedi, ruoli, FIR, registro e giacenze arrivano con i pezzi I4-I7 senza cambiare
il formato (si aggiungono righe in `file[]` e una definizione in `caricamento/fasi-ambito.ts`).

## Verifica in apertura (`apriPacchetto`)

Prima di restituire qualcosa il lettore controlla, nell'ordine: cartella e `manifest.json`; formato;
nome cartella = `archivio`; `mappa-import.json` presente, valida e con l'impronta dichiarata
(`MAPPA_DIVERSA` altrimenti; opzionalmente anche quella attesa dall'operatore); ditta e anno della
mappa = archivio; per ogni file: esistenza, SHA-256 e numero di righe. Un pacchetto manomesso o
troncato non arriva mai al caricamento. La lettura dei record e' in streaming.

Il server **non si fida** nemmeno di un pacchetto con impronte giuste: ogni record e' rivalidato con
i validatori di dominio (`record-ditta.ts`: chiave coerente con P.IVA/CF, P.IVA con cifra di
controllo, lunghezze). Un record non valido ferma il caricamento **prima** di aprire il lotto
(uscita 2). Gli errori riportano fase, numero di riga e codice, mai valori.

## Mappa di import `mappa-import.json`

La scrive l'operatore; viaggia col pacchetto; la sua impronta identifica la scelta fatta.

```json
{
  "formato": "wasteflow-mappa/1",
  "ditta": "0001",
  "anno": 2026,
  "dataTaglio": "2026-06-30",
  "registri":    [{ "legacy": "REG1", "registroId": "<uuid>" }],
  "unitaLocali": [{ "legacy": "X1.1", "sedeId": "<uuid>", "unitaLocaleId": "<uuid>|null" }],
  "causali":     [{ "oper": "10", "causale": "INGRESSO_ESTERNO", "verso": "CARICO", "confermata": true }],
  "agganci":     [{ "partitaIva": "<11 cifre>", "dittaId": "<uuid>" }]
}
```

- `registri`: registri e magazzini WinWaste -> `registroId` di WasteFlow.
- `unitaLocali`: unita' locali **dell'azienda** (soggetti propri `X<sede>.<ul>`) -> sede e `RentriUnitaLocale`.
- `causali`: `OPER` -> causale F2-5 (`causali_registro`) con il verso. Le corrispondenze `dedotta` di
  `oper.ts` vanno confermate una per una: finche' `confermata` e' `false`, `--verifica` segnala un bloccante.
- `agganci`: ditta gia' presente in WasteFlow (P.IVA uguale): si usa l'id esistente, non si inserisce.
- La data di taglio e' `AAAA-MM-GG`.

**La mappa non contiene dati personali.** Lo schema e' chiuso: ogni chiave e' elencata, una chiave non
prevista e' un errore (non c'e' un campo libero dove scrivere un nome); ogni stringa ha un pattern
stretto; in piu' nessun valore puo' somigliare a un codice fiscale, a un e-mail o a un numero di
telefono (`MAPPA_NON_VALIDA`, senza riportare il valore). L'unico identificativo fiscale ammesso e' la
partita IVA degli agganci (con cifra di controllo valida).

## Comandi

```
# workstation (puro: niente database, niente Prisma/Nest)
npm run migrazione:prepara -- <cartella-staging> --mappa <mappa-import.json> --destinazione <cartella> [--forza]

# server, dentro l'immagine del backend (compilato, niente ts-node)
node dist/cli/migrazione-carica.js --tenant <uuid> --pacchetto <cartella> --ambito <AMBITO> [--verifica] [--dimensione-blocco N]
```

| Uscita | `migrazione:prepara` | `migrazione:carica` |
|---|---|---|
| 0 | pacchetto scritto | caricato (con `--verifica`: nessun bloccante) |
| 1 | pacchetto gia' esistente senza `--forza` | caricamento fallito (lotto `FALLITO`), lotto gia' in corso, ruolo del database non applicativo, errore imprevisto |
| 2 | staging, mappa o pacchetto rifiutati | pacchetto rifiutato, record non valido, ambito senza fasi, bloccanti in `--verifica` |
| 64 | uso errato | uso errato |

Output e log: solo codici, id tecnici e conteggi. Mai valori dei record.

### `--verifica`: solo letture

Gira in una transazione con `transaction_read_only = on`: se per errore una query scrivesse, il
database la rifiuterebbe (SQLSTATE 25006). Non apre lotti. Controlla: registri, sedi e unita' locali
della mappa esistenti nell'azienda; causali esistenti (catalogo di sistema o proprie dell'azienda) e
confermate; agganci esistenti con quella P.IVA; collisioni di P.IVA e codice fiscale con ditte non
agganciate; lotto gia' `IN_CORSO` per (archivio, ambito); record non validi. Le collisioni di
`firNumber` e dei progressivi si aggiungono con I5 e I7.

### Il client e' solo quello applicativo

`migrazione:carica` rifiuta di girare con un ruolo del database che aggira la RLS (proprietario,
superutente, ruolo di sistema): uscita 1. Il modulo (`MigrazioneModule`) non importa `PrismaModule` e
un test d'architettura verifica che il client di sistema non sia nemmeno raggiungibile.

## Lotto a fasi

Il lotto si apre una volta per (azienda, archivio, ambito). Le fasi di un ambito girano nell'ordine
sullo stesso lotto (`inserisciABlocchi(..., { concludi: false })`); `completa` arriva dopo l'ultima.
Alla prima fase fallita il lotto e' `FALLITO` e le seguenti non partono; i blocchi gia' scritti
restano e la riesecuzione e' idempotente sulla chiave legacy (le righe gia' presenti sono «saltate»).
`hash_staging` del lotto contiene l'impronta del `manifest.json` del pacchetto (che a sua volta
contiene quella dello staging e quella della mappa).
