# Fase 4 pezzi 9c-9f: CONOU, COBAT, O.R.SO. dettagliata, O.R.R. Campania — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta, opus rivede ogni task prima del successivo. Quattro PR: **A** (fondamenta comuni) prima di
> tutto; poi **B** (4.9c + 4.9d), **C** (4.9e) e **D** (4.9f) in tre worktree separati, che possono
> avanzare in parallelo perché A porta l'unica migration. I comandi pesanti (jest completo, Karma,
> Postgres, e2e) restano **uno alla volta** sulla macchina (16 GB di RAM): il parallelo è fra branch,
> non fra processi. Vedi «Ordine e PR» in fondo.

**Obiettivo.** Produrre dai movimenti del registro quattro comunicazioni che WinWaste genera e
WasteFlow non ha ancora:

- **4.9c CONOU** (oli minerali usati): file `Movi.txt`, testo a larghezza fissa, 299 caratteri per
  movimento, dai movimenti marcati CONOU (4.9b).
- **4.9d COBAT** (batterie): file `Movcob.txt`, record fissi da 1409 caratteri più una coda di 219,
  dai movimenti marcati COBAT (4.9b).
- **4.9e O.R.SO. modalità dettagliata**: lo stesso XML `ImpiantoMesi` di 4.9a, ma con il dettaglio
  per soggetto (`ts` = `I`, `C`, `Inew`) e i nodi `NuovoImpianto`.
- **4.9f O.R.R. Campania**: file `.txt` con record da 718 caratteri, uno per unità locale e per tipo
  di attività (trasportatore, stoccaggio, smaltimento, recupero, frantumatore, rottamatore,
  autodemolitore), dai movimenti della sede.

Ogni comunicazione si scarica e si carica a mano sul portale (D5 = a della 4.9), con «segna inviata»
e «dati modificati dopo l'invio» come in 4.9a.

**Decisione di Graziano (14/11).** Si costruiscono 4.9c, 4.9d, 4.9e e 4.9f adesso, senza un file
reale e senza la specifica ufficiale. Quindi:

1. ogni export ricavato da WinWaste è marcato **nell'interfaccia e nel manifest** come «tracciato
   ricavato da WinWaste, da confermare con un file reale»;
2. i difetti di WinWaste (es. COBAT, `tlegrap`/`tnolegrap` del trasportatore) **si correggono**, non
   si copiano, con una nota nel codice e nel manifest;
3. le inferenze (code page, nome file, unità di misura, progressivi) diventano **costanti o
   parametri isolati e documentati**, ognuno con un test che lo nomina;
4. i test usano **golden file sintetici** costruiti dai tracciati, non da un file reale;
5. il piano elenca cosa ri-verificare all'arrivo di un file reale o della specifica (sezione
   «Da ri-verificare con un file reale»).

**Architettura in breve.**

- **Dominio puro** (`domain/comunicazioni/`): un modulo per tracciato (`conou/`, `cobat/`, `orr/`) più
  `orso/` esteso; un modulo comune `fisso/` per i campi a larghezza fissa e la codifica Windows-1252;
  `regioni-istat.ts` (codice numerico e lettera di WinWaste). Ogni tracciato implementa
  `TracciatoComunicazione` e si registra in `registro-tracciati.ts`.
- **Tre tabelle laterali nuove, con RLS** (PR A, unica migration): dati del tracciato per movimento,
  dati per le comunicazioni delle sedi delle ditte (controparti), configurazione delle comunicazioni
  per sede propria. Nessuna colonna nuova su `waste_movements`, `fir`, `ditte`, `sedi_ditte`.
- **Un servizio generico** «comunicazione a tracciato» (anteprima, genera, file, manifest, segna
  inviata) sopra `ComunicazioneConsorzio` di 4.9a; CONOU, COBAT e O.R.R. vi si agganciano con un
  «preparatore» ciascuno. O.R.SO. dettagliata resta nel servizio O.R.SO. di 4.9a, con un parametro di
  modalità.
- **Modulo commerciale:** lo stesso `comunicazioni` (D4 = a della 4.9). Nessuna chiave nuova.

**Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE), Angular + PrimeNG, `xmllint-wasm`
5.3.0 (già in `devDependencies` per l'XSD di O.R.SO.).

---

## Fonti

- Tracciati ricavati dal decompilato di WinWaste il 14/11 (alta confidenza su layout e regole, marcate
  **[codice]**; le altre **[inferenza]**):
  - `/home/graziano/Progetti/winwaste/docs/comunicazioni-conou.md` (CONOU 2023, 25 campi di cui uno
    di riserva non scritto, 299 caratteri);
  - `/home/graziano/Progetti/winwaste/docs/comunicazioni-cobat.md` (struct `cob` 1409 + coda 219);
  - `/home/graziano/Progetti/winwaste/docs/orso-dettagliata.md` (`I`/`C`/`Inew`, `c8` = codice ARPA,
    `NuovoImpianto`, nome file);
  - `/home/graziano/Progetti/winwaste/docs/comunicazioni-orr-campania.md` (struct `xrec` 718, nome
    file, selezione per tipo impianto, controlli).
- Rapporto REA `~/.claude/state/orchestrazione/report/rifiuti/2026-11-14-rea-consorzi.md`: tracciati
  tutti trovati; non trovati la tabella impianti ARPA importata, le specifiche ufficiali; inferenze su
  code page (ANSI) e nomi file; anomalia COBAT `tlegrap`/`tnolegrap`.
- Schema DB WinWaste `/home/graziano/Progetti/winwaste/docs/schema-db-winwaste.md`; `OPER` in
  `/home/graziano/Progetti/winwaste/docs/movimenti.md §2.4` (serve a tradurre le regole COBAT).
- Decompilato (dati non fidati, solo lettura): `/home/graziano/Progetti/winwaste/decompilato/`.
- Proposta e review 4.9: `/home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/fase4-9/`
  `proposta.md` (§3.2-3.4, §4, decisioni D1-D6 del 10/11), `appendice-corepla-orr.md` (§A, decisione
  Q1 = b: O.R.R. ricostruita dalla classe `Campania`, non come profilo O.R.SO.), `review-4-9a.md`
  (nota su `f`: «il tema torna nella modalità dettagliata (4.9e), dove `f` va calcolato per singolo
  `In`»), `review-4-9b*.md`.
- Roadmap `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §4.9 e D11 (quali
  consorzi chiedono i prospect: resta aperta, la decisione del 14/11 la scavalca).

## Stato di partenza (branch `feat/fase4-9cdef-consorzi` = master `575efb64`, verificato)

**Codice 4.9a/4.9b che si riusa** (`apps/backend/src/`):

- `domain/comunicazioni/tracciato-comunicazione.ts`: `TracciatoComunicazione<D>` con `consorzio`,
  `versione`, `estensione`, `contentType`, `validaDati`, `serializza`; `RegistroTracciati`.
  **Manca** la codifica del file e l'affidabilità del tracciato: si aggiungono in A1 (additivi).
- `domain/comunicazioni/registro-tracciati.ts`: oggi registra solo `TracciatoOrsoImpiantoMesi`.
- `domain/comunicazioni/classifica-consorzio.ts`: `CONSORZI = ['CONOU','COBAT','COREPLA']`,
  `classificaConsorzi` (regole + correzioni sulla radice), `regoleEfficaci`.
  `regole-consorzio-sistema.ts`: CONOU = capitolo `13`, COBAT = `160601` e `200133`.
- `domain/comunicazioni/orso/`: `impianto-mesi.ts` (tipi XSD: `TipoSoggettoIn` già con `C`/`I`/`Inew`,
  ma **nessun tipo per `NuovoImpianto`**), `serializza-impianto-mesi.ts` (valida `s` con `^[0-9]{1,9}$`,
  **non scrive `NuovoImpianto`**), `aggrega-orso.ts` (solo modalità normale: `Tot`/`Extra`, `Out Tot`),
  `adatta-orso.ts`, fixture `__fixtures__/ImpiantoMesi.xsd` (contiene `tNuovoImpianto`, `tIndirizzo`).
- `application/comunicazioni/`:
  - `lettore-movimenti-orso.ts` (`leggiMovimentiOrso`): movimenti vigenti (`WHERE_VIGENTE`) dei registri
    di una sede o dei registri senza sede, con kg, ruolo MUD, operazione, `firNumero`, provincia del
    conferitore. Legge del FIR solo `firNumber`, `producerSedeId`, operazione.
  - `comunicazioni-orso.service.ts`: anno intero, hash dei dati (`hashDatiOrso`), idempotenza per hash,
    `file()` che restituisce `{ nomeFile, xml }`, `segnaInviata` atomica.
  - `estratto-consorzi.service.ts`: per consorzio e periodo, legge per sede con `leggiMovimentiOrso` e
    classifica con `MarcaturaConsorziService.classifica` (una lettura delle regole per estratto). È lo
    schema da seguire per selezionare i movimenti marcati.
  - `marcatura-consorzi.service.ts`: `impostaOverride` fa **upsert** di una riga in
    `dati_consorzio_movimento`; `rimuoviOverride` la **cancella**; `classifica` tratta **ogni riga** di
    quella tabella come correzione manuale.
- `api/comunicazioni/comunicazioni.controller.ts`: `GET orso/anteprima`, `POST orso`, `GET /`,
  `GET :id/file` (header fisso `application/xml; charset=utf-8`), `POST :id/inviata`; tutto con
  `@RichiedeModulo('comunicazioni')`. `marcatura-consorzi.controller.ts`: regole, movimenti, estratto.
- Frontend `apps/frontend/src/app/features/comunicazioni/`: pagina O.R.SO., `regole-consorzi`,
  `marcatura-movimento`. e2e `e2e/tests/comunicazioni/orso.spec.ts`.

**Schema** (`apps/backend/prisma/schema.prisma`):

- `ComunicazioneConsorzio` (`comunicazioni_consorzi`): `consorzio` varchar(20) con solo CHECK «non
  vuoto» (quindi `CONOU`, `COBAT`, `ORR` entrano senza migration), `unitaLocaleId` **obbligatorio**,
  `periodoDa`/`periodoA` date, `tracciato` varchar(40), `versione` varchar(20), `contenuto` **text**,
  unico di idempotenza su (tenant, consorzio, sede, periodo, tracciato, versione, hash).
  `ComunicazioneConsorzioMovimento`: istantanea dei movimenti con kg.
- `DatiConsorzioMovimento` (`dati_consorzio_movimento`): ha già `dati` jsonb e `versione_schema`
  («per i tracciati futuri (4.9c/4.9d)»), ma **una riga qui = correzione manuale** (vedi sopra).
  Scrivere `dati` per un movimento marcato da una **regola** lo trasformerebbe in marcatura manuale, e
  togliere la correzione cancellerebbe i dati. Quindi i dati dei tracciati vanno in una tabella propria
  (D2).
- FIR (`FIR`): `firNumber`, `transportDate`, `actualArrivalDate`, `producerSedeId`, `receiverSedeId`
  (snapshot senza FK), `producerCodiceFiscale`/`carrierCodiceFiscale`/`receiverCodiceFiscale`,
  `*PartitaIva`, `*Name`, `*Address`, `carrierId`, `receiverId`, `carrierVehiclePlate`,
  `wasteOperationCode`; `FIRTransporter` (`codiceFiscale`, `numeroIscrizioneAlbo`, `mezzo`). Il
  trasportatore non ha sede sul FIR: la sede si ricava da `Trasportatore.sedeId` via `carrierId`.
- `Ditta` (ragione sociale, P.IVA, CF) e `SedeDitta` (via, civico, CAP, comune **come testo**,
  provincia sigla, telefono). **Mancano** per le controparti: ATECO, ISTAT del comune, «è un comune»,
  codice ARPA, data e classi dell'iscrizione all'Albo, data dell'autorizzazione, legale rappresentante.
- `Trasportatore.numeroIscrizione`, `Destinatario.numeroAutorizzazione` (+ scadenze), senza data di
  rilascio né classi.
- `RentriUnitaLocale` (sede propria): indirizzo, civico, CAP, comune (testo), provincia,
  `progressivoMud`. `Tenant`: P.IVA, CF, `atecoCode`, legale rappresentante. `AutorizzazioneImpianto`
  è per azienda (estremi, `dataRilascio`), non per sede.
- Riferimenti ISTAT: `IstatComune` (code 6, name, provinciaSigla), `IstatProvincia` (sigla, code 3,
  **`regione` come nome**, non come codice).
- RLS: `rls-catalogo.postgres.spec.ts` si aspetta **84** tabelle con `tenant_id`; `prisma-rls.extension.ts`
  elenca i modelli per azienda (`RegolaConsorzio`, `DatiConsorzioMovimento` alle righe 148-149).
  Ultima migration: `20261113100100_pese_agenti`.
- Codifica: `application/fatturazione/adattatori/teamsystem.adattatore.ts` scrive in `latin1`
  dichiarando `windows-1252` (non sono la stessa cosa da 0x80 a 0x9F: `€`, `‘ ’ “ ”`, `–`). Non si
  riusa: serve un codificatore Windows-1252 vero (D6). `iconv-lite` c'è solo come dipendenza
  transitiva: non la si usa.

## Corrispondenza dei dati WinWaste → WasteFlow

Legenda: **ok** = c'è già; **nuovo** = dalle tabelle di A2; **manca** = non esiste, campo vuoto con
avviso o fuori ambito.

### CONOU (riga di 299)

| Campo WinWaste | Fonte in WasteFlow | Stato |
|---|---|---|
| 0 CF detentore/destinatario | carico: FIR `producerCodiceFiscale` (o `Ditta.codiceFiscale` della sede `producerSedeId`); scarico: lato `receiver` | ok (FIR); senza FIR: manca, bloccante |
| 1-7 CAP, P.IVA, ragione sociale, indirizzo, civico, provincia, comune | `SedeDitta` della sede del FIR, `Ditta` | ok |
| 8 ATECO (`NN.NN.NN`; `0000` se privato) | `anagrafica_comunicazioni_sede.codice_ateco` della sede controparte | **nuovo**, bloccante se manca (come WinWaste) |
| 9 ISTAT 9 = `0` + regione 2 cifre + comune 6 | `IstatComune` risolto da comune+provincia, oppure `codice_istat_comune` della tabella nuova; regione da `IstatProvincia.regione` → `regioni-istat.ts` | ok + **nuovo** (forzatura) |
| 11 codice deposito (3-10 car.) | `configurazione_comunicazione_sede` (CONOU, `codiceDeposito`) | **nuovo**, bloccante |
| 12 data registrazione | `movementDate` (giorno di Roma) | ok |
| 13-15 serie, numero, anno formulario | parser puro di `FIR.firNumber`, con forzatura nei dati del movimento | ok + **nuovo** |
| 16 data formulario | `FIR.transportDate` | ok |
| 17 CF trasportatore | `FIR.carrierCodiceFiscale` (o `FIRTransporter` ordine 1) | ok |
| 18 targa | `FIR.carrierVehiclePlate`, spazi tolti, ≤ 8 | ok |
| 19 CER | `cerCode` (sole cifre) | ok |
| 20 percentuale olio ×100 | `dati_tracciato_movimento` CONOU (`percentualeOlio`) o predefinito per CER della sede | **nuovo** |
| 21 protocollo registro | numero progressivo del movimento nel registro (`progressiveNumber`) | ok [inferenza: in WinWaste è `PROT1`] |
| 22 quantità kg con segno | `kg` del lettore, negata per scarico interno | ok |
| 23 prodotto `A B C E G` | dati del movimento, o predefinito per CER, o unico ammesso dalla tabella CER → prodotti (`OLIOtiporif`) | **nuovo** |
| 24 causale `B E U M D L` | derivata (carico → `E`, scarico → `U`) con forzatura nei dati del movimento | ok + **nuovo** |

### COBAT (record 1409 + coda 219)

| Campo | Fonte | Stato |
|---|---|---|
| `dtreg`, `dtfor`, `dtcon` | `movementDate`, `FIR.transportDate`, `FIR.actualArrivalDate` (vuota → `dtreg`) | ok |
| `progdta` (6) | **inferenza isolata** (D9, domanda Q1): WinWaste smette al 2025 | parametro |
| `codazi` (16) | CF (o P.IVA) del soggetto esterno, precedenza destinatario > trasportatore > produttore | ok |
| `tipmov`, `causa` | funzioni pure da verso, ruolo MUD, operazione R/D, trasportatore esterno (D10) con forzatura | ok + **nuovo** |
| `targa` | `FIR.carrierVehiclePlate` | ok |
| `targa1` (rimorchio), `autist` | non esistono | manca: spazi, avviso informativo |
| `bolla` | `FIR.firNumber` (20) | ok |
| `codcer`, `pgfcer`, `pgf` | `cerCode`; PGF/tipologia `A..E` dai dati del movimento | **nuovo** |
| `quam3`, `quaton` | m³ se l'unità è di volume (altrimenti 0), t = kg/1000, 7 decimali | ok |
| blocchi `p`/`t`/`s`/`c` (sede legale) | `Ditta` + `SedeDitta` principale; `codreg` lettera da `regioni-istat.ts`; `codcom` ISTAT 6 | ok + **nuovo** (ISTAT, «comune S/N», legale rappresentante) |
| blocchi `x`/`y` (unità locale) | `SedeDitta` del FIR (`producerSedeId`/`receiverSedeId`); per noi `RentriUnitaLocale`; `codatt` = ATECO 6 cifre | ok + **nuovo** |
| blocco `c` (intermediario) | il FIR non ha intermediario | manca: spazi |
| coda: campagna (2) + descrizione (30) | dati del movimento o predefinito della sede (`00`) | **nuovo** |

### O.R.SO. dettagliata

| Elemento | Fonte | Stato |
|---|---|---|
| `In ts="I" s=<codice ARPA>` | `anagrafica_comunicazioni_sede.codice_orso` della sede del conferitore (FIR `producerSedeId`) | **nuovo** |
| `In ts="C" s=<ISTAT 6>` | `e_comune = true` + ISTAT del comune | **nuovo** |
| `In/Out ts="Inew" s=<n>` + `NuovoImpianto` | `Ditta`/`SedeDitta` (ragione sociale, CF/P.IVA, indirizzo SL e UL, ISTAT provincia 3 + comune 3) | ok |
| `f` per singolo `In` | 1 se almeno un movimento di quel soggetto nel nodo ha il FIR | ok |
| `Out ts="I"` (destinatario) | come sopra; un comune in uscita non è ammesso dall'XSD (`tTipoSoggettoOut` = `I`, `Inew`, `Tot`) → `Inew` | ok |

### O.R.R. Campania (record 718)

| Sezione | Fonte | Stato |
|---|---|---|
| A anno, mese, formulario (15), data, tipo dichiarante | movimento, FIR, attività del file | ok |
| B CER, quantità `kg × 1000` su 11 cifre, destinazione (`R13`, `D15`…) | `kg`, `operationCode`/operazione | ok; unità **inferenza** (D9) |
| C detentore (privato, ragione sociale, CF/P.IVA, indirizzi SL e UL, CAP, ISTAT, ATECO, `PRO`/`STO`) | `Ditta`/`SedeDitta` del produttore + tabella nuova | ok + **nuovo** |
| D trasportatore + Albo (data iscrizione, numero, classi) | FIR carrier, `Trasportatore.numeroIscrizione` / `FIRTransporter.numeroIscrizioneAlbo`; data e classi dalla tabella nuova | ok + **nuovo** |
| E destinatario + autorizzazione (data, numero) + tipo impianto | FIR receiver, `Destinatario.numeroAutorizzazione`; data dalla tabella nuova; se il destinatario siamo noi: `AutorizzazioneImpianto` scelta nella configurazione della sede | ok + **nuovo** |
| attività per movimento (`STO`, `SMA`, `REC`, `FRA`, `ROT`, `AUT`) | tipo impianto della sede (configurazione) + operazione R/D; `FRA`/`ROT`/`AUT` per movimento nei dati del tracciato | **nuovo** |

## Difetti e stranezze di WinWaste da NON copiare

1. **COBAT, trasportatore:** `tlegrap`/`tnolegrap` riempiti con descrizione e ISTAT dell'unità locale
   invece di cognome e nome (`ComuCou:2388-2389`). Si scrivono cognome e nome del legale rappresentante
   come per gli altri blocchi (vuoti se non noti). Nota nel codice (`// Differenza voluta da WinWaste`)
   e nel manifest.
2. **COBAT, progressivo:** la formula `base + movimenti.cod` è definita solo fino al 2025 («ERRORE 245»
   dopo) e non è unica oltre 100 000 movimenti (`Debugger.Break` inerte). Non si copia: D9 e Q1.
3. **COBAT, `codazi`:** «vince l'ultimo» per effetto dell'ordine di valutazione. Si rende esplicita la
   precedenza (destinatario > trasportatore > produttore) e la si testa; il risultato è lo stesso.
4. **CONOU, `OLIOtiporif`:** tabella CER → prodotti definita e mai usata. Qui si usa per validare il
   prodotto e proporre il predefinito.
5. **CONOU, istat di 3 caratteri** «esportato lo stesso» su conferma: qui è bloccante (niente file con
   errori noti).
6. **O.R.R., quirk di riempimento** (`c3Cf` a 4, `c10CAP` a 45) senza effetti: il serializzatore usa la
   lunghezza del campo e basta.
7. **Tutti:** valori vuoti sostituiti da **uno** spazio e poi riempiti: equivale a un campo di spazi,
   lo si scrive così direttamente.
8. **Tutti:** concatenazioni di testo per le query SQL e scrittura su file temporaneo con copia: qui solo
   Prisma parametrizzato e risposta HTTP in memoria.
9. **Tutti:** nessun controllo dei caratteri non rappresentabili nella code page: qui un carattere fuori
   da Windows-1252 diventa avviso bloccante con il movimento e il campo (D6).

## Inferenze isolate (costanti o parametri)

Ogni voce ha un nome, un file, un commento `// INFERENZA (WinWaste, 14/11): …` e un test che la nomina,
così all'arrivo di un file reale si cambia in un punto solo.

| Nome | File | Valore | Base |
|---|---|---|---|
| `CODIFICA_CONOU`, `CODIFICA_COBAT`, `CODIFICA_ORR` | `conou/costanti.ts`, `cobat/costanti.ts`, `orr/costanti.ts` | `windows-1252` | `PrintLine`/`FilePut` VB6 = ANSI di sistema |
| `FINE_RIGA_*` | idem | `\r\n` | idem |
| `NOME_FILE_CONOU` | `conou/costanti.ts` | `Movi.txt` | `ComuCou_Load:1672` |
| `NOME_FILE_COBAT` | `cobat/costanti.ts` | `Movcob.txt` | `ComuCou_Load:1665` |
| `nomeFileOrr()` | `orr/nome-file.ts` | `<prov><ul4><mese2><aa><attività>.txt` | `Campania:nomefile`; esempio solo ricostruito |
| `codiceUnitaLocaleOrr()` | `orr/nome-file.ts` | `progressivoMud` a 4 cifre | WinWaste usa la parte dopo il punto del codice `ul`: in WasteFlow non esiste |
| `MOLTIPLICATORE_QUANTITA_ORR` | `orr/costanti.ts` | `1000` (kg → g) | `b2 = netto × 1000`, unità non verificata |
| `progressivoCobat()` | `cobat/progressivo.ts` | D9 | formula WinWaste ferma al 2025 |
| `REGIONE_LETTERA` | `regioni-istat.ts` | `A01 B02 C07 D03 E04 F05 G06 I08 L11 M09 N10 O12 P15 Q13 R14 S16 T17 U18 V19 Z20` | tabella `PROVINCE.REG` di WinWaste |
| `PERCENTUALE_OLIO_MASSIMA` | `conou/costanti.ts` | `9999` (4 cifre ×100) | il vecchio tracciato fermava a 8499; il 2023 non ha limite nel codice |
| `CODA_COBAT_DOPO_2009` | `cobat/costanti.ts` | 185 spazi + 32 + CRLF | anni ≤ 2009 fuori ambito |
| `ATECO_PRIVATO_CONOU` | `conou/costanti.ts` | `0000` | `tipaz='P'` |

## Decisioni (vincolanti)

- **D1. Selezione dei movimenti.** CONOU e COBAT: movimenti vigenti dei registri della sede nel periodo,
  marcati dal classificatore 4.9b (regole + correzioni), come `EstrattoConsorziService`. O.R.SO.
  dettagliata e O.R.R.: tutti i movimenti vigenti della sede (nessuna marcatura), come 4.9a.
  Rettifiche e annullamenti seguono `WHERE_VIGENTE`.
- **D2. Dati del tracciato per movimento in una tabella nuova** `dati_tracciato_movimento` (tenant,
  registro, verso, `movimento_originale_id` = radice, `tracciato` ∈ `CONOU`/`COBAT`/`ORR`, `dati` jsonb,
  `versione_schema` smallint, chi/quando). Unico su (tenant, radice, tracciato). FK composta verso
  `waste_movements` come `dati_consorzio_movimento`. **Non** si usano `dati_consorzio_movimento.dati`:
  quella riga è una correzione manuale della marcatura (vedi «Stato di partenza»). Le colonne `dati` e
  `versione_schema` di 4.9b restano NULL; il commento nello schema Prisma si aggiorna («superato da
  `DatiTracciatoMovimento`, 4.9c»). Non entra nell'`entryHash`, non tocca `waste_movements`.
- **D3. Dati delle controparti in una tabella nuova** `anagrafica_comunicazioni_sede` (una riga per
  `SedeDitta`, FK composta con tenant), colonne tipizzate con CHECK:
  `e_comune` bool, `codice_istat_comune` varchar(6) (forzatura della risoluzione per nome),
  `codice_ateco` varchar(8) (`NN.NN.NN` o 6 cifre), `codice_orso` varchar(9) (`^[0-9]{1,9}$`),
  `albo_data_iscrizione` date, `albo_classi` varchar(30), `autorizzazione_data` date,
  `legale_rappresentante_cognome`/`_nome` varchar(25), `esclusa_orr` bool (equivale a `c9 LIKE '%E\C%'`).
  Serve a 4.9c, d, e, f: per questo sta nella PR A. Nessuna colonna nuova su `sedi_ditte`.
- **D4. Configurazione per sede propria in una tabella nuova** `configurazione_comunicazione_sede`
  (tenant, `unita_locale_id`, `consorzio` ∈ `CONOU`/`COBAT`/`ORSO`/`ORR`, `dati` jsonb validato da uno
  schema Zod per consorzio, `versione_schema`). Unico su (tenant, sede, consorzio). Contenuti:
  - CONOU: `codiceDeposito` (3-10), `predefinitiPerCer` (CER → prodotto, percentuale);
  - COBAT: `campagnaPredefinita` (codice 2, descrizione 30), `pgfPerCer`;
  - ORSO: `modalita` (`NORMALE` | `DETTAGLIATA`, predefinita `NORMALE`);
  - ORR: `tipoImpianto` (`STO`, `SMA`, `REC`, `R/S`, `AUT`, `ROT`, `FRA`), `autorizzazioneImpiantoId`,
    `atecoProduttoreMancanteComeZero` (l'`atec00` di WinWaste), `usaAutorizzazioniPredefinite` (`sino`).
- **D5. Una sola migration additiva**, nella PR A, per le tre tabelle (B, C, D non toccano lo schema):
  `20261114130000_comunicazioni_tracciati`. RLS ENABLE + FORCE, policy `isolamento_azienda` e
  `sola_lettura`, conteggio `rls-catalogo` 84 → 87, modelli in `prisma-rls.extension.ts`.
- **D6. Codifica Windows-1252 propria e pura** (`domain/comunicazioni/fisso/codifica-cp1252.ts`): mappa
  dei 27 caratteri di 0x80-0x9F più Latin-1; `rappresentabile(testo)` e `codifica(testo): Buffer`. Prima
  di serializzare si normalizza (NFC, spazi multipli, controlli tolti); un carattere non rappresentabile
  è un avviso **bloccante** con movimento e campo. Nessuna dipendenza nuova. Il contenuto resta salvato
  come testo in `comunicazioni_consorzi.contenuto`; si codifica allo scaricamento.
- **D7. Il contratto dei tracciati si estende in modo additivo:** `TracciatoComunicazione` riceve
  `codifica: 'utf-8' | 'windows-1252'` e `affidabilita: 'UFFICIALE' | 'RICAVATO_WINWASTE'` più
  `notaAffidabilita: string`. O.R.SO. normale = `UFFICIALE`; dettagliata = `UFFICIALE` (XSD ufficiale)
  con nota «identificazione dei soggetti ricavata da WinWaste»; CONOU, COBAT, O.R.R. =
  `RICAVATO_WINWASTE`. Versioni: `Movi2023-ww1`, `Movcob-ww1`, `xrec718-ww1` (il suffisso `ww` dice che
  vengono da WinWaste; la conferma su file reale produrrà `-1` senza `ww`).
- **D8. Marcatura «da confermare» in tre punti:** (a) banner fisso nella scheda del tracciato e
  etichetta nello storico; (b) **manifest** scaricabile accanto al file (`GET :id/manifest`, testo UTF-8:
  tracciato, versione, affidabilità, nota, hash, periodo, sede, numero record, avvisi non bloccanti,
  differenze volute da WinWaste, inferenze usate); (c) campo `affidabilita` nella `ComunicazioneVista`.
  **Nel file non si scrive nulla di estraneo** (un commento romperebbe un tracciato a larghezza fissa).
- **D9. COBAT, progressivo** (`progdta`, 6 cifre): proposta Q1 = progressivo del movimento nel registro
  (`progressiveNumber`), unico per anno e registro; se due registri della stessa sede entrano nello
  stesso file, numerazione 1..n nell'ordine del file; oltre 999 999 avviso bloccante. Funzione isolata.
- **D10. COBAT, `tipmov` e `causa` tradotti dalle `OPER` di WinWaste** (`movimenti.md §2.4`) in termini
  WasteFlow, funzione pura con tabella esplicita e forzatura per movimento:
  - carico, ruolo `PRODOTTO` → `2` (WW 10, 22);
  - carico, ruolo `RICEVUTO_DA_TERZI` → `3`, oppure `6` se il trasportatore non siamo noi (WW 20);
  - scarico, ruolo `AVVIATO` → `4`, oppure `7` se il trasportatore non siamo noi (WW 11-13, 15, 16,
    23, 24, 26, 28);
  - scarico a trattamento interno → `5` (WW 14, 21, 25, 27) solo per forzatura (il registro non lo
    distingue in modo affidabile);
  - trasporto conto terzi → `1` (WW 30) solo per forzatura;
  - `causa`: carico di produzione → `2`; operazione `R*` → `5`; `D1 D3 D4 D5 D6 D7 D12` → `3`;
    `D2 D8 D9 D10 D11 D13 D14` → `4`; `D15` → `1`; altrimenti spazio con avviso.
  «Trasportatore siamo noi» = CF o P.IVA del vettore del FIR uguale a quelli del `Tenant`.
- **D11. CONOU, causale e segno:** carico → `E`, scarico → `U`; `B`, `M`, `L`, `D` solo per forzatura
  nei dati del movimento; `scaricoInterno: true` nega la quantità. La sostituzione «bonifica» di
  WinWaste (detentore → comune di raccolta) si fa solo con forzatura esplicita (`causale = 'B'` +
  `comuneRaccolta` ISTAT + indirizzo), mai dedotta.
- **D12. O.R.SO. dettagliata come modalità della stessa comunicazione O.R.SO.** (stesso consorzio
  `ORSO`, stesso XSD), tracciato `ImpiantoMesi` con versione `1-dettagliata`; la modalità si sceglie
  nella configurazione della sede (D4) e l'anteprima la mostra. Resta **annuale** come 4.9a (WinWaste
  lavora a mesi interi; O.R.SO. accetta l'anno con i mesi come nodi). Soggetti:
  - conferitore/destinatario = sede del FIR (`producerSedeId` per i carichi, `receiverSedeId` per gli
    scarichi); senza sede sul FIR → avviso bloccante `SOGGETTO_NON_IDENTIFICATO` con i movimenti;
  - `e_comune` → `C` + ISTAT 6 (solo `In`); `codice_orso` valorizzato → `I`; altrimenti `Inew` con
    progressivo 1..n per prima comparsa nell'ordine del file e nodo `NuovoImpianto`;
  - `Extra` non si scrive in modalità dettagliata [da verificare sulla guida v2.5 al task E1].
- **D13. O.R.R., un file per (sede, attività)**: una riga di `comunicazioni_consorzi` per file
  (consorzio `ORR`, tracciato `xrec718-<attività>`), così idempotenza, hash, storico e «segna inviata»
  restano per file. Solo **mesi interi** (dal giorno 1 all'ultimo giorno), stesso anno, come WinWaste.
  Solo sedi in Campania (provincia ISTAT 061-065); per il file `T` almeno produttore o destinatario in
  Campania. Le attività `FRA`/`ROT`/`AUT` per movimento vengono dai dati del tracciato ORR. L'esplosione
  dell'autodemolitore in più record (`calcolapedan`) è fuori ambito: avviso bloccante su `AUT`.
- **D14. Bloccanti come WinWaste:** se un solo movimento ha un errore bloccante non si genera il file;
  l'anteprima elenca gli errori per movimento con un link alla correzione (movimento, anagrafica della
  sede ditta, configurazione della sede).
- **D15. Golden file sintetici e indipendenti:** per ogni tracciato `__fixtures__/<tracciato>-sintetico.txt`
  scritto a mano (o da uno script in `__fixtures__/genera-golden.md` che descrive i valori campo per
  campo, mai lanciando il serializzatore) e `__fixtures__/<tracciato>-campi.json` con (campo, offset,
  lunghezza) copiati dai documenti WinWaste. Tre test per tracciato: (1) il serializzatore produce il
  golden byte per byte dopo la codifica; (2) tagliando il golden con gli offset del JSON si ottengono i
  valori attesi; (3) la tabella di layout del serializzatore coincide con il JSON. Così uno sbaglio
  del serializzatore e uno del documento non si coprono a vicenda.
- **D16. Ruoli:** lettura per tutti i ruoli, scrittura (dati del movimento, anagrafica, configurazione,
  genera, segna inviata) ADMIN/OPERATOR, come `api/comunicazioni/ruoli.ts`.

## Da ri-verificare con un file reale o con la specifica

Lista da spuntare quando arriva un file accettato dal consorzio (o la specifica). Ogni voce cambia una
costante di «Inferenze isolate» o una funzione nominata, mai il resto.

- **Tutti:** code page (un nome con `à`, `è`, `’`); terminatore di riga; presenza di BOM; riga finale
  vuota o no; nome del file; riempimento dei numeri (zeri o spazi, a destra o a sinistra); segno
  negativo; ordine dei record.
- **CONOU:** lunghezza 299 e campo di riserva omesso; formato ATECO (`NN.NN.NN`); ISTAT a 9 (`0` +
  regione + comune); percentuale ×100 senza decimali e limite; protocollo = numero di registro o
  protocollo RENTRI; serie/numero/anno ricavati dal numero del FIR RENTRI; causale `B` e comune di
  raccolta; prodotti ammessi per CER.
- **COBAT:** 1409 + 219 e assenza di separatore fra record; `progdta` dal 2026; `tipmov`/`causa`
  (D10); `codazi`; lettere di regione; formato `quam3`/`quaton` (14 caratteri, 7 decimali, punto);
  blocco intermediario; campagna nella coda; cognome e nome del trasportatore (difetto corretto).
- **O.R.SO. dettagliata:** accettazione dei codici `I` e degli `Inew` dal portale; `Extra` assente;
  `f` per `In`; attributi di `IndirizzoSL`/`IndirizzoUL` (provincia e comune a 3 cifre, esteri).
- **O.R.R.:** unità di `b2` (grammi?); codice unità locale a 4 cifre nel nome file; lettere del mese;
  `e13` per i trasportatori; codici del tipo dichiarante; se l'ORGR accetta ancora il `.txt` (oggi la
  Campania usa O.R.So., DGR 677/2017: appendice §A.1) o lo chiede solo come allegato.

## Vincoli globali

- Prisma dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica dello schema
  `npx prisma generate`.
- **Migration solo additive**: nessun `DROP`, nessuna colonna tolta o resa NOT NULL su tabelle
  esistenti, nessun cambio di tipo. `SET LOCAL lock_timeout = '5s'` in testa, come
  `20261111100000_marcatura_consorzi`. **Mai `prisma migrate reset`** (né `db push --force-reset`), su
  nessun database: si applica con `npx prisma migrate deploy`.
- **RLS** su ogni tabella nuova con `tenant_id`: ENABLE + FORCE, `isolamento_azienda` e `sola_lettura`
  (`wasteflow_lettura`), FK composte con `tenant_id`, riga in `rls-catalogo.postgres.spec.ts` (84 → 87,
  con il commento che nomina la spec di schema), modelli in `prisma-rls.extension.ts`.
- Database di test `wasteflow-pg-test-consorzi` su `127.0.0.1:55446`:
  `docker run -d --name wasteflow-pg-test-consorzi -p 127.0.0.1:55446:5432 -e POSTGRES_USER=wasteflow
  -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci -e
  POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine`. Le PR C e D, in worktree propri,
  usano 55447 e 55448 (container `-orso-det`, `-orr`).
- Test Postgres col ruolo **`wasteflow_app`** (`creaPrismaServiceApplicativo()`, `TenantContext.run`):
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`; preparazione
  e pulizia col proprietario, solo per id esatti, mai `deleteMany` con filtro che può essere `undefined`.
- **Frontend: mai la porta 4200** (è del collaudo Neat sul VPS e di altri stack in locale). Per provare a
  mano `npx ng serve --port 4310`; Karma `ng test --watch=false` una volta per task frontend.
- **RAM:** jest mirato `npx jest -w 2 <percorsi>`; `npm run test:cov` (con `NODE_ENV=test
  JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod`) una volta a fine task backend; eslint dei file
  toccati e, a fine task, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` → 0 errori;
  `npx tsc --noEmit -p tsconfig.json`. Un solo processo pesante alla volta, anche fra worktree.
- Task con migration: `npx prisma validate`; `migrate deploy` su 55446; `ops/db-ruoli.sh` con
  `PG_EXEC="docker exec -i wasteflow-pg-test-consorzi"`; `npx prisma migrate diff --from-migrations
  prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` → vuoto.
- Moduli commerciali (CLAUDE.md): controller nuovi con `@RichiedeModulo('comunicazioni')` e in
  `MAPPA_MODULI` nello stesso commit; rotte frontend con `moduloGuard`; componenti dentro pagine di base
  (registro, anagrafiche) dietro `ff.has('comunicazioni')`.
- Aree **non** toccate: `application/fir/**`, `domain/fir/**`, `application/registro/**` (salvo la
  sola lettura dal lettore), `application/rentri/**`, `api/registro/**`, `fe/features/fir/**`,
  `domain/waste-movement/**` (solo import). Toccate in modo mirato: `comunicazioni/**` (backend e
  frontend), `prisma/schema.prisma` (modelli in coda e relazioni inverse in fondo ai modelli esistenti),
  `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`, `controller-moduli.spec.ts`, la scheda
  della sede ditta nel frontend (solo un pannello in più dietro `ff.has`). Se un task scopre di doverne
  toccare un'altra, si ferma e lo segnala.
- **Convivenza con altri branch:** se master riceve una migration con timestamp successivo a
  `20261114100000`, rinominare la nostra (mai applicata in produzione); al rebase sommare i conteggi RLS,
  `prisma generate`, `migrate deploy`, `migrate diff` vuoto.
- Commit in italiano con i termini tecnici in inglese, **senza attribuzione AI**. Niente push senza
  richiesta.

## Review focus

1. **Isolamento fra aziende** sulle tre tabelle nuove: FK composte e RLS; un movimento, una sede ditta o
   una sede di un'altra azienda nel corpo della richiesta → 404, nessuna riga scritta (test A2, A5).
2. **Marcatura invariata:** scrivere o cancellare i dati del tracciato non cambia la marcatura del
   movimento (regola resta regola, nessuna correzione manuale nasce o sparisce) → test A4.
3. **Rettifica e annullamento:** i dati del tracciato seguono la radice; un movimento annullato esce dal
   file; una rettifica usa i valori della vigente → test A4, B5.
4. **Larghezza fissa:** ogni riga/record ha la lunghezza esatta **in byte dopo la codifica**; un testo
   lungo si tronca, un carattere fuori code page blocca → test A1, B2, B4, D2.
5. **Golden:** tre test per tracciato (D15); nessun golden rigenerato dal serializzatore.
6. **Difetti non copiati:** test che nominano il difetto WinWaste (COBAT trasportatore, progressivo).
7. **Hash e «modificata dopo l'invio»:** cambiare un dato del tracciato, un'anagrafica o una
   configurazione cambia l'hash; rigenerare senza modifiche restituisce la stessa comunicazione.
8. **Affidabilità visibile:** vista, manifest e interfaccia dicono «ricavato da WinWaste, da confermare».

---

# PR A — Fondamenta comuni (4.9c-0)

## Task A0: ambiente e linea di base

**File:** nessuno.

- [ ] Container `wasteflow-pg-test-consorzi` (Vincoli globali); `.env` del backend su 55446
  (`git check-ignore -v apps/backend/.env`).
- [ ] `node_modules` alla radice (altrimenti `npm ci`), `npx prisma generate`, `migrate deploy` fino a
  `20261113100100_pese_agenti`, `ops/db-ruoli.sh`, seed.
- [ ] Base: `npm run test:postgres` intera e `npm run test:cov`; annotare i test già rossi su master.
- [ ] Verificare in `reference-data` che i nomi delle 20 regioni in `istat_province.regione` siano
  quelli attesi da `regioni-istat.ts` (lista nel rapporto del task).

**Fatto quando:** base annotata, nessuna modifica al repository.

## Task A1: dominio comune a larghezza fissa e codifica

**Dipende da A0.** **File:** `domain/comunicazioni/fisso/campo-fisso.ts` + `.spec.ts`,
`fisso/codifica-cp1252.ts` + `.spec.ts`, `domain/comunicazioni/regioni-istat.ts` + `.spec.ts`,
`domain/comunicazioni/tracciato-comunicazione.ts` (campi additivi D7) + spec,
`orso/serializza-impianto-mesi.ts` (solo i tre campi nuovi del tracciato).

- [ ] Test rossi, poi codice:
  - `testo(valore, lunghezza)`: normalizza, tronca, riempie a destra di spazi; `numeroZeri(n, lung)`;
    `numeroSegnato(n, lung)` con `-` in testa (CONOU); `decimaleFisso(n, interi+decimali, lung)` col
    punto (COBAT); `dataAaaammgg(giorno)`; `layout(campi)` che verifica che offset e lunghezze siano
    contigui e somma = lunghezza del record.
  - `codificaCp1252(testo): Buffer` e `nonRappresentabili(testo): string[]`: tutto Latin-1 più i 27 di
    0x80-0x9F (`€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ`); 0x81, 0x8D, 0x8F, 0x90, 0x9D non
    mappati. Un test con `€` (0x80) e `’` (0x92) che **fallirebbe** con `latin1`.
  - `regioni-istat.ts`: nome regione → codice `01..20` e lettera WinWaste (`REGIONE_LETTERA`);
    `istatNoveConou(regione, comune6)` = `0` + 2 + 6.
  - `TracciatoComunicazione`: `codifica`, `affidabilita`, `notaAffidabilita`; O.R.SO. normale
    `utf-8`/`UFFICIALE`.

**Fatto quando:** spec verdi, 100% di copertura sui file nuovi, nessun cambiamento nel file O.R.SO.
generato (test 4.9a invariati).

## Task A2: migration e modelli (le tre tabelle)

**Dipende da A1.** **File:** `prisma/migrations/20261114130000_comunicazioni_tracciati/migration.sql`,
`prisma/schema.prisma` (modelli `DatiTracciatoMovimento`, `AnagraficaComunicazioniSede`,
`ConfigurazioneComunicazioneSede` in coda; relazioni inverse in fondo a `Tenant`, `WasteMovement`,
`SedeDitta`, `RentriUnitaLocale`; commento di `DatiConsorzioMovimento.dati` aggiornato),
`infrastructure/persistence/prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`,
`application/comunicazioni/tracciati.schema.postgres.spec.ts`.

- [ ] Spec di schema rossa: per ogni tabella RLS ENABLE+FORCE, policy, FK composte (riga di un'altra
  azienda rifiutata), CHECK (`tracciato` ammesso, `dati`/`versione_schema` coerenti, formati di
  `codice_orso`, `codice_istat_comune` 6 cifre, `codice_ateco`, `consorzio` ammesso), unici.
- [ ] Migration (D2, D3, D4, D5) additiva, con il commento di testa «Cosa fa / Additiva».
- [ ] `rls-catalogo` 84 → 87 con il commento; `migrate diff` vuoto; `prisma validate`.

**Fatto quando:** spec di schema e `rls-catalogo` verdi, `migrate diff` vuoto, base invariata.

## Task A3: schemi dei dati e configurazioni (puri)

**Dipende da A1** (parallelo ad A2: file diversi, nessuno stato condiviso).
**File:** `domain/comunicazioni/dati-tracciato.ts` + spec (Zod: `conou-v1`, `cobat-v1`, `orr-v1`),
`domain/comunicazioni/configurazione-sede.ts` + spec (Zod per `CONOU`, `COBAT`, `ORSO`, `ORR`),
`domain/comunicazioni/conou/prodotti-per-cer.ts` + spec (tabella `OLIOtiporif`, 64 CER).

- [ ] `conou-v1`: `prodotto?` ∈ `A B C E G`, `percentualeOlio?` 0 < p ≤ 99.99 con due decimali,
  `causale?` ∈ `B E U M D L`, `scaricoInterno?`, `formulario?` {serie ≤ 6, numero ≤ 10, anno 4},
  `comuneRaccolta?` (solo con causale `B`).
- [ ] `cobat-v1`: `tipoMovimento?` `1..7`, `causa?` `1..5`, `pgf?` `A..E`, `campagna?` {codice 2,
  descrizione ≤ 30}.
- [ ] `orr-v1`: `attivita?` ∈ `FRA ROT AUT`, `formulario?` (numero 15, data) per movimenti senza FIR.
- [ ] `prodottiAmmessiPerCer(cer)` e `prodottoPredefinito(cer)` (unico ammesso o `null`).
- [ ] Ogni schema rifiuta campi sconosciuti (`strict`) e ha la sua `versioneSchema = 1`.

**Fatto quando:** spec verdi, 100% di copertura.

## Task A4: servizi dei dati (movimento, anagrafica, configurazione)

**Dipende da A2, A3.** **File:** `application/comunicazioni/dati-tracciato.service.ts` + `.port.ts` +
`.postgres.spec.ts`, `anagrafica-comunicazioni.service.ts` + spec postgres,
`configurazione-comunicazioni.service.ts` + spec postgres.

- [ ] Dati del movimento: `leggi(movimentoId, tracciato)`, `imposta(…)` (upsert sulla **radice**,
  valida con lo schema), `cancella(…)`. Test: marcatura identica prima e dopo (Review focus 2); dati
  seguiti su rettifica; movimento di un'altra azienda → `MovimentoNonTrovatoError`.
- [ ] Anagrafica della sede ditta: `leggi`, `imposta` (CHECK applicativi: ATECO, ISTAT esistente in
  `istat_comuni`, codice ARPA), `risolviIstat(sedeDittaId)` (forzatura > nome+provincia in
  `IstatComune`; ambiguo o assente → `null` con motivo).
- [ ] Configurazione della sede: `leggi(unitaLocaleId, consorzio)` (con i predefiniti se manca la riga),
  `imposta` validata; `autorizzazioneImpiantoId` deve essere dell'azienda.

**Fatto quando:** spec postgres verdi col ruolo applicativo; `test:cov` e `tsc` ok.

## Task A5: lettore dei dettagli e servizio generico «comunicazione a tracciato»

**Dipende da A4.** **File:** `application/comunicazioni/lettore-dettagli-tracciato.ts` + spec postgres,
`application/comunicazioni/comunicazioni-tracciato.service.ts` + `.port.ts` + spec unit e postgres,
`domain/comunicazioni/manifest.ts` + spec.

- [ ] Lettore: dati i movimenti già letti da `leggiMovimentiOrso`, carica in **una** query per tipo
  (niente N+1): FIR (numero, date, CF e P.IVA delle tre parti, targa, sedi, `carrierId`,
  `receiverId`, operazione), `FIRTransporter` ordine 1, `Ditta`/`SedeDitta` delle sedi coinvolte e la
  sede principale di ogni ditta (sede legale), `AnagraficaComunicazioniSede`, `Trasportatore`,
  `Destinatario`, dati del tracciato per radice. Test con 3 movimenti, uno senza FIR, uno rettificato.
- [ ] Servizio generico, parametrizzato da un **preparatore** per tracciato
  (`{ consorzio, seleziona(periodo, sede) , prepara(letti) → { dati, avvisi, movimenti } }`):
  `anteprima`, `genera` (idempotente per hash come 4.9a; snapshot in
  `comunicazioni_consorzi_movimenti`), `file` → `{ nomeFile, contenuto: Buffer, contentType }` con la
  codifica del tracciato, `manifest`, `segnaInviata`, `elenca`. Testato con un tracciato finto
  registrato solo nella spec.
- [ ] `ComunicazioneVista` + `affidabilita` (additivo); `file()` di O.R.SO. invariato nel risultato.
- [ ] `manifest(…)`: testo puro, con le sezioni di D8.

**Fatto quando:** spec verdi; O.R.SO. 4.9a invariata (spec 4.9a verdi).

## Task A6: API e interfaccia comuni

**Dipende da A5.** **File:** `api/comunicazioni/comunicazioni.controller.ts` (rotte generiche
`GET :id/file` con `Content-Type` dal tracciato, `GET :id/manifest`), nuovo
`api/comunicazioni/dati-comunicazioni.controller.ts` (`/comunicazioni/dati/movimenti/:id/:tracciato`,
`/comunicazioni/dati/sedi-ditta/:id`, `/comunicazioni/dati/sedi/:id/:consorzio`) + DTO + spec HTTP,
`api/controller-moduli.spec.ts` (`MAPPA_MODULI`), frontend: `features/comunicazioni/anagrafica-sede.component.ts`
(pannello nella scheda della sede ditta, dietro `ff.has('comunicazioni')`), `configurazione-sede.component.ts`,
`dati-movimento.component.ts` (nel pannello di `marcatura-movimento`), servizi e modelli + spec Karma.

- [ ] Spec HTTP: 403 senza modulo, 403 a ruolo di sola lettura in scrittura, 400 su dati non validi,
  404 su risorse di altre aziende.
- [ ] `GET :id/file` per O.R.SO. restituisce gli stessi byte e lo stesso `Content-Type` di prima.
- [ ] Frontend: individuare la scheda della sede ditta (`features/registry/**` o equivalente) e aggiungere
  solo il pannello; nessuna rotta nuova in questo task.

**Fatto quando:** spec HTTP e Karma verdi; `controller-moduli` e `rotte-moduli` verdi; e2e O.R.SO.
esistente non toccato.

---

# PR B — 4.9c CONOU e 4.9d COBAT

Dopo il merge di A. I task B1-B2 (CONOU) e B3-B4 (COBAT) sono **puri e indipendenti**: si possono dare a
due implementatori in parallelo (jest mirato, niente Postgres).

## Task B1: regole CONOU (pure)

**File:** `domain/comunicazioni/conou/costanti.ts`, `conou/derivazioni.ts` + spec,
`conou/formulario.ts` + spec.

- [ ] `causaleConou(verso, forzatura)` (D11); `quantitaConou(kg, scaricoInterno)` intera con segno;
  `prodottoConou(cer, dati, configurazione)` (dati > predefinito per CER della sede > unico ammesso >
  avviso); `percentualeConou` ×100 intera; `atecoConou(ateco, privato)` (`NN.NN.NN` o `0000`).
- [ ] `scomponiNumeroFir(numero)` → serie (lettere iniziali ≤ 6), numero (≤ 10), anno (2 cifre → `20xx`,
  accettato 2020-2099, altrimenti vuoto e numero = resto), come `calcolaformu`; casi: formato RENTRI,
  `ABC123/25`, solo cifre, vuoto. La forzatura nei dati del movimento vince.

**Fatto quando:** spec verdi, 100% di copertura, ogni inferenza con il commento `// INFERENZA`.

## Task B2: serializzatore CONOU e golden

**Dipende da B1.** **File:** `conou/riga-conou.ts` (tipo dei dati della riga), `conou/serializza-conou.ts`
+ spec, `conou/__fixtures__/conou-sintetico.txt`, `conou-campi.json`, `genera-golden.md`;
`domain/comunicazioni/registro-tracciati.ts` (una riga).

- [ ] Layout dei 24 campi scritti (riserva omessa), 299 caratteri, CRLF, nessuna intestazione né totale.
- [ ] `validaDati` = controlli di `ComunicazioneCou2023.Controlla` (§6 del documento): CF, ATECO, ISTAT
  9, serie/numero/anno, protocollo, prodotto, causale; per `B E U` serie, numero, CF trasportatore,
  targa obbligatori; caratteri fuori Windows-1252.
- [ ] Golden: tre righe sintetiche (entrata, uscita, scarico interno con quantità negativa e nome
  accentato); i tre test di D15.
- [ ] Tracciato registrato: `CONOU`, `Movi2023-ww1`, `txt`, `text/plain; charset=windows-1252`,
  `windows-1252`, `RICAVATO_WINWASTE`.

**Fatto quando:** spec verdi; il golden non è prodotto dal serializzatore (lo dice `genera-golden.md`).

## Task B3: regole COBAT (pure)

**File:** `domain/comunicazioni/cobat/costanti.ts`, `cobat/derivazioni.ts` + spec, `cobat/progressivo.ts`
+ spec.

- [ ] `tipoMovimentoCobat` e `causaCobat` (D10) con la tabella WinWaste → WasteFlow nel commento.
- [ ] `soggettoCodazi(parti)` con precedenza esplicita (Difetti §3).
- [ ] `quantitaCobat(kg, quantita, unita)` → `quam3`, `quaton` (14, 7 decimali, punto, a destra).
- [ ] `progressivoCobat` (D9) con test «2026 funziona» e «oltre 999 999 → errore».

**Fatto quando:** spec verdi, 100% di copertura.

## Task B4: serializzatore COBAT e golden

**Dipende da B3.** **File:** `cobat/record-cobat.ts`, `cobat/serializza-cobat.ts` + spec,
`cobat/__fixtures__/cobat-sintetico.txt`, `cobat-campi.json`, `genera-golden.md`; registro dei tracciati.

- [ ] Testata (1-178) e sei blocchi (`p` 179, `x` 415, `t` 584, `s` 820, `y` 1056, `c` 1225-1409);
  coda 185 spazi + campagna 2 + descrizione 30 + CRLF; nessun separatore fra record. Anni ≤ 2009
  rifiutati con errore.
- [ ] **Difetto corretto:** test `il trasportatore porta cognome e nome, non descrizione e ISTAT
  (WinWaste ComuCou:2388)`.
- [ ] `validaDati`: regione presente per ogni blocco valorizzato (come WinWaste: senza regione si
  ferma tutto), `codazi` non vuoto, date, CER.
- [ ] Golden: due record (carico da terzi con trasportatore esterno → `tipmov 6`; scarico → `4`).
- [ ] Tracciato `COBAT`, `Movcob-ww1`, come CONOU.

**Fatto quando:** spec verdi, record di 1628 byte esatti dopo la codifica.

## Task B5: preparatori CONOU e COBAT

**Dipende da B2, B4.** **File:** `application/comunicazioni/preparatore-conou.ts` + spec unit + spec
postgres, `preparatore-cobat.ts` + spec, `comunicazioni.module.ts`.

- [ ] Selezione D1 (marcati 4.9b, una lettura delle regole per comunicazione); periodo da/a nello
  stesso anno (CONOU, come WinWaste), libero per COBAT entro un anno; sede obbligatoria.
- [ ] Composizione dei dati della riga/record dal lettore A5 e dalle regole B1/B3; avvisi bloccanti
  per movimento e campo (D14); avvisi informativi (`targa1`, autista, intermediario vuoti).
- [ ] COBAT: esclusione dei movimenti in cui tutte le parti siamo noi (avviso informativo).
- [ ] Spec postgres: registro con 4 movimenti (uno marcato a mano, uno escluso a mano, uno rettificato,
  uno annullato) → file con le righe attese; hash che cambia cambiando la percentuale olio.

**Fatto quando:** spec verdi; `test:cov`, `tsc`, eslint globale ok.

## Task B6: API e pagina CONOU/COBAT

**Dipende da B5.** **File:** `api/comunicazioni/comunicazioni.controller.ts` (`GET conou/anteprima`,
`POST conou`, `GET cobat/anteprima`, `POST cobat`) + DTO + spec HTTP; frontend
`features/comunicazioni/` (schede CONOU e COBAT: sede, periodo, anteprima con righe e avvisi, link alle
correzioni, genera, scarica file e manifest, segna inviata; banner «Tracciato ricavato da WinWaste, da
confermare con un file reale») + spec Karma.

- [ ] Banner e etichetta nello storico guidati da `affidabilita`, non da testo fisso per consorzio.
- [ ] «Segna inviata» su un tracciato ricavato chiede la conferma (Q2).

**Fatto quando:** spec HTTP e Karma verdi; `rotte-moduli` verde.

## Task B7: UAT e2e

**Dipende da B6.** **File:** `e2e/tests/comunicazioni/conou-cobat.spec.ts`.

- [ ] Registro con un carico CER `130205*` da FIR e uno scarico; anagrafica e configurazione compilate da
  interfaccia; anteprima senza bloccanti; scarico del file: lunghezza riga 299 byte, CRLF, byte 0xE0 per
  `à`; manifest con «ricavato da WinWaste»; segna inviata; modifica della percentuale → «modificata dopo
  l'invio». Stesso giro per COBAT con `160601*`. Nessun 403 con il modulo, 403 senza.

**Fatto quando:** e2e verde in CI.

---

# PR C — 4.9e O.R.SO. modalità dettagliata

Dopo il merge di A; parallela a B e D (nessuna migration). Tocca soprattutto `domain/comunicazioni/orso/`
e `comunicazioni-orso.service.ts`, che B e D non toccano.

## Task C1: XSD e serializzatore con `NuovoImpianto`

**File:** `orso/impianto-mesi.ts` (tipi `NuovoImpiantoDati`, `IndirizzoDati`, campo `nuoviImpianti?`),
`orso/serializza-impianto-mesi.ts` + spec.

- [ ] Rileggere `ImportazioneMesiImpianti.pdf` v2.5 per la modalità dettagliata (presenza di `Extra`,
  significato di `s` per `C`, `FormaSocietaria`, `Tipo` indirizzo) e annotarlo nel rapporto; ogni
  divergenza dal documento WinWaste va nel commento `// Guida v2.5 pag. N`.
- [ ] `NuovoImpianto` con `id`, `RagioneSociale`, `CodfisPIVA`, `IndirizzoSL?`, `IndirizzoUL`
  (`Provincia`/`Comune` 3 cifre; esteri: provincia `000`, comune = codice ISO numerico, tabella `ISOS` di
  WinWaste copiata solo per i paesi presenti in `istat_nazioni`), `Civico` ≤ 5.
- [ ] Validazione XSD con `xmllint-wasm` di un file dettagliato con `I`, `C`, `Inew` e due `NuovoImpianto`;
  ogni `s` di un `Inew` ha il suo `NuovoImpianto` e viceversa.

**Fatto quando:** spec verdi, XML valido contro la fixture XSD.

## Task C2: aggregatore dettagliato (puro)

**Dipende da C1.** **File:** `orso/aggrega-orso-dettagliata.ts` + spec, `orso/aggregato.ts` (tipi
additivi: soggetto per movimento, `SOGGETTO_NON_IDENTIFICATO`).

- [ ] Stessi nodi e stesse giacenze della modalità normale (riuso di `aggregaOrso` per totali e
  `QuantitaTrattataInternamente`), ma `In`/`Out` per soggetto; `f` per `In` (review 4.9a); `Inew`
  numerati per prima comparsa; ordine stabile.
- [ ] Proprietà: la somma degli `In` di un nodo = `Tot` della modalità normale (test su 200 movimenti
  generati).

**Fatto quando:** spec verdi, 100% di copertura.

## Task C3: risoluzione dei soggetti e servizio

**Dipende da C2.** **File:** `application/comunicazioni/soggetti-orso.ts` + spec postgres,
`comunicazioni-orso.service.ts` (modalità dalla configurazione della sede, D12) + spec.

- [ ] Sede del FIR → `I`/`C`/`Inew` con i dati di A4 (`risolviIstat`, `codice_orso`, `e_comune`); errori
  bloccanti come WinWaste (CF non di 11 o 16, ISTAT non di 6 cifre) con movimento e sede.
- [ ] Hash e idempotenza separati per modalità (versione `1-dettagliata`); passare da normale a
  dettagliata non tocca le comunicazioni già generate.

**Fatto quando:** spec verdi; spec 4.9a invariate.

## Task C4: interfaccia ed e2e

**Dipende da C3.** **File:** frontend `features/comunicazioni/` (scelta della modalità nella
configurazione della sede; anteprima con colonna «soggetto» e avvisi; nota «identificazione dei soggetti
ricavata da WinWaste»), `anagrafica-sede.component.ts` (codice ARPA e «è un comune» già presenti da A6:
solo la spiegazione), e2e `e2e/tests/comunicazioni/orso-dettagliata.spec.ts`.

**Fatto quando:** Karma ed e2e verdi; XML scaricato valido contro l'XSD nell'e2e.

---

# PR D — 4.9f O.R.R. Campania

Dopo il merge di A; parallela a B e C. Usa il servizio generico di A5.

## Task D1: regole O.R.R. (pure)

**File:** `domain/comunicazioni/orr/costanti.ts`, `orr/nome-file.ts` + spec, `orr/attivita.ts` + spec.

- [ ] `nomeFileOrr(provincia, sede, meseFinale, anno, attivita)` con le lettere `GE FE MR AP MG GI LU
  AG SE OT NO DI` e le iniziali provincia `A B C N S`; esempio `N0001GE25T.txt`.
- [ ] `attivitaDelMovimento(movimento, tipoImpianto, siamoTrasportatore, datiOrr)` → `TRA` e/o una fra
  `STO SMA REC FRA ROT AUT` (D13; `R/S` diviso per operazione `D`/`R`); `tipoDetentore` (`STO`/`PRO`);
  `tipoImpiantoDestinatario` (`e13`) per i trasportatori (`D`→`SMA`, `R`→`REC`, `R13`/`D15`→`STO`).
- [ ] `inCampania(istatProvincia)` = 061-065; regola del file `T` (almeno una parte in Campania).

**Fatto quando:** spec verdi, 100% di copertura.

## Task D2: serializzatore O.R.R. e golden

**Dipende da D1.** **File:** `orr/record-orr.ts`, `orr/serializza-orr.ts` + spec, `orr/__fixtures__/
orr-sintetico.txt`, `orr-campi.json`, `genera-golden.md`; registro dei tracciati (sette tracciati
`xrec718-<attività>` o uno con l'attività nei dati: scelta al task, motivata).

- [ ] Sezioni A-F, 718 byte con CRLF; riservati `00000000`; quantità `kg × MOLTIPLICATORE_QUANTITA_ORR`
  a 11 cifre con zeri; date senza trattini.
- [ ] `validaDati` = `controlladati` (§6): formulario, autorizzazioni (numero, data, classe), P.IVA/CF,
  indirizzi, CAP, ISTAT, ATECO del produttore (o `00` se configurato).
- [ ] Golden con un record `TRA` e uno `STO`.

**Fatto quando:** spec verdi.

## Task D3: preparatore O.R.R.

**Dipende da D2.** **File:** `application/comunicazioni/preparatore-orr.ts` + spec unit e postgres.

- [ ] Periodo a mesi interi dello stesso anno (errore altrimenti); sede in Campania; esclusione delle sedi
  ditta con `esclusa_orr`; autorizzazioni: destinatario terzo da `Destinatario` + anagrafica, noi da
  `AutorizzazioneImpianto` della configurazione; proposta automatica solo se `usaAutorizzazioniPredefinite`
  e c'è un'unica autorizzazione (come `proponi`).
- [ ] Un risultato per attività con movimenti; nessuna attività → avviso «Non ci sono dati da comunicare».
- [ ] `AUT` con dati di pedana → bloccante (fuori ambito, D13).

**Fatto quando:** spec verdi.

## Task D4: API, pagina ed e2e

**Dipende da D3.** **File:** controller (`GET orr/anteprima`, `POST orr` che genera uno o più file),
DTO, spec HTTP; frontend scheda O.R.R. (sede, mesi, anteprima per attività, file multipli, manifest,
banner); e2e `e2e/tests/comunicazioni/orr.spec.ts` (sede a Napoli, un trasporto e uno stoccaggio → due
file `N…T.txt` e `N…S.txt` da 718 byte per riga).

**Fatto quando:** spec HTTP, Karma ed e2e verdi.

---

## Ordine e PR

| PR | Contenuto | Dipende da | Parallelo con |
|---|---|---|---|
| **A** `feat/fase4-9c0-fondamenta` | A0 → A1 → (A2 ∥ A3) → A4 → A5 → A6. Unica migration | master | nulla (blocca le altre) |
| **B** `feat/fase4-9cd-conou-cobat` | (B1 → B2) ∥ (B3 → B4) → B5 → B6 → B7 | A | C, D |
| **C** `feat/fase4-9e-orso-dettagliata` | C1 → C2 → C3 → C4 | A | B, D |
| **D** `feat/fase4-9f-orr-campania` | D1 → D2 → D3 → D4 | A | B, C |

- Perché A da sola: porta la migration e i file che tutti toccano (contratto dei tracciati, servizio
  generico, controller dei dati, pannello dell'anagrafica). Dopo il suo merge le tre PR toccano file
  quasi disgiunti; i punti comuni sono una riga ciascuna in `registro-tracciati.ts`,
  `comunicazioni.module.ts`, `comunicazioni.controller.ts` e la pagina `comunicazioni.component.ts`
  (schede): conflitti piccoli, al rebase.
- CONOU e COBAT stanno insieme perché condividono preparatore, pagina ed e2e quasi per intero: separati
  raddoppierebbero la parte non pura.
- Se le risorse non bastano per tre worktree: B, poi D (usa il servizio generico come B), poi C.

## Rischi

- **R1. Valore legale:** i tracciati non sono verificati con i consorzi; un file sbagliato caricato sul
  portale ricade sul cliente. Mitigazione: affidabilità visibile (D8), conferma su «segna inviata» (Q2),
  lista «Da ri-verificare».
- **R2. Dati mancanti nelle anagrafiche:** ATECO, ISTAT e Albo delle controparti oggi non ci sono; il
  primo uso darà molti bloccanti. Mitigazione: anteprima con link alla correzione; `risolviIstat` per
  nome copre la maggior parte dei casi.
- **R3. Movimenti senza FIR o con FIR storici** senza sede: niente controparte strutturata. Bloccanti per
  CONOU/O.R.R./O.R.SO. dettagliata; forzature per movimento solo dove WinWaste le ammette.
- **R4. O.R.R. forse superata:** dal 2017 la Campania usa O.R.So. (appendice §A.1). Se l'ORGR non accetta
  più il `.txt`, D è lavoro solo per clienti che lo chiedono: va confermato prima di investire in D4.
- **R5. COBAT progressivo e `tipmov`:** traduzioni nostre (D9, D10), non WinWaste: il primo file reale
  può smentirle. Isolate in due funzioni.
- **R6. Code page:** se i portali volessero UTF-8, cambia una costante; il contenuto salvato è già testo.
- **R7. Interferenza con 4.9b:** la tabella nuova evita di trasformare marcature da regola in manuali;
  il test di Review focus 2 lo blinda.
- **R8. RAM e tre worktree:** un solo processo pesante alla volta; tre container Postgres accesi insieme
  occupano ~300 MB, accettabile; Karma ed e2e mai insieme.

## Seguiti

- [ ] Colonna `counterpart_sede_id` valorizzata dal form del registro (nullable, FK composta
  `(sede, tenant)`, fuori dall'hash di vidimazione; da `onProduttoreSelect` e
  `applicaControparteDaFir`): il resolver O.R.SO. dettagliata la usa per prima e tiene il nome solo
  come ripiego per i movimenti storici (elimina le omonimie, review N1-N4).

## Fuori ambito

- Vecchi tracciati: `COMUCOU2008`, coda COBAT degli anni ≤ 2009, `OLDelabcampania` e dichiarazioni O.R.R.
  tipo 1/2.
- Import dell'elenco impianti ARPA (database Access) per i codici `I`: si inseriscono a mano (Q4).
- Lettera di trasmissione O.R.R. stampabile (Q3) ed export Excel di controllo (l'anteprima la sostituisce).
- Autodemolitori con più record da pedana (`calcolapedan`).
- Invio telematico (web service O.R.SO., portali CONOU/COBAT): solo file da scaricare (D5 della 4.9).
- Configurazioni `ConfCou`/`ConfCob` di WinWaste (lette ma non usate nel record).
- Modifica di `regole_consorzio` o del classificatore 4.9b; Corepla (4.9g).
- Compilazione automatica di ATECO/ISTAT delle controparti da servizi esterni.

## Domande aperte per Graziano (con proposta)

**Decisioni di Graziano (14/11):** Q1-Q6 confermate come proposte (progressivo COBAT = progressivo del registro; segna inviata con conferma esplicita nel manifest; lettera O.R.R. fuori; ARPA a mano; CONOU predefiniti per CER con correzione; nessun file con un bloccante).

1. **Q1 — Progressivo COBAT dal 2026** (la formula di WinWaste si ferma al 2025). Proposta: numero
   progressivo del movimento nel registro, 6 cifre, isolato in `progressivoCobat()`; alternativa:
   contatore 1..n per file.
2. **Q2 — «Segna inviata» sui tracciati ricavati.** Proposta: ammessa, con una conferma esplicita «Ho
   verificato che il consorzio accetta questo file» registrata nel manifest; alternativa: bloccata finché
   il tracciato non è confermato.
3. **Q3 — Lettera di trasmissione O.R.R.** Proposta: fuori da 4.9f, la si fa in PDF solo se un cliente
   campano la chiede; alternativa: dentro D4.
4. **Q4 — Codici ARPA per la modalità dettagliata.** Proposta: inserimento a mano nella sede della
   ditta, senza import dell'elenco Access; import CSV dopo, se un cliente lo chiede.
5. **Q5 — Dati CONOU per movimento.** Proposta: predefiniti per CER nella configurazione della sede
   (prodotto e percentuale) più correzione sul singolo movimento; alternativa: sempre a mano su ogni
   movimento, come la marcatura di WinWaste.
6. **Q6 — Bloccanti.** Proposta: come WinWaste, nessun file se c'è anche un solo errore bloccante;
   alternativa: file con i soli movimenti corretti più l'elenco degli esclusi nel manifest.
