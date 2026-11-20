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

Fasi definite oggi, tutte di ambito `ANAGRAFICHE`, caricate in quest'ordine (le parti si legano
per chiave legacy, non per id): `ditte`, `sedi`, `produttori`, `trasportatori`, `destinatari`,
`automezzi`. Le fasi vuote non si scrivono (tranne `ditte`): un pacchetto di sole ditte (pezzo I2)
si carica ancora. Il registro arriva con il pezzo I7 senza cambiare il formato (si aggiungono righe in
`file[]` e una definizione in `caricamento/fasi-ambito.ts`). Dal pezzo I5 c'e' anche l'ambito `FIR`
(vedi sotto), da caricare DOPO ANAGRAFICHE; dal pezzo I6 l'ambito `GIACENZE` (vedi sotto).

| Fase | Record | Chiave legacy |
|---|---|---|
| `ditte` | `{ legacyKey, ragioneSociale, partitaIva\|null, codiceFiscale\|null }` | `ditta\|FISC\|<P.IVA o CF>` |
| `sedi` | `{ legacyKey, dittaKey, dittaId\|null, denominazione\|null, via, civico, cap, comune, provincia, telefono\|null, principale }` | `ditta\|PRECOD\|COD\|UL`; UL riservate: `SL` sede legale, `S2` seconda sede di CLIFOR |
| `produttori` | `{ legacyKey, dittaKey, dittaId\|null, sedeKey }` | `ditta\|PRECOD\|COD` (soggetto) |
| `trasportatori` | come i produttori + `numeroIscrizione`, `scadenzaIscrizione\|null` | idem |
| `destinatari` | come i produttori + `numeroAutorizzazione`, `scadenzaAutorizzazione\|null` | idem |
| `automezzi` | `{ legacyKey, targa, trasportatoreKey\|null, taraKg\|null, note\|null }` | `ditta\|MEZ\|<PRECOD>\|<COD>` |

`dittaId` e' valorizzato solo per una **ditta agganciata** (P.IVA gia' in WasteFlow, vedi `agganci`
della mappa): l'id deve coincidere con quello della mappa, altrimenti la riga e' rifiutata. Le sedi di
una ditta agganciata non sono mai principali (la ditta esistente ha gia' la sua).

### Ambito `FIR` (I5)

Fasi: `fir` (si carica) e `fir-digitali` (solo elenco: il server la conosce ma non la carica, vedi
`FASI_SOLO_ELENCO`). Da `FORMULARI` (+ `AUTOMEZZI` per la targa, `XRENTRIFIRTRASMESSI` per l'IDRENTRI).

| Fase | Record | Chiave legacy |
|---|---|---|
| `fir` | `{ legacyKey, firNumber, stato, dataTrasporto, dataFine\|null, cerCode, pericoloso, descrizione, quantitaKg, targa, operazione, produttore, trasportatore\|null, destinatario }` | `ditta\|anno\|FORMULARI\|COD` |
| `fir-senza-peso` | `{ legacyKey, firNumber, produttoreKey\|null }` (solo elenco, numero + chiave CLIFOR) | idem |
| `fir-digitali` | `{ legacyKey, numeroFir, idRentri\|null, unitaLocaleId\|null }` | idem (la riga sorgente) |

Una parte e' `{ tipo: 'ditta', dittaKey, dittaId\|null, sedeKey\|null, ruoloKey\|null }` oppure
`{ tipo: 'propria', sedeId }` (unita' locale dell'azienda stessa, dalla mappa). Nome, partita IVA e
indirizzo dello snapshot si leggono dal database al caricamento (la ditta puo' essere un aggancio).

Regole (tutte con fixture SINTETICHE: nessun `.bak` era disponibile, forme dei campi PRESUNTE):

- **`firNumber` = `FORMU` com'e'**, mai rinominato. Un numero ripetuto nel pacchetto
  (`FIR_NUMBER_DUPLICATO_NEL_PACCHETTO`) o gia' in azienda e non importato (`FIR_NUMBER_GIA_PRESENTE`)
  e BLOCCANTE in `--verifica` e in `carica`; `prepara` lo segnala come avviso `FIR_NUMBER_DUPLICATO`.
- `C7`: vuoto, `R`, `9` sono FIR; `A` (`FIR_ANNULLATO`) e richieste del portale (`RICHIESTA_PORTALE`) sono scarti.
- **FIR digitali** (`C6` = `DIGITALE` / `INVIATO A RENTRI ...`): non si copiano; vanno in `fir-digitali` e
  nel rapporto di `prepara` (`fir-digitale <numero> <idRentri|->`). Si riacquisiscono da RENTRI con
  `migrazione:riacquisisci-fir`.
- Stato dedotto: `COMPLETED` con data di fine trasporto (`DATF`) e peso a destino, altrimenti
  `AWAITING_RECEIVER`. Anche CER, data, quantita', targa, recupero/smaltimento sono dedotti o presi
  dai campi del FIR; stato fisico, provenienza e caratteristiche di pericolo restano vuoti (non si inventano).
- Scarti per FIR: `PRODUTTORE|DESTINATARIO|TRASPORTATORE_NON_RISOLTO/_AMBIGUO/_PROPRIO_NON_IN_MAPPA`,
  `CER_ASSENTE`, `DATA_ASSENTE`, `FORMU_ASSENTE`, `FORMU_NON_VALIDO`. Una unita' locale
  senza sede importata ripiega sulla sede predefinita della ditta (avviso `SEDE_NON_RISOLTA`).
- **FIR in viaggio senza peso a destino (`NETTO` assente o 0): BLOCCANTE** (`FIR_IN_VIAGGIO_SENZA_PESO`) in `--verifica` e in `carica`, mai importato ne' scartato in silenzio. `prepara` e la CLI di caricamento stampano l'elenco `fir-senza-peso <numero> <chiave CLIFOR>` (nessun dato personale) e l'indicazione: completare i FIR in WinWaste prima dell'estrazione, poi rifare staging e pacchetto. Vale anche se e' l'unico FIR (non e' mai «nulla da caricare»).
- Ogni FIR importato nasce `bloccato_invio` e senza legame RENTRI: non si trasmette mai prima della riconciliazione (3.6).
- L'operatore (`--operatore <uuid>`, utente dell'azienda) e' obbligatorio per l'ambito FIR:
  `producer_user_id` e' una FK a `users`. `--verifica`: `OPERATORE_ASSENTE` / `OPERATORE_INESISTENTE`.
- ANAGRAFICHE devono essere gia' caricate: `RIFERIMENTO_DITTA_NON_CARICATO`, `RIFERIMENTO_SEDE_NON_CARICATO`.
- La chiave della sede di un riferimento `PROD/TRAS/SMAL` usa la STESSA regola di `prepara` (UL), in
  `chiaveSedeDaSoggettoUnita` (`domain/migrazione/chiavi-legacy.ts`).

#### `migrazione:riacquisisci-fir`

```
node dist/cli/migrazione-riacquisisci-fir.js --tenant <uuid> --pacchetto <cartella> --utente <uuid> [--esegui] [--pausa-ms N] [--massimo N]
```

Senza `--esegui` e' una simulazione (RENTRI non si contatta). Con `--esegui`: SOLA LETTURA verso l'ente
(`leggiFormulario`); mai `creaFormulario`, mai `acquisisciVisibilita` (e' una scrittura sull'ente: se la
visibilita' manca l'esito e' `VISIBILITA_NON_ACQUISITA` e si risolve a mano). Limite di frequenza:
pausa fra le chiamate (default 3 s, minimo 1 s), massimo per esecuzione (default 25, tetto 500), stop
al primo errore transitorio dell'ente. Un FIR riacquisito nasce senza provenienza e non bloccato (Q5);
un numero gia' presente nel database non si richiede. Uscite: 0 ok, 1 interrotto/falliti, 2 pacchetto o
utente rifiutati, 64 uso errato.

### Ambito `GIACENZE` (I6): giacenze iniziali al taglio

Fase `giacenze`, da `MOVIMENTI` + `[GIACENZE RIFIUTI]`: una riga per FAMIGLIA (registro WasteFlow, CER, stato
fisico) con la quantita' in kg al giorno di taglio della mappa (`dataTaglio`). Chiave legacy
`ditta|anno|GIACENZE|<registroId>|<CER 6 cifre>|<stato fisico o ->`. Record:
`{ legacyKey, registroId, cerCode, statoFisico|null, quantita (kg, 2 decimali, > 0), unita: "KG", dataRiferimento, origini: [{ anno, protocollo, quantita }] }`.
Il server rivalida tutto (schema chiuso, chiave coerente con registro/CER/stato fisico, registro della
mappa, origini senza duplicati, somma delle origini <= quantita', al piu' 200).

**Calcolo** (`domain/migrazione/winwaste/giacenze-taglio.ts`, indipendente da `GIASCAR`):

```
giacenza al taglio = righe NORMALI di [GIACENZE RIFIUTI] (RR, RL, DR, DL, DT)
                   - kg dei segmenti G e P degli scarichi fino al taglio (classe per classe, con la
                     compensazione di calcresgiac: R13 con R13, D15 con D15)
                   + carichi dell'anno fino al taglio aperti: netto - kg dei segmenti C degli scarichi
```

E' la «riga normale» del riporto d'anno (`AggGIACRIFIUTI`, `giacenze.md` §4.2) e dà lo stesso totale in
modalita' G e P del passaggio d'anno. Le righe di compensazione (`UL` che comincia per 8) NON si sommano
(contate: avviso `RIGHE_COMPENSAZIONE_NON_SOMMATE`): servono solo a distinguere in modalita' P i carichi
`P` ancora aperti, gia' dentro la riga normale.

- **Registro**: il MAGAZZINO WinWaste (`MAG` della giacenza; `MAG1` del carico T e X, `MAG2` del carico R/D;
  `MAG1` dello scarico per i segmenti G e P) tradotto da `mappa.registri[].legacy`. Magazzino non in mappa:
  scarto `GIACENZE MAGAZZINO_NON_IN_MAPPA` (contato, mai silenzioso).
- **Differenze `GIASCAR`**: per ogni carico, `GIASCAR` e' ricalcolato dalla somma dei segmenti `C` di
  `RELAZ`; una differenza >= 0,001 kg va nel rapporto di `prepara` (`differenza-giascar <COD> <GIASCAR> <ricalcolato>`)
  e nell'oggetto `differenzeGiascar`. Mai corretta in silenzio: il residuo caricato e' quello ricalcolato, le
  differenze vanno al cliente col rapporto sorgente. `GIASCAR` conta anche i segmenti `P` dell'anno successivo,
  che qui non si vedono: con un anno successivo gia' aperto una differenza puo' essere legittima.
- **Origini** (relazioni iniziali RENTRI, F2-9): anno e protocollo di ogni carico aperto (protocollo del
  registro della famiglia, altrimenti il primo con numero) con la sua quantita' residua. L'apertura che viene
  dalla riga normale non ha origini note (avviso `ORIGINI_APERTURA_NON_NOTE`); un carico senza protocollo
  `CARICO_SENZA_PROTOCOLLO`; oltre 200 origini la quantita' si carica e le origini si omettono
  (`ORIGINI_OLTRE_IL_LIMITE`).
- **Segnalati e non contati**: carichi dopo il taglio (`CARICO_DOPO_IL_TAGLIO`, sono di I7), carichi senza
  classe di giacenza (OPER 16, 26), operazioni ENTRAMBI (13, 15, 24: non si sa se creino giacenza), deposito
  del produttore `G0`/classe X (vive in `[Schede produttori]`, non nello staging), carico scaricato oltre il
  netto, residuo iniziale negativo non compensabile (`GIACENZA_INIZIALE_NEGATIVA`: non si carica a zero in
  silenzio), moda R/D non riconosciuta (scarto), quantita' sotto il centesimo (trascurate).
- I m³ non si portano (le aperture di WasteFlow non li tracciano).
- Colonne di provenienza su `giacenze_iniziali` (migration `20261123120000`): `import_source`, `legacy_key`,
  `lotto_import_id` immutabili; `provenienza = IMPORTAZIONE`; unico parziale sulla chiave legacy.

**Caricamento** (`inserisci-giacenze.ts`): stesso `--operatore` dei FIR (`impostato_da`), advisory lock di
scarico e servizio, CER del catalogo (con `*` se il catalogo lo ha; fuori catalogo = bloccante
`CER_NON_IN_CATALOGO`). Una giacenza MANUALE (o di altra provenienza) gia' presente sulla stessa famiglia
(kg e t sono la stessa famiglia) e' BLOCCANTE (`GIACENZA_GIA_PRESENTE_NON_IMPORTATA`) e, se la verifica fosse
saltata, fa FALLIRE il blocco senza scrivere nulla: non si sovrascrive e non si somma. La riesecuzione salta
le famiglie gia' importate con la stessa chiave. Dopo il caricamento lo scarico vede la giacenza
(`giacenza-disponibile.ts`) e il MUD la conta solo come giacenza al 31/12, non come prodotta o ricevuta.

FORME PRESUNTE (nessun `.bak`, da riverificare sul primo): il magazzino di un carico (`MAG1`/`MAG2` per
classe), il magazzino dei segmenti G/P, `SF` di `[GIACENZE RIFIUTI]` uguale a `FISI` dei movimenti.

### Regole di trasformazione (I4)

- **Duplicati segnalati, mai fusi in silenzio**: `DITTA_DUPLICATA` (stessa P.IVA o CF), `TARGA_DUPLICATA`,
  `CHIAVE_DUPLICATA` (AUTOMEZZI non ha PK), `SEDE_DUPLICATA`. Il rapporto riporta la chiave scartata e
  quella tenuta (chiavi WinWaste, mai P.IVA, CF o nomi).
- **Sedi**: la sede legale viene da `SEDI LEGALI` (se c'e') altrimenti dall'indirizzo di `CLIFOR`;
  la seconda sede di `CLIFOR` (`IND2`...) e' `S2`; ogni `UNITA LOCALI` e' una sede con la sua UL.
  Servono via, comune, CAP (5 cifre) e provincia (2 lettere); il civico mancante diventa `SNC`. Un
  indirizzo incompleto non si inventa: `SEDE_LEGALE_INCOMPLETA` / `INDIRIZZO_INCOMPLETO` (la ditta entra,
  la sede no). Senza sede legale la prima unita' locale e' la principale (avviso `SEDE_PRINCIPALE_DEDOTTA`).
- **Ruoli dedotti**: produttore/trasportatore/destinatario da come il soggetto compare in `PROD`/`TRAS`/
  `SMAL` di `MOVIMENTI` e `FORMULARI`. Il numero di iscrizione/autorizzazione (obbligatorio in
  WasteFlow) e' quello della riga `AUTORIZZAZIONI` piu' usata nei movimenti (`AUTT`/`AUTS`); senza
  numero il ruolo non si crea (`NUMERO_ASSENTE`). Senza `MOVIMENTI` ne `FORMULARI` nessun ruolo si
  inventa (`RUOLI_NON_DEDUCIBILI`). `INTE` (intermediario) non ha un modello: `INTERMEDIARIO_SENZA_MODELLO`.
  Un soggetto che compare come cliente e fornitore con P.IVA diverse (stesso `COD`) e' `SOGGETTO_AMBIGUO`:
  non si indovina.
- **Unita' locali dell'azienda stessa** (sito `X<sede>.<ul>`, VERSIS XRENTRI): non sono anagrafiche, non
  diventano sedi, ruoli ne destinatari (`UNITA_LOCALE_PROPRIA`); vanno nella mappa (`unitaLocali`).
- **Automezzi**: targa normalizzata (`^[A-Z0-9]{2,15}$`), tara in kg come tara DICHIARATA. I rimorchi
  (`RIMORCHIO` valorizzato) non si importano come automezzi (`RIMORCHIO_NON_IMPORTATO`): la coppia
  motrice/rimorchio e' per movimento e la ricostruira' I5/I7. Il proprietario e' il ruolo trasportatore
  del soggetto; il parco proprio (e i proprietari senza ruolo) restano senza trasportatore (avvisi
  `PROPRIETARIO_*`). `creato_da` e' l'operatore del lotto o, senza, l'utente tecnico
  `00000000-0000-4000-8000-000000000002` (diverso dall'id della piattaforma).
- **Mai dati personali nella mappa**; nel pacchetto sono in chiaro (vedi sopra). `NOM`/`COG`
  (referente) delle unita' locali NON si importano.
- **Forma presunta** (da riverificare sul primo `.bak`): `PRECOD` di `UNITA LOCALI` = soggetto
  (6 caratteri, o 7 con il C/F davanti); `PRECOD` di `AUTORIZZAZIONI`/`AUTOMEZZI` e `PROD`/`TRAS`/`SMAL` =
  `soggetto.unita'`; `RIMORCHIO` vuoto/`0`/`N` = motrice; `AUTORIZZAZIONI.COD` = valore di `AUTP`/`AUTT`/`AUTS`.

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
  "tenantId": "<uuid dell'azienda di WasteFlow>",
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
- `tenantId` lega la mappa a UNA azienda: con `--tenant` diverso `migrazione:carica` (anche `--verifica`) esce 2 con `BLOCCANTE TENANT_DIVERSO` senza leggere nulla dell'altra azienda.
- La data di taglio e' `AAAA-MM-GG` e deve cadere nell'anno della mappa.

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
node dist/cli/migrazione-carica.js --tenant <uuid> --pacchetto <cartella> --ambito <AMBITO> [--operatore <uuid>] [--verifica] [--dimensione-blocco N]
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
confermate; agganci esistenti con quella P.IVA; **azienda (tenant) della mappa esistente** (`TENANT_INESISTENTE`:
l'import non crea mai aziende, si usa il flusso `admin/tenants`); collisioni di P.IVA e codice fiscale
con ditte non agganciate; **targhe gia' in azienda e non importate** (`TARGA_GIA_PRESENTE_NON_IMPORTATA`); lotto gia' `IN_CORSO` per (archivio, ambito); record non validi. Per l'ambito FIR anche
l'operatore, le ditte e le sedi gia' caricate e le collisioni di `firNumber` (vedi sopra). Le collisioni
dei progressivi si aggiungono con I7.

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
contiene quella dello staging e quella della mappa). Poiche' il pacchetto si cancella, a fine
caricamento la CLI stampa `hashStaging`, `hashMappa` e `hashManifest`: vanno registrati col rapporto
di destinazione, e `manifest.json` e `mappa-import.json` (senza dati personali per costruzione)
si conservano. Cosi' si puo' dimostrare quale staging e quale mappa hanno prodotto il lotto.

## Controlli prima del lotto

`migrazione:carica` esegue sempre, in sola lettura e prima di aprire il lotto, gli stessi controlli
di `--verifica` (tenant della mappa, riferimenti della mappa, collisioni con ditte esistenti,
duplicati di P.IVA o codice fiscale dentro il pacchetto `DUPLICATO_NEL_PACCHETTO`): con un
bloccante esce 2 senza lotto. `prepara` scarta le righe CLIFOR che condividono P.IVA o codice
fiscale con una gia' scritta (`DITTA_DUPLICATA`).
