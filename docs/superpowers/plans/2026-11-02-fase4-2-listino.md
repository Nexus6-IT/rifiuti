# Fase 4 pezzo 2: listino con righe di addebito — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo; ondate in parallelo come nella sezione "Parallelismo" (un worktree per task, un solo
> database di test 55438, al massimo un task Postgres per ondata). Passi con checkbox (`- [ ]`).
> Il piano è scritto con le **opzioni consigliate** delle "Domande per Graziano" in fondo; dove una
> risposta diversa cambia un task, la domanda lo dice. Nessun task parte prima delle risposte.

**Obiettivo.** Dare al contratto cliente di 4.1 il suo **listino**, uguale a WinWaste.NET
(`WWNET03.ELENCHIaddeb`, `WWNET03.ADDEBCON`, `WWNET03.frmaddebiti`): uno o più **elenchi di
addebiti** per contratto (`[ELENCHIADDEB]`), ciascuno con le sue **righe di addebito**
(`[ADDEBCON]`) di tutte le famiglie che WinWaste ammette per i clienti (CER, variabili `V`, fissi
`F` con scadenze, quantità dai movimenti `T…`, conteggi `N…`, minimi `M…`, acconti e detrazioni
`$A`/`$D`/`$R`), con prezzo normale o **prezzo speciale a scaglioni** (7 fasce, tipi A-E e varianti
condizionate X-H), sconto e provvigione a cascata, condizioni, "applica a", minimo fatturabile,
scadenze dei fissi; l'**archivio generale degli addebiti** (`[ADDEBITI]`) con i suoi sei listini;
le tabelle che servono a riga e archivio (codici IVA, gruppi e categorie di addebito, centri di
ricavo, categorie statistiche); le azioni del contratto e di massa: **provvigione e sconto su tutte
le righe** (`IMPOSTAP`, E22 di 4.1), **modifica automatica prezzi** dei contratti (`frmaggprezzi`)
e dell'archivio (`frmaggprezzigenerali`), **adeguamento ISTAT** (`frmaggprezziistat`, con
`incrementoIstat` di 4.1), copia di un elenco da un altro contratto; il vincolo "solo addebiti di
tipo T" del contratto allegato (4.1 D28). Più le **regole pure di prezzo della riga** (importo,
sconto a cascata, arrotondamento, provvigione, prezzo speciale, scadenze nel periodo) che 4.4
userà. Niente legame coi movimenti (4.3), niente fattura (4.4).

**Architettura.** Nove tabelle nuove per azienda con RLS, in due migration: **archivio e tabelle**
(`codici_iva`, `codifiche_addebito`, `addebiti`, `prezzi_listino_addebito`, più tre colonne additive
su `clienti`) e **elenchi e righe** (`elenchi_addebiti`, `allegati_elenco_addebiti`,
`righe_addebito`, `scaglioni_riga_addebito`, `scadenze_riga_addebito`). Regole pure in
`src/domain/listino/`; servizi in `src/application/listino/`; controller e `ListinoModule` in
`src/api/listino/`. Riuso dei mattoni della 4.1: `anagrafica-versionata.ts` (lock ottimistico,
traduzione errori Prisma), `controllaRiferimenti` (letture `FOR SHARE`), `contaUsi` batch,
`primoCodiceLibero`, `decimali.ts`, `nelContestoTenant`. Frontend: pagina `/clienti/addebiti`
(archivio), due schede nuove in `/clienti/tabelle`, pagina `/contratti-clienti/:id/listino` (elenchi
a sinistra, tavola delle righe come la `tavola` di WinWaste a destra), dialog della riga a sezioni.

**Tech stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE); Angular 17 + PrimeNG 17.18;
jest, Karma, Playwright (solo in CI).

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §5 (4.2; 4.3-4.4
solo per sapere cosa **non** fare), §4 (3.8), §10. Come lo fa WinWaste: `contratti.md` §3
(`[ELENCHIADDEB]`, `[ADDEBCON]`), §6-§7; `fatturazione.md` §4 (colonne lette dalla fatturazione,
`speciale`, minimi, acconti, provvigioni), §6, §8; `movimenti.md` §3.5. Forma e convenzioni:
`docs/superpowers/plans/2026-11-01-fase4-1-contratto-cliente.md` (decisioni D3-D30, vincoli globali,
addendum 4.1b con i ruling R1-R34, parallelismo). Le evidenze E1-E32 della 4.1 restano citabili come
"4.1 E…".

**Stima.** 31 task (Task 0-30): 4.2a 16 task (6 di dominio puro, 1 di schema, 4 di servizi e rotte,
3 frontend, e2e), 4.2b 16 task (4 di dominio puro col Task 16a dell'addendum, 1 di schema, 6 di servizi e rotte, 4 frontend,
e2e). 9 tabelle nuove, ~60 campi sulla riga di addebito, ~170 file nuovi o modificati. Taglia
roadmap L, qui L+ per la parità completa: 12-16 giornate di esecuzione con revisione fra i task,
meno con le ondate.

**Consegna proposta: due PR** (domanda Q4).
- **4.2a archivio, tabelle e motore puro** (Task 0-15): codici IVA, codifiche di addebito, archivio
  addebiti con sei listini e la sua variazione prezzi, listino e provvigione predefinita sul
  cliente, regole pure di prezzo (importi, sconto, provvigione, scaglioni, variazioni, ISTAT).
  Migration `20261102300000_listino_archivio_addebiti` (RLS 55 → 59). Si usa da sola: l'archivio
  serve già a preparare i dati prima dei contratti.
- **4.2b elenchi e righe** (Task 16-30), da master dopo il merge della 4.2a: elenchi, righe, allegati
  dell'elenco, azioni di contratto e di massa, ISTAT, vincolo del contratto allegato, pagina del
  listino. Migration `20261102300100_listino_elenchi_righe` (RLS 59 → 64).
  Motivo: la 4.1 in un'unica PR sarebbe stata ingestibile da rivedere; qui il taglio cade dove
  cadono le dipendenze (le righe puntano ad archivio, codici IVA e codifiche) e ciascuna PR ha una
  migration sola, rollback indipendente.

---

## Stato di partenza (master `8ed178a`, branch `feat/fase4-2-listino`, verificato il 01/11)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Modello e database.**
- 4.1 in produzione: `prisma/schema.prisma:2954-3330` (enum `TipoSpesaAccessoria`,
  `GenereCodificaContratto`, `EsigibilitaIva`, `StatoContrattoCliente`; modelli
  `CondizionePagamento` … `AllegatoContrattoCliente`). `Cliente` `:3172-3220` (nessun campo di
  listino né di provvigione), `ContrattoCliente` `:3221-3299` (`incrementoIstat` `:3258`,
  `contrattoPrincipaleId` `:3263`, `codiceCig`/`codiceCup`/`idDocumentoPa` `:3260-3262`). Nessun
  modello di listino, addebito o aliquota IVA. `Contract.basePrice`/`PricingModel` (`:1774-1855`)
  restano del contratto produttore e non si toccano (4.1 D1).
- Catalogo CER globale `CERCode` (`:1013-1044`, `code` "NN NN NN" con `*`), lettura con
  `normalizzaCerCode` e `cerNelCatalogo` in `src/application/registro/cer-catalogo.ts:20,45` (area
  esclusa: si **importa**). Codifiche RENTRI `RentriCodificaSemplice` (`:1067+`, `tabella` =
  `'unita-misura' | 'stati-fisici' | 'caratteristiche-pericolo' | 'attivita-rs'`).
- Ultime migration: `20261102200000_anagrafiche_fatturazione_cliente`,
  `20261102200100_clienti_agenti_contratti_cliente` (nessuna successiva su `origin/master`).
  Migration di questo pezzo: **`20261102300000_listino_archivio_addebiti`** (Task 7) e
  **`20261102300100_listino_elenchi_righe`** (Task 19).
- RLS: `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64` `toBe(55)`;
  `README-tenant-transazione.md:120,131,147` "(55)"; `TENANT_SCOPED_MODELS` in
  `src/infrastructure/persistence/prisma-rls.extension.ts:47-112` (ultime `ContrattoCliente` `:109`,
  `AllegatoContrattoCliente` `:111`). `ops/README.md:607-625` paragrafi di rollback della 4.1.

**Backend.**
- `src/application/clienti/anagrafica-versionata.ts` (`DescrizioneEntita` con `inUso?`,
  `confrontaVersione`, `scriviCondizionato`, `traduciErrorePrisma`), `riferimenti-fatturazione.ts:54`
  (`controllaRiferimenti`, letture raw `FOR SHARE`), `uso-tabelle-fatturazione.ts:51` (`contaUsi`
  batch con `ColonneReferenti`), `src/domain/clienti/decimali.ts` (`normalizzaDecimale`,
  `decimaleValido`, `confrontaDecimali`), `codice-tabella.ts:14`, `codifica-contratto.ts:57`
  (`primoCodiceLibero`).
- `src/application/contratti-cliente/contratti-cliente.service.ts` (1246 righe): `scrivi` passo 6
  contratto principale `:486-490`, `principaleValido` `:645-677` (`FOR UPDATE` del principale),
  `bloccaELeggi` `:679-693` (`FOR UPDATE` del contratto), `controllaCambiamenti` `:841-903`.
- `src/api/clienti/clienti.module.ts` (dieci controller, esporta i servizi); `src/app.module.ts:52-53,
  163-164` (`PeseModule`, `ClientiModule`). Fixture `src/test-support/fatturazione-di-test.ts:22`
  (`creaTabelleFatturazione`), `anagrafiche-di-test.ts` (`creaDittaConRuolo` con `CLIENTE`).
- Allegati: `src/domain/pese/allegato-pesa.ts` (`riconosciTipoFile`, 4 MiB) e
  `src/api/clienti/allegato-contratto-upload.ts` (modello di upload PDF della 4.1b).

**Frontend.**
- `fe/features/clienti/` (lista e dialog del cliente, `aggiunta-in-linea.ts`,
  `scelta-con-nuovo.component.ts`, `tabelle/` con `tabella-comune.ts`);
  `fe/features/clienti/tabelle/tabelle-fatturazione.component.ts:31-51` (sei `p-tabPanel`).
- `fe/features/contratti-cliente/` (lista, dialog a sezioni, `allegati-contratto.component.ts`).
- Rotte `fe/app.routes.ts:144-165` (`clienti`, `clienti/tabelle`, `clienti/agenti`,
  `contratti-clienti`); menu `fe/shared/components/layout.component.ts:1287-1289`.

## Normativa e punti dubbi

- **FatturaPA** (tracciato 1.2.x): `DettaglioLinee` con `Descrizione` (≤ 1000), `Quantita`,
  `UnitaMisura` (≤ 10), `PrezzoUnitario` (da 2 a 8 decimali), `ScontoMaggiorazione` ripetibile
  (`Tipo` SC/MG, `Percentuale` o `Importo`: lo sconto a cascata `10+5` diventa due elementi),
  `PrezzoTotale`, `AliquotaIVA` e `Natura` (N1, N2.1-N2.2, N3.1-N3.6, N4, N5, N6.1-N6.9, N7, dal
  01/01/2021; le generiche N2, N3, N6 sono scartate, `fatturazione.md` §8 p. 9). Qui si **salvano e
  validano** prezzi, sconti, codici IVA e nature; il tracciato è di 4.4.
- **Aliquote IVA** (DPR 633/1972): 22, 10, 5, 4 %; operazioni a zero con natura obbligatoria. Per i
  gestori conta il **reverse charge** su rottami e scarti metallici (art. 74 c. 7-8, natura N6.1) e
  l'esenzione o non imponibilità di alcuni servizi: per questo il codice IVA è un'anagrafica
  dell'azienda e non un numero sulla riga (D3).
- **Provvigioni dell'agente** (art. 1748 c.c.): la base (imponibile scontato o lordo) è un patto
  contrattuale: si porta il `TPROV` S/L di WinWaste (E8). Il calcolo delle provvigioni maturate è
  di 4.4.
- **Adeguamento ISTAT**: clausola contrattuale (indice FOI o altro concordato; per gli appalti
  pubblici revisione dei prezzi, art. 60 D.Lgs. 36/2023). WinWaste non scarica indici: l'operatore
  digita le percentuali per mese di inizio del contratto (E24). Si fa uguale.
- **Arrotondamento**: importi a 2 decimali, metà per eccesso in valore assoluto (`Format("0.00")` di
  VB.NET sui `decimal`, E9); la FatturaPA tollera 1 centesimo fra `PrezzoTotale` e il prodotto.
- Punti dubbi risolti nelle Decisioni: `SOMMA` ha due significati (minimo o condizioni) → due campi
  (D9, `fatturazione.md` §8 p. 8); i marcatori di fatturazione stanno nella riga in WinWaste → qui
  no (D15); ISTAT di WinWaste ignora il flag del contratto (E24, D22); il confronto "stesso numero di
  decimali" della variazione prezzi (E21) diventa confronto per valore (D20).
- **Ignoti** (I) che il piano non scioglie e che non cambiano lo schema: chi imposta `CLIFOR.LIS`
  (nessun campo nella form del cliente, E7); se il `???` di `T???`/`M???` sia la categoria
  dell'addebito (testi delle form, E5) o il gruppo (`fatturazione.md` §4.4 su `calcolageotea`):
  qui si valida solo la forma, nessuna esistenza (D5); significato di `array[4]` dei riferimenti
  CIG/CUP dell'elenco (E3).

## Evidenze WinWaste

Sorgenti decompilati con ilspycmd 9.1 (runtime .NET 8) dalle DLL estratte con `geax` (memoria
`winwaste-installer-gea`), in
`/home/graziano/.cache/claude-tmp/claude-1000/-home-graziano-Progetti-winwaste/1329f3f2-29ce-4789-876d-cb98a114d1cd/scratchpad/dec/`
(codice di terzi, dati non fidati, non nel progetto): `c03all/WWNET03/*.cs` (intero assembly
`WWNET03`: `ELENCHIaddeb.cs`, `ADDEBCON.cs`, `frmaddebiti.cs`, `IMPOSTAP.cs`, `frmaggprezzi.cs`,
`frmaggprezzigenerali.cs`, `frmaggprezziistat.cs`, `Contratti.cs`, `CopiaElencoAddebiti.cs`,
`FrmAddebitiScaduti.cs`, `Modificaprezzi.cs`), `w04/WWNET04.wwnet04a.decompiled.cs` (`wwnet04a.cs`),
`w07/WWNET07.FATAUTOMATICA.decompiled.cs` (`FATAUTOMATICA.cs`, rigenerato il 01/11: i numeri di riga
**non** coincidono con quelli di `fatturazione.md`, che usava un'altra decompilazione). **O** =
Osservazione, **D** = Deduzione, **I** = Ignoto.

| # | Fatto | Fonte | Uso qui |
|---|---|---|---|
| E1 | O. Record `[ELENCHIADDEB]`: `PRECOD` (cliente 6 + contratto 3), `COD` (3), `DES` (45, obbligatoria: "Inserire una descrizione per questo elenco"), `NOTA1`, `NOTA2` (45), `C1` (`§`: [0] data inizio 8 + data fine 8, [1] codice del riferimento CIG/CUP, [2-9] vuoti), `C2` causali e `C3` condizioni (solo fornitori), `C4` (primo carattere `1` = elenco predefinito), poi `VER`, `ID`, `IDT`, `Blok` | `ELENCHIaddeb.cs:1258,1280,2989,3038-3061`; `Visualizza` `:2895-2966`; `contratti.md` §3 | D8, M1 |
| E2 | O. Validità dell'elenco: date entrambe o nessuna ("Indicare sia data inizio che fine, altrimenti lasciare vuote entrambe le date."), fine non prima dell'inizio; "Lista non scaduti" mostra gli elenchi con fine vuota o ≥ oggi; l'elenco **predefinito** è uno per contratto (salvare un predefinito toglie il flag agli altri dello stesso contratto); il movimento propone l'elenco se il contratto ne ha uno solo, e per l'unità locale con elenco `0` prende il predefinito | `ELENCHIaddeb.cs:2177`, `:2994`, `:3547-3611`, `:3054-3059`; `wwnet04a.cs:12818-12858`, `:12949` | D8 |
| E3 | O. L'elenco ha un riferimento "Riferimento e/o CIG, CUP" scelto da una lista per cliente (`ListaCIGeCUP`, righe di `listini`): mostra `[codice] <array[4]> <numero> DEL <data> CIG=… CUP=…`. I. Il contenuto di `array[4]` | `ELENCHIaddeb.cs:1643`, `:3361-3415` | D8 (CIG, CUP, documento PA propri dell'elenco) |
| E4 | O. Due PDF per elenco (`ELENCO…_<cli>_<contr>_<elenco>.pdf` e `…X.pdf` in `wwnet.box`), "Allega file pdf", "Rimuovi alleg.", "Apri" | `ELENCHIaddeb.cs:2061-2062`, `:4573-4606` | D8, D29 |
| E5 | O. Tipi di addebito per i clienti: `V` (quantità in immissione documento), `F` (fisso periodico), `TS`/`TP`/`TR`/`TQ`/`TT`/`TF` (peso netto per tipologia o festivi, "del presente elenco"), `T???` (categoria `???`), `NM`/`NP`/`NG`/`NR` (conteggi), `MF`/`MW`/`M???` (minimi), `$A` acconto, `$D` detrazione, `$R` anticipo; più la riga `CER`. Nel contratto allegato le `T…` dicono "in elenco <principale>.<elenco>" | `ADDEBCON.cs:6318-6338`, `:6341-6355`; `frmaddebiti.cs:2219-2239` | D5 |
| E6 | O. Record `[ADDEBCON]` scritto da `Registra`, 58 campi in quest'ordine: `COD` (0 = nuova), `CLIE`, `CONTR`, `ELENCO`, `ADDEB` (CER di 6 cifre o codice addebito di 5), `RIFER`, `TIPO`, `DES` (codice di 3 della descrizione condivisa), `QTA`, `UM`, `PREZZO`, `SCONTO`, `IVA`, `PROVV`, `TPROV`, `TIPOLOG` (CER: tipologia; altrimenti "tipo ricavo", solo regola 11), `SF`, `RECUP`, `CATQ` (per `F`: periodo scadenze), `CATEG`, `CONTROP`, `CCR`, `SPECIAL` (7 × 5 campi `§`), `INTEND`, `SCA1-12`, `GIAF1-12`, `CONDIZ`, `FACC`, `FDET`, `SOMMA` (condizioni se prezzo `S`, altrimenti minimo), `DATAC`, `CFATT`, `C1` (stima annua kg; regola 05: scadenza e blocco), `C2` (CER di proposta / addebiti proposti), `C3` (appunti, 135), `C4` (`§`: [0] nota uso interno, [1] periodo extra, [2] `XX` minimo per categoria); in modifica conserva `GIAF1-12`, `FACC`, `FDET`, `CFATT` già scritti | `ADDEBCON.cs:9053-9330` (`:9059`, `:9120`, `:9132`, `:9186`, `:9200`, `:9212`, `:9216`, `:9233-9263`, `:9268-9283`, `:9293`) | M2 |
| E7 | O. Scelta di un addebito d'archivio nella riga: descrizione, UM, IVA, tipo, categoria, contropartita, CCR dall'archivio; prezzo, sconto e provvigione dal **listino del cliente** `CLIFOR.LIS` (1-6); senza listino si usa il listino 1 solo se gli altri cinque sono vuoti, altrimenti nessun prezzo; la provvigione e il suo tipo si sostituiscono con quelli del cliente (`CLIFOR.C4` §1 e §2, se > 0) anche sulle righe CER. I. La form `CLIFOR` decompilata non mostra il campo `LIS` (lo legge solo per pulizie) | `ADDEBCON.cs:9502-9617` (`:9504-9535`, `:9549-9563`), `:5625-5640`; `WWNET32.CLIFOR` `:6597-6622` | D6, D7 |
| E8 | O. Archivio `[ADDEBITI]` ("Archivio addebiti", menu "Definizione Generale Addebiti"): `COD` (5), `DES` (45, obbligatoria), `GRUPPO` (obbligatorio: "Inserire il gruppo di appartenenza di questo addebito"), `UM`, `IVA` (codice in `[ESENZIONI]`, "Codice con iva indetraibile non ammesso"), sei listini `P`/`S`/`A` (prezzo 10, sconto 8, provvigione 8), `TIPO`, `CAT`, `TPROV` (1 = su scontato, 2 = su lordo), `CONTROP`, `CCR`, `CAT1`, `CAT2` (statistiche), articolo di magazzino (`CODART`, `LARTIC`), due appunti, flag "Proponi … autodemolitori", `C4` (`§`: [0] nota uso interno, [12] tipo ricavo regola 11); tipo `T…` vuole UM `KG` o `TON` | `frmaddebiti.cs:1260-2125`, `:2683-2773`, `:2775-2799`, `:2801-2831`, `:2584-2591`; stringhe di `WWNET00.DLL` | D6, M3 |
| E9 | O. Importo di una riga in fattura: `arrot(quantità × prezzo)`; sconto = `scontodec(importo, sconto)` (cascata: ogni percentuale sul residuo, somma arrotondata); netto = importo − sconto; provvigione = `scontodec(base, PROVV)` con base = importo se `TPROV = L`, altrimenti netto; `arrot` = `Format(…, "0.00")`. Contropartita mancante → quella di configurazione | `FATAUTOMATICA.cs:16941-16963`, `:14606-14652` | D13 |
| E10 | O. Sconto e provvigione a cascata: al massimo tre termini separati da `+`, nessun termine vuoto, virgola né iniziale né finale, una sola virgola per termine, ciascuno ≤ 99,99 | `IMPOSTAP.cs:568-608`; `ADDEBCON.cs:7254-7298` | D10 |
| E11 | O. Regole della riga al salvataggio: minimo non con prezzo `S`; UM obbligatoria; `%`/`#` solo per `$D`; `K/M`, `K/L` solo con quantità `A`; quantità `P`/`L` → `KG`/`TON` (anche `GR` per i clienti con `P`); `V` → `LT`/`MC`; prezzo obbligatorio "anche se zero"; IVA obbligatoria; provvigione → tipo obbligatorio, mai per `$D`/`$R`; sconto mai per `$…` e `M…` | `ADDEBCON.cs:8725-8818` | D10 |
| E12 | O. Prezzo speciale (`PREZZO = S`): niente sconto, provvigione né minimo di riga (stanno nelle fasce), niente UM `HR`, niente condizione `CONDIZ` ("Non e' consentito indicare prezzo speciale in addebiti con condizione"); tabella completa (riga 1 e 7 con prezzo e tipo, riga 1 con "fino a" > 0, righe 2-6 consecutive con "fino a" crescenti: "Le righe della tabella prezzo speciale devono essere consecutive e con scaglioni crescenti" / "Tabella prezzo speciale errata o incompleta"); provvigione nelle fasce → tipo obbligatorio; "Applica a" obbligatorio, `A`-`E` per i non-11 (`F`, `G`, `H` = regola 11); con `K/M`/`K/L` solo `A`; con condizioni riferite solo A o B; C e D richiedono la data, D non `00-00` | `ADDEBCON.cs:5776`, `:8838-9045` (`:8880-8893`, `:9002-9039`) | D12 |
| E13 | O. "Applica il prezzo speciale a": A ogni singolo documento, B totale del periodo di fatturazione, C totale progressivo dalla data indicata, D 365 giorni prima della data di conguaglio, E totale di ogni singolo giorno movimentato (F/G/H ogni giorno, totale unico, per produttore: regola 11) | `ADDEBCON.cs:3915-3951`, `:4135`, `:4477-4489` | D12 |
| E14 | O. Calcolo `speciale`: 7 fasce, la 7 è "oltre" l'ultima soglia; tipi `A` progressivo (`X` con condizione), `B` fisso della sola fascia più alta (`Y`), `C` fisso per ogni fascia raggiunta (`Z`), `D` tutta la quantità al prezzo della fascia più alta (`W`), `E` solo riga 7 (`H`); `B`/`D`/`Y`/`W` azzerano le fasce precedenti; con quantità precedente (conguaglio progressivo) scala fascia per fascia; condizione `P` (quantità della riga) o `C` (somma dei condizionati), UM dei condizionati uniche; errore unico "Errore nel calcolo del prezzo speciale". `specialegamma` per `K/M`/`K/L` (densità) | `FATAUTOMATICA.cs:17035-17290`, `:17292+`; `fatturazione.md` §4.5 | D12 (funzione pura), D1 (gamma esclusa) |
| E15 | O. Quantità della riga: per `CER`/`V` tipo quantità `P` netto, `L` lordo, `V` volume, `X` sempre 1, `A` altro (in documento); per `F` quantità (vuoto = 1); per `T…`/`N…` la quantità è il tipo; conversioni `xqta` (kg→t con `TON`, litri↔m³), ore `h,mm` → decimali (`cvore`) | `ADDEBCON.cs:3678`, `:3716`, `:5672-5686`; `FATAUTOMATICA.cs:16965-17033` | D9, D13 |
| E16 | O. Riga `CER`: codice nel catalogo e non di capitolo (`xx xx 00` → "Codice non valido"; "Codice CER non presente in catalogo"), riferimento (8) con `?` = "qualsiasi riferimento non specificato per questo CER in questo elenco"; tipologia R/Q/S/P, stato fisico 1-6, recupero (`recup`), categoria Q1-Q16; con regola 01 il riferimento deve esistere in `[Schede rifiuti]` | `ADDEBCON.cs:5552-5575`, `:5611`, `:6286-6316`, `:4155` | D9 |
| E17 | O. Righe uniche e uniche per contratto: stessa (`ADDEB`, `RIFER`, `TIPO`) già nell'elenco → rifiuto; un solo minimo `MF`/`MW` (e lo stesso `M???`) per contratto; un solo `$A`/`$D`/`$R` per contratto; `$D` con UM `#` uno per cliente; una condizione 1-9 definita in un solo addebito dell'elenco | `ADDEBCON.cs:6654`, `:6681`, `:6706`, `:6731`, `:6763` | D11 |
| E18 | O. Contratto allegato: nella riga "Nei contratti allegati non e' possibile inserire codici CER" e "… solo tipi di addebito che iniziano con T"; nella form del contratto, allegare un contratto che ha addebiti di tipo diverso da `T` → "Questo contratto non puo' essere un contratto allegato perche' ha addebiti di tipo diverso da T" | `ADDEBCON.cs:5557`, `:5657`; `Contratti.cs:4886-4898` | D17 |
| E19 | O. Scadenze dei fissi: 12 date `ggmmaa`, anno `??` = ogni anno; "Periodo scadenze" (MP, BA/BP, TA/TP, QA/QP, SA/SP, AA/AP, DA/DP anticipato/posticipato, XA extra aggiuntiva, XD extra detrazione, YC extra nota di credito) con periodo extra "dal … al …"; calendario automatico mensile/bimestrale/trimestrale/quadrimestrale/semestrale dalla prima data (con `??` la prima data nel primo periodo dell'anno); la scadenza si fattura solo dentro le date del contratto e nell'anno | `ADDEBCON.cs:4378-4382`, `:6772-6874`, `:10979-11062` | D14 |
| E20 | O. "Provvigioni" del contratto (`IMPOSTAP`): "In TUTTI gli addebiti del presente contratto, ad eccezione degli addebiti con prezzo SPECIALE, verra' impostata la provvigione qui indicata" (percentuale + tipo S/L), con avviso del numero di righe speciali; stessa form in modalità sconto: sostituisce lo sconto `vecchio` con `nuovo` nelle righe non speciali che hanno quello | `IMPOSTAP.cs:335`, `:345`, `:467-494`, `:616-644`; `Contratti.cs:7018`, `:9005-9022` | D19 |
| E21 | O. Modifica automatica prezzi dei contratti (F12): aggiornamento 1) + %, 2) + importo, 3) − %, 4) − importo, 5) sostituzione IVA; filtri: addebito, CER, cliente, riferimento, prezzo attuale (stringa, "10 e 10,00 sono considerati diversi"), anche prezzi zero, solo minimi fatturabili, tipi di prezzo P/S, tipi di addebito, categorie di addebito, CCR, tipi e categorie di contratto, categorie e zone del cliente, date di inizio e di scadenza del contratto, contratti e addebiti specificati, fissi con prima scadenza, NOTA3 e codici 101-499/500 (NICA); anteprima ed export Excel facoltativi; avviso di copia di sicurezza; precisione = decimali del prezzo (minimo 2) per le percentuali, fino a 6 per gli importi; risultato negativo → errore; aggiorna `PREZZO` o `SOMMA` o le fasce di `SPECIAL`; **non atomico** (riga per riga, "Operazione non conclusa completamente" con l'ultimo aggiornato) | `frmaggprezzi.cs:1529-2285`, `:1675`, `:2600-2850`, `:3149-3621` (`:3612`), `:3623-3741` | D20 |
| E22 | O. Variazione prezzi dell'archivio: stessi 5 tipi, filtri per addebito, categoria, tipo, **listini 1-6**, export Excel | `frmaggprezzigenerali.cs:453-693`, `:1061`, `:1092` | D21 |
| E23 | O. Le righe di massa toccano anche i contratti temporanei e fornitori con la stessa form (`tempor`) | `frmaggprezzi.cs:2478-2489` | D30 (solo clienti) |
| E24 | O. Adeguamento ISTAT (doppio clic su "Tipo di aggiornamento", solo clienti): griglia dei mesi di inizio dei contratti (`substring(datai,1,6)`), escluso l'anno dell'archivio e, a scelta, anche il precedente; una percentuale per mese, < 100, **non crescente** nel tempo ("I valori delle percentuali non sono in ordine decrescente."); applica a prezzi > 0 non speciali e alle fasce delle righe dei tipi scelti, per **tutti** i contratti iniziati in quel mese: il campo "Incr. ISTAT" del contratto **non** è letto; risultato ≤ 0 → errore; non atomico | `frmaggprezzi.cs:3956-4005`; `frmaggprezziistat.cs:162-176`, `:197-266`, `:368-460`, `:505-527` | D22 |
| E25 | O. Incolla un elenco da un altro cliente o contratto: **sostituisce** le righe dell'elenco corrente (conferma), non su sé stesso, non ricopia `M…`, `$…` e `N…` con conguaglio (avviso), e non ricopia i marcatori; varianti CNA (regola 03), "Applica ad altri clienti" (F11), "Copia addebiti"/"Incolla addebiti ricopiati" (F9/F7), "Incolla da contratto temporaneo" (F12), "Sposta qui addebiti di altri contratti" (regola 12) | `ELENCHIaddeb.cs:1928-1934`, `:3932-4040`, `:4269-4336`, `:4357-4373`, `:2847-2871`; `CopiaElencoAddebiti.cs:446-745` | D18 |
| E26 | O. Funzioni nascoste o per installazione nella riga: "A tutti" (Ctrl+PgDn: inserisce la riga in ogni elenco che non ha l'addebito), "Righe di rimando" e "Qualsiasi CER" (regola 11), dati proposti NICA, scadenza bloccante (regola 05, `FrmAddebitiScaduti`), ricerca avanzata | `ADDEBCON.cs:10040-10046`, `:9380-9400`, `:7855-7900`, `:10702-10708`, `:4849`; `FrmAddebitiScaduti.cs:259-277` | D30 |
| E27 | O. Riga `V` proposta al movimento solo se il CER del movimento è fra quelli di `C2` (`\CER RIF\`, `\CER Tutti i rif.\`, `\CER Rif. vuoto\`); riga `CER` con `C2` = elenco di codici `V` da proporre con quel CER; la riga del movimento si trova per (`ELENCO`, `ADDEB`, `RIFER`): "Rifiuto non trovato in contratto" | `ADDEBCON.cs:7805-7900`; `wwnet04a.cs:14802-14880` | D9 (dati), 4.3 (uso) |
| E28 | O. "F6 Aggiorna prezzi movimenti" (`Soglia` con `xisprezzi` → `Modificaprezzi`): riporta prezzi CER e `V` dell'elenco nei movimenti, anche non fatturati; "F8 Applica costi ai movimenti" (fornitori) | `ELENCHIaddeb.cs:2066-2078`, `:2080-2104`; `Modificaprezzi.cs:788-983` | Fuori ambito (4.3) |
| E29 | O. Categorie di addebito, gruppi, centri di costo/ricavo, categorie statistiche e descrizioni condivise stanno in una tabella `Categorie` con colonne per uso (`ADDCAT`, `GRUP`, `CCR`, `CAT1`, `CAT2`, `DEP`); il nuovo codice proposto è il primo libero 001-999 | `ADDEBCON.cs:9721-9760`; `frmaddebiti.cs:2903-3009`; `ELENCHIaddeb.cs:2254-2270` | D4 |
| E30 | O. Il movimento salva prezzo e sconto nel suo `FOGLIO`: cambiare il listino non cambia i movimenti già registrati (salvo F6) | `fatturazione.md` §4.2 | D16 (listino modificabile su contratto attivo) |
| E31 | O. Regola 11 (installazione NICA): prezzo 0 sulle righe CER, IVA 22 e quantità a peso proposte, ordinamento per `C3`, colonne nascoste | `ADDEBCON.cs:5627-5634`, `:8789-8793`; `ELENCHIaddeb.cs:1945-1961`, `:2241` | D30 |
| E32 | O. La fatturazione legge le righe con `cod, elenco, addeb, rifer, tipo, des, um, iva, provv, tprov, categ, controp, ccr, special, intend, sca1, giaf1, …, condiz, facc, fdet, somma, datac, cfatt, qta, prezzo, sconto, c3, c4` | `fatturazione.md` §4.1 | M2 (nessuna colonna letta dalla fattura resta senza posto) |

---

## Decisioni (vincolanti)

**D1. Perimetro (Q1, Q2).** Si porta il listino di WinWaste **per i contratti cliente**: dati completi
di elenchi, righe di **tutte** le famiglie (E5), archivio, tabelle, azioni di massa. Si portano anche
le **regole pure della singola riga** che non hanno bisogno dei movimenti: importo, sconto e
provvigione (D13), prezzo speciale a scaglioni con tutte le varianti (D12), scadenze dei fissi nel
periodo (D14), variazione di prezzo e ISTAT (D20-D22). Restano a 4.4 le regole che sommano su più
movimenti o su più righe della fattura: "applica a" B-E (somme di periodo, progressivi, conguagli,
giorni), condizionati fra righe (`1C`), `T…`/`N…`/`M…`, `$A`/`$D`/`$R`, minimo di documento e per
categoria, IVA e contropartite. `specialegamma` (`K/M`, `K/L`, prezzo per densità, E14) non si porta
nel motore: le righe con quelle UM si salvano e si validano come WinWaste, il calcolo arriva con
4.4 se un cliente reale le usa (3.8 lo misura). Motivo: senza movimenti le somme non hanno dati di
prova veri, e scritte qui sarebbero indovinate; le regole di riga invece si provano con gli esempi
di `fatturazione.md` §4.5.

**D2. Modelli.** `CodiceIva` (`codici_iva`), `CodificaAddebito` (`codifiche_addebito`, enum
`GenereCodificaAddebito`), `Addebito` (`addebiti`), `PrezzoListinoAddebito`
(`prezzi_listino_addebito`), `ElencoAddebiti` (`elenchi_addebiti`), `AllegatoElencoAddebiti`
(`allegati_elenco_addebiti`), `RigaAddebito` (`righe_addebito`), `ScaglioneRigaAddebito`
(`scaglioni_riga_addebito`), `ScadenzaRigaAddebito` (`scadenze_riga_addebito`). Colonne tipizzate,
mai `Json` (roadmap §4.2). Le liste fisse di WinWaste (`SPECIAL`, `SCA1-12`, sei listini) diventano
tabelle figlie con `ordine`/`numero` e `unique`, sostituite **in blocco** alla scrittura del padre,
come i periodi della 4.1 (D10).

**D3. Codici IVA (Q6).** Tabella `codici_iva` per azienda: `codice` VarChar(3)
`^[A-Za-z0-9]{1,3}$` unico (il codice di `[ESENZIONI]`: "22", "10", "N61"…), `descrizione`
VarChar(60) obbligatoria, `aliquota` Decimal(5,2) 0-100 obbligatoria (API stringa
`^\d{1,3}(\.\d{1,2})?$`), `natura` VarChar(4)? fra N1, N2.1, N2.2, N3.1-N3.6, N4, N5, N6.1-N6.9, N7,
**obbligatoria con aliquota 0 e vietata altrimenti** ("Con aliquota zero indica la natura
dell'operazione (N1-N7)." / "La natura si indica solo con aliquota zero."), `attivo`, `versione`.
Solo vendite: il codice di IVA indetraibile di WinWaste (E8) non ha posto. Messaggi: codice →
"Il codice IVA ha da 1 a 3 lettere o cifre."; aliquota → "L'aliquota deve essere un numero da 0 a
100 con al massimo due decimali.". Scelto sull'archivio e sulla riga. 4.4 lo leggerà per
`AliquotaIVA` e `Natura`.

**D4. Codifiche di addebito.** Una tabella `codifiche_addebito` per gli usi della `Categorie` di
WinWaste che servono qui (E29): `genere` enum `GRUPPO` | `CATEGORIA` | `CATEGORIA_STATISTICA_1` |
`CATEGORIA_STATISTICA_2` | `CENTRO_RICAVO`; `codice` VarChar(3) unico per `(tenant, genere)`,
`descrizione` VarChar(45) obbligatoria, `attiva`, `versione`. Creazione in linea come 4.1 D26
(`POST` senza codice → primo libero 001-999 con `primoCodiceLibero`, nuovo tentativo su P2002). Le
descrizioni condivise `DEP` **non** si portano (D9). Non si estende l'enum di
`codifiche_contratto`: un `ALTER TYPE … ADD VALUE` su un enum in produzione non è additivo nel senso
dei vincoli globali, e i generi hanno usi diversi.

**D5. Tipi di addebito** (funzione pura, Task 2). `TipoAddebito` = `'CER' | 'V' | 'F' | 'TS' | 'TP' |
'TR' | 'TQ' | 'TT' | 'TF' | 'NM' | 'NP' | 'NG' | 'NR' | 'MF' | 'MW' | '$A' | '$D' | '$R'` più le forme
`T` + 3 cifre e `M` + 3 cifre (`^(CER|V|F|T[SPRQTF]|T\d{3}|N[MPGR]|M[FW]|M\d{3}|\$[ADR])$`). Famiglia
(`famigliaTipo`): `CER`, `VARIABILE`, `FISSO`, `QUANTITA_MOVIMENTI` (T…), `CONTEGGIO` (N…), `MINIMO`
(M…), `ACCONTO` ($…). Etichette italiane dalle stringhe di E5 ("del presente elenco"). Il `???`
si valida solo per forma (punto dubbio I). Archivio: tipo ammesso tutti tranne `CER`; nella riga
`CER` se e solo se c'è un codice CER.

**D6. Archivio degli addebiti** (E8). `addebiti`: `codice` VarChar(5) `^\d{1,5}$` normalizzato a 5
cifre (`"12"` → `"00012"`, come `Format(Val, "00000")`), unico per azienda, `00000` riservato
("Il codice 00000 è riservato."); `descrizione` VarChar(45) obbligatoria ("Inserisci la
descrizione dell'addebito."); `gruppoId` obbligatorio (codifica `GRUPPO` attiva: "Indica il gruppo
dell'addebito."); `unitaMisura` VarChar(3) obbligatoria (`^[A-Z0-9/%#]{1,3}$` maiuscola);
`codiceIvaId`? (codice IVA attivo); `tipo` (D5, default `V`; `T…` → UM `KG` o `TON`: "Per gli
addebiti di tipo T l'unità di misura è KG o TON."); `categoriaId`?, `centroRicavoId`?,
`categoriaStatistica1Id`?, `categoriaStatistica2Id`? (codifiche del genere giusto, attive);
`tipoProvvigione` enum `SCONTATO` | `LORDO` (default `SCONTATO`); `notaUsoInterno` VarChar(45)?;
`appunti` Text? (i due "appunti" F9 di WinWaste in un campo); `attivo`, `versione`. **Sei listini**
nella figlia `prezzi_listino_addebito` (`numero` 1-6, `prezzo` Decimal(14,6)?, `sconto` e
`provvigione` VarChar(20)? a cascata D10), scritti in blocco con l'addebito. Contropartita: 4.4 (D30).
Funzione pura `prezzoProposto(listini, listinoCliente)` porta E7: listino del cliente se indicato;
senza, il listino 1 se gli altri cinque sono vuoti, altrimenti nessuna proposta.

**D7. Listino e provvigione del cliente (Q3).** Tre colonne additive su `clienti` (unica eccezione al
"nessun ALTER" della 4.1, vedi Vincoli): `listino` SMALLINT? 1-6 ("Il listino del cliente va da 1 a
6."), `provvigionePredefinita` VarChar(20)? (cascata D10), `tipoProvvigionePredefinita`
`tipo_provvigione`? (obbligatorio con la provvigione: "Indica su cosa si calcola la provvigione del
cliente."). Sono predefiniti della riga (E7), non del contratto: alla creazione di una riga CER o
d'archivio la provvigione del cliente sostituisce quella proposta. Cambiarli non tocca le righe
esistenti. Non entrano in `CAMPI_EREDITATI_DAL_CLIENTE` del contratto.

**D8. Elenco degli addebiti** (E1-E4). `elenchi_addebiti`: `contrattoId`, `codice` VarChar(3)
`^[A-Za-z0-9]{1,3}$` unico per contratto (proposto `prossimoCodiceElenco` = primo numero libero
`001`-`999`), `descrizione` VarChar(45) obbligatoria ("Inserisci una descrizione per questo
elenco."), `nota1`, `nota2` VarChar(45)?, `validoDal`, `validoAl` DATE? (entrambe o nessuna:
"Indica sia la data di inizio sia quella di fine dell'elenco, oppure nessuna delle due."; fine non
prima dell'inizio: "La data di fine non può precedere la data di inizio."), `predefinito` Boolean
(uno per contratto: impostarlo toglie il flag agli altri **nella stessa transazione**, dopo
`FOR UPDATE` del contratto; niente indice parziale), `codiceCig`, `codiceCup`, `idDocumentoPa`,
`dataDocumentoPa` (E3: riferimento PA proprio dell'elenco, stesse regole di 4.1 D27; vuoti = vale il
contratto; `dataDocumentoPa` solo con `idDocumentoPa`), `versione`. Funzione pura
`elenchiValidiAl(elenchi, data)` ("Lista non scaduti": fine vuota o ≥ data) e
`elencoProposto(elenchi, data)` (uno solo valido → quello; altrimenti il predefinito valido;
altrimenti nessuno), che 4.3 userà. Due allegati PDF per elenco (posizioni 1 e 2) con lo stesso
modello di 4.1 D29. Eliminazione **fisica** dell'elenco con righe, fasce, scadenze e allegati a
cascata (WinWaste `delrec`), ammessa se il contratto è modificabile (D16); da 4.3 la FK dei movimenti
la bloccherà.

**D9. Riga di addebito: campi** (M2 per la provenienza). Comuni: `elencoId`, `tipo` (D5),
`cerCode` VarChar(10)? (solo `CER`, nella forma del catalogo), `addebitoId`? (solo non `CER`,
archivio attivo), `riferimento` VarChar(8)? (`?` = qualsiasi riferimento non indicato; vuoto =
riferimento vuoto), `descrizione` VarChar(45)? (proposta dall'archivio o dal catalogo CER; la
descrizione condivisa per codice `DEP` di WinWaste non si porta: un testo cambiato in un posto che
cambia altri contratti è un effetto a distanza, e 3.8 risolverà i codici in testo),
`unitaMisura` VarChar(3), `codiceIvaId`, `prezzo` Decimal(14,6)? con `prezzoSpeciale` Boolean
(`PREZZO = S`), `sconto` VarChar(20)?, `provvigione` VarChar(20)?, `tipoProvvigione`?,
`categoriaId`?, `centroRicavoId`?, `notaUsoInterno` VarChar(45)?, `appunti` VarChar(135)?,
`versione`. Per famiglia:

| Campo | CER | V | F | T…, N… | M… | $… |
|---|---|---|---|---|---|---|
| `tipoQuantita` enum `PESO_NETTO` `PESO_LORDO` `VOLUME` `UNO` `ALTRO` | obbl. | obbl. | — | — | — | — |
| `quantitaFissa` Decimal(12,3)? (vuoto = 1, 0 = non fatturare) | — | — | sì | — | — | — |
| `tipologiaRifiuto` enum `URBANO` `URBANO_PERICOLOSO` `SPECIALE` `SPECIALE_PERICOLOSO` | proposta da `tipologiaDaCer` (capitolo 20 → urbano, `*` → pericoloso), modificabile | — | — | — | — | — |
| `statoFisico` VarChar(10)? (codice `stati-fisici` RENTRI) | sì | — | — | — | — | — |
| `operazione` VarChar(10)? (codice `attivita-rs` RENTRI) | sì | — | — | — | — | — |
| `cerProposta` VarChar(20)[] (`CER`, `CER/RIF`, `CER/*` tutti i rif., `CER/` rif. vuoto) | — | sì | — | — | — | — |
| `addebitiProposti` VarChar(5)[] (codici `V` da proporre col CER) | sì | — | — | — | — | — |
| `stimaAnnuaKg` Decimal(12,2)? | sì | sì | — | — | — | — |
| scaglioni, `applicaA`, `condizioniRiferite` (D12) | sì | sì | — | sì | — | — |
| `condizione` 1-9? ("fattura solo se si verifica la condizione") | sì | sì | sì | sì | — | — |
| `minimoFatturabile` Decimal(12,2)? (prezzo normale) e `minimoPerCategoria` Boolean (`XX`) | sì | sì | — | — | — | — |
| `riferimentoGiorno`, `riferimentoMese` (`DATAC`; vuoti = dall'inizio del contratto) | con `applicaA` C/D | idem | — | idem | — | — |
| `periodoScadenze` VarChar(2)?, `periodoExtraDal`/`Al` DATE?, scadenze (D14) | — | — | sì | — | — | — |

Un campo marcato "—" deve essere null/vuoto: la regola pura lo **normalizza a null** (come il
cliente di fatturazione uguale all'intestatario in 4.1 D9) solo se il campo non è stato inviato,
altrimenti risponde 400 "Il campo <etichetta> non vale per gli addebiti di tipo <tipo>.".

**D10. Regole della riga** (`validaRiga`, Task 17, messaggi nell'ordine dei campi; E10-E12, E15-E16):
tipo ammesso ("Tipo di addebito non ammesso."); `CER` con codice nel catalogo e non di capitolo o
sottocapitolo ("Il codice CER non è nel catalogo o indica un capitolo." — controllo nel servizio,
la forma nel dominio); riferimento ≤ 8 senza spazi iniziali; UM obbligatoria ("Indica l'unità di
misura."); `%` e `#` solo per `$D` ("Le unità % e # valgono solo per le detrazioni ($D)."); `K/M`,
`K/L` solo con quantità `ALTRO` ("Con l'unità K/M o K/L la quantità è «Altro»."); `PESO_NETTO` →
`KG`, `TON` o `GR`, `PESO_LORDO` → `KG` o `TON` ("Per una quantità a peso l'unità di misura è KG o
TON (GR solo per il peso netto)."), `VOLUME` → `LT` o `MC` ("Per una quantità a volume l'unità di
misura è LT o MC."); prezzo obbligatorio anche zero senza prezzo speciale ("Indica il prezzo, anche
zero."), `^\d{1,8}(\.\d{1,6})?$` ("Il prezzo deve essere un numero non negativo con al massimo sei
decimali."); codice IVA obbligatorio ("Indica il codice IVA."); sconto e provvigione a cascata
`cascataValida` (E10: "Lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5),
ciascuna fino a 99,99." e lo stesso per la provvigione); provvigione → tipo obbligatorio ("Indica su
cosa si calcola la provvigione."), mai per `$D`/`$R` ("Per questo tipo di addebito non si indica
la provvigione."); sconto mai per `$…` e `M…` ("Per questo tipo di addebito non si indica lo
sconto."); minimo mai col prezzo speciale ("Con il prezzo speciale non si indica il minimo
fatturabile."); scadenze e periodi D14; regole del prezzo speciale D12. Importi e percentuali come
**stringhe decimali** (4.1 D3).

**D11. Regole fra righe** (servizio, nella transazione, dopo `FOR UPDATE` dell'elenco; E17): riga
uguale (`elenco`, `cerCode`/`addebitoId`, `riferimento`, `tipo`) → 409 `RIGA_ADDEBITO_DUPLICATA`
"L'addebito è già nell'elenco con lo stesso riferimento." (anche vincolo unico, D24); una sola riga
`MF`/`MW` per contratto e ogni `M###` una volta → 409 `MINIMO_GIA_PRESENTE` "Nel contratto c'è già
un addebito di minimo fatturabile."; una sola `$A`/`$D`/`$R` per contratto → 409
`ACCONTO_GIA_PRESENTE` "Nel contratto c'è già un acconto, una detrazione o un anticipo."; `$D` con UM
`#` una per cliente → 409 `DETRAZIONE_GIA_PRESENTE` "Il cliente ha già una detrazione a scalare in un
altro contratto."; una condizione 1-9 definita (nelle `condizioniRiferite`) da una sola riga
dell'elenco → 409 `CONDIZIONE_GIA_DEFINITA` "La condizione <n> è già definita da un altro addebito di
questo elenco."; le righe citate dalle condizioni riferite devono esistere nell'elenco con quella
`condizione` e la stessa UM → 400 "Le condizioni indicate non trovano addebiti condizionati con la
stessa unità di misura in questo elenco.". Per i controlli "per contratto" e "per cliente" si
blocca il contratto (`FOR SHARE`) e si legge con una query per vincolo.

**D12. Prezzo speciale a scaglioni** (E12-E14). Figlia `scaglioni_riga_addebito`: `ordine` 1-7,
`finoA` Decimal(14,3)? (vuota sulla 7 = "oltre"), `prezzo` Decimal(14,6), `sconto`,
`provvigione` VarChar(20)?, `tipoCalcolo` VarChar(1) fra `A B C D E X Y Z W H`. Regole pure
(`validaScaglioni`): righe 1 e 7 obbligatorie con prezzo e tipo, `finoA` della 1 > 0; righe 2-6
consecutive (nessun buco) e con `finoA` strettamente crescenti ("Le fasce del prezzo speciale
devono essere consecutive e con soglie crescenti."); fascia incompleta → "La tabella del prezzo
speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo."; tipi 1-6 fra `A-D` (più
`X Y Z W` con condizioni riferite), riga 7 fra `A-E` (più `X Y Z W H`); provvigione in una fascia →
tipo provvigione della riga obbligatorio. `applicaA` enum `DOCUMENTO` | `PERIODO` |
`PROGRESSIVO_DA_DATA` | `CONGUAGLIO_365` | `GIORNO` obbligatorio con il prezzo speciale ("Indica a
cosa si applica il prezzo speciale."); `K/M`/`K/L` → solo `DOCUMENTO`; `condizioniRiferite`
VarChar(10)? `^[1-9]{1,9}[CP]$` (cifre distinte) solo con `DOCUMENTO` o `PERIODO` ("Con le
condizioni il prezzo speciale si applica al documento o al periodo."); `PROGRESSIVO_DA_DATA` e
`CONGUAGLIO_365` → riferimento giorno/mese (D9) e, per il conguaglio, mai vuoto ("Per il conguaglio
indica la data (giorno e mese)."). Prezzo speciale vietato con `condizione` ("Il prezzo speciale non
si usa negli addebiti condizionati."), con UM `HR`, con sconto o provvigione di riga. Funzione pura
`applicaScaglioni(scaglioni, quantita, opzioni?: { quantitaPrecedente?, condizione?: 'P'|'C',
quantitaCondizionati? })` → `{ righe: { descrizione, quantita, prezzo, sconto, provvigione }[],
condizioneVerificata: boolean } | { errore }`, porta di `speciale` (E14) con le descrizioni "Per q.tà
fino a …", "Per q.tà oltre … e fino a …", ": imp.fisso". Test con l'esempio di `fatturazione.md`
§4.5 (6.000 kg: `A` → 470,00, `D` → 300,00) e un caso per tipo e variante.
**Differenza voluta da WinWaste (decisione di Graziano del 02/11, Task 16a):** `E` e `H`
azzerano le fasce precedenti come `D`, e con la quantità precedente `B`/`C`/`D` non ripagano la
parte già fatturata: la stessa quantità non si fattura mai due volte (R29-R31 dell'addendum).

**D13. Importi della riga** (E9, funzioni pure del Task 3): `arrotonda2(valore)` metà per eccesso in
valore assoluto; `scontoCascata(importo, formula)` (ogni termine sul residuo, somma arrotondata);
`importoRiga(quantita, prezzo, sconto)` → `{ lordo, sconto, netto }` con `lordo =
arrotonda2(quantita × prezzo)`; `provvigioneRiga(importi, formula, tipo)` (base `lordo` con `LORDO`,
`netto` con `SCONTATO`); `cascataValida(formula)`; `quantitaDaMovimento(tipoQuantita, um, { netto,
lordo, volume, umVolume })` (porta di `xqta`) e `oreDecimali("h,mm")` (`cvore`). Tutti su stringhe
decimali con aritmetica esatta (`Prisma.Decimal`/decimal.js già nel progetto), mai `number`.

**D14. Scadenze dei fissi** (E19). Figlia `scadenze_riga_addebito`: `ordine` 1-12, `giorno`,
`mese`, `anno` SMALLINT? (null = ogni anno, il `??` di WinWaste). Regole pure: data valida (29/02
solo con anno bisestile o anno vuoto: "Scadenza <n>: data non valida."), scadenze non ripetute,
ordinate; `periodoScadenze` fra `MP BA BP TA TP QA QP SA SP AA AP DA DP XA XD YC`; con `XA`/`XD`/`YC`
`periodoExtraDal`/`Al` obbligatori ("Per una scadenza extra indica il periodo dal … al …."), negli
altri casi vuoti. `calendarioAutomatico(prima, frequenza)` (mensile, bimestrale, trimestrale,
quadrimestrale, semestrale; con anno vuoto la prima data deve cadere nel primo periodo dell'anno,
messaggi di E19 riscritti: "Con scadenze mensili e anno vuoto la prima data va in gennaio." ecc.);
`periodoCompetenza(scadenza, periodoScadenze, anno)` ("Dal 01-mm-aaaa al <fine mese>", anticipato o
posticipato); `scadenzeNelPeriodo(scadenze, dal, al, contratto)` (dentro le date del contratto e
dell'intervallo) che 4.4 userà. Il servizio **non** rifiuta scadenze fuori dal contratto (WinWaste lo
fa solo con la regola 11): la vista le segna "non fatturabile quest'anno".

**D15. Marcatori di fatturazione fuori dalla riga.** `GIAF1-12`, `FACC`, `FDET`, `CFATT` (e il
residuo di `$D` con `#` che WinWaste scala in `PREZZO`, `fatturazione.md` §3.4 p. 3) **non** sono
colonne del listino: li scriverà 4.4 in una tabella sua, chiave (riga, scadenza/fase, fattura).
Motivi: (a) WinWaste li deve preservare a mano a ogni modifica della riga (E6, `:9268-9283`); (b) la
fatturazione scriverebbe sulle righe e farebbe 409 agli operatori che le stanno modificando; (c)
l'annullo della fattura li toglie per riferimento (`fatturazione.md` §3.6), più semplice su una
tabella propria. Conseguenza: la copia di un elenco (D18) non ha marcatori da escludere.

**D16. Stato del contratto e listino.** Elenchi e righe si creano, modificano ed eliminano con il
contratto in `BOZZA`, `ATTIVO`, `SOSPESO`, `SOSPESO_MOVIMENTI` (WinWaste cambia i prezzi dei
contratti in corso; i movimenti già registrati hanno il loro prezzo, E30, e 4.3 lo congela); con
`ANNULLATO` → 409 `LISTINO_NON_MODIFICABILE` "Il listino di un contratto annullato non si
modifica."; contratto eliminato → 404 su tutte le rotte. Le scritture del listino **non** cambiano
la `versione` del contratto (come gli allegati della 4.1, D29). La vista del contratto della 4.1 non
cambia (nessun conteggio di elenchi: evita di toccare il servizio più grande del pezzo precedente).

**D17. Contratto allegato** (E18, rimandato da 4.1 D28). Righe: su un contratto con
`contrattoPrincipaleId` niente `CER` ("In un contratto allegato non si inseriscono righe CER.") e
solo tipi `T…` ("In un contratto allegato si inseriscono solo addebiti di tipo T."). Contratto: la
modifica (o la creazione con copia, se mai arrivasse) che imposta `contrattoPrincipaleId` su un
contratto con righe di tipo diverso da `T…` → 400 "Questo contratto ha addebiti di tipo diverso da
T: non può essere allegato a un altro.". Concorrenza: la riga legge il contratto con `FOR SHARE`, la
modifica del contratto lo tiene `FOR UPDATE` (`bloccaELeggi`): le due operazioni si mettono in fila.
Modifica **mirata** di `contratti-cliente.service.ts` (passo 6 di `scrivi` e `controllaCambiamenti`).

**D18. Copia di elenchi e righe** (E25). `POST /elenchi-addebiti/:id/sostituisci-da { daElencoId,
versione }`: sostituisce le righe dell'elenco con quelle di un altro elenco della stessa azienda
(qualunque cliente o contratto, non eliminato), mai su sé stesso ("Un elenco non si copia su sé
stesso."), escluse `M…`, `$…` e le righe con `applicaA = CONGUAGLIO_365` (la risposta le conta:
`{ copiate, escluse: { minimi, acconti, conguagli } }`); fasce e scadenze copiate, nuove `id`; con
D17 sul contratto di destinazione. `POST /elenchi-addebiti/:id/aggiungi-righe { righeIds[],
versione }` (F9/F7 "copia addebiti" e "incolla ricopiati"): aggiunge copie delle righe scelte,
saltando i duplicati (D11) con il conteggio. Una transazione, `FOR UPDATE` dei due elenchi in ordine
di `id` (niente deadlock), un audit. Varianti CNA, F11, temporanei, regola 12: D30.

**D19. Provvigione e sconto su tutto il contratto** (E20, 4.1 E22).
`POST /contratti-clienti/:id/provvigioni { provvigione, tipoProvvigione }` imposta provvigione e tipo
su **tutte** le righe del contratto **senza** prezzo speciale; `POST /contratti-clienti/:id/sconti
{ scontoAttuale, scontoNuovo }` sostituisce lo sconto nelle righe non speciali che hanno esattamente
quello (formula normalizzata: `"10 + 5"` = `"10+5"`). Risposta `{ aggiornate, speciali }` (le
speciali vanno sistemate a mano, come l'avviso di WinWaste). Regole: D10 sulle formule, D16 sullo
stato, mai per `$D`/`$R` la provvigione (escluse e contate). Una transazione con `versione + 1` su
ogni riga toccata; un audit.

**D20. Modifica automatica dei prezzi dei contratti** (E21). Due rotte: `POST
/variazioni-prezzi/anteprima` e `POST /variazioni-prezzi` con lo stesso corpo `{ tipo: 'AUMENTO_PERCENTUALE'
| 'AUMENTO_IMPORTO' | 'DIMINUZIONE_PERCENTUALE' | 'DIMINUZIONE_IMPORTO' | 'SOSTITUZIONE_IVA', valore?,
daCodiceIvaId?, aCodiceIvaId?, soloMinimi?: boolean, filtri }` più, sulla seconda, `impronta`
(SHA-256 di id+versione delle righe dell'anteprima). Filtri portati: addebito, CER, cliente,
riferimento, prezzo attuale (per **valore**, non per stringa: "10" e "10,00" sono lo stesso prezzo
— differenza voluta), anche prezzi zero, prezzi normali/speciali, tipi di addebito, categorie di
addebito, centri di ricavo, tipi e categorie di contratto (4.1 D26), date di inizio e di fine del
contratto (intervalli), contratti scelti, addebiti scelti, fissi con prima scadenza in una data.
Esclusi: categoria e zona del cliente (non esistono, 4.1 D5), NOTA3 e codici 101-499/500 (NICA),
contratti temporanei e fornitori (D30). Sempre esclusi i contratti annullati ed eliminati. Calcolo
`nuovoPrezzo(prezzo, tipo, valore)` (Task 6): percentuali → precisione = decimali significativi del
prezzo attuale, minimo 2; importi → fino a 6 decimali; risultato negativo → la riga va in
`errori` dell'anteprima ("Il nuovo prezzo sarebbe negativo.") e l'applicazione si rifiuta con 400
finché ce n'è uno. Si aggiornano `prezzo` (o `minimoFatturabile` con `soloMinimi`) e i prezzi delle
fasce delle righe speciali (zero e vuoti restano). Anteprima: `{ totale, righe: [primi 200 con
cliente (codice), contratto (numero), elenco, addebito/CER, prima, dopo], errori, impronta }`.
Applicazione: **una** transazione, `SELECT … FOR UPDATE` delle righe, ricalcolo, confronto
dell'impronta (diversa → 409 `VARIAZIONE_SUPERATA` "I prezzi sono cambiati dopo l'anteprima: rifai
l'anteprima."), `UPDATE` con `versione + 1`, un audit con filtri e conteggio. Rispetto a WinWaste:
atomica (E21 "non conclusa completamente" non può succedere), anteprima obbligatoria (al posto
dell'avviso di copia di sicurezza), export CSV dell'anteprima al posto di Excel (Task 29). Massimo
10.000 righe per variazione (400 "La variazione tocca troppe righe: restringi i filtri.").

**D21. Variazione prezzi dell'archivio** (E22). Stesso schema su `/addebiti/variazioni-prezzi/
anteprima` e `/addebiti/variazioni-prezzi`, con filtri addebiti, categorie, tipi e **listini
1-6**; aggiorna `prezzi_listino_addebito` (e `codiceIvaId` dell'addebito per la sostituzione IVA).
Non tocca i contratti (come WinWaste: l'archivio propone, le righe hanno i loro prezzi).

**D22. Adeguamento ISTAT (Q5).** `GET /variazioni-prezzi/istat/mesi?ancheAnnoPrecedente=` → i mesi
(anno, mese) di inizio dei contratti **con `incrementoIstat = true`**, non annullati né eliminati,
escluso l'anno corrente (data locale italiana) e, senza il parametro, anche il precedente (E24);
`POST /variazioni-prezzi/istat/anteprima` e `POST /variazioni-prezzi/istat { percentuali: [{ anno,
mese, percentuale }], tipi: TipoAddebito[], impronta }`: percentuale > 0 e < 100 ("La percentuale
deve essere maggiore di 0 e minore di 100."), non crescente in ordine di tempo ("Le percentuali
devono essere decrescenti dai mesi più vecchi ai più recenti."), almeno un tipo ("Scegli almeno un
tipo di addebito."); applica a prezzi > 0 non speciali e alle fasce, come D20 (una transazione,
impronta, audit). **Differenza voluta da WinWaste**: WinWaste applica a tutti i contratti del mese e
il flag "Incr. ISTAT" non serve a niente; qui il flag di 4.1 decide (era stato portato per questo).

**D23. Lock ottimistico ed errori.** `versione INTEGER NOT NULL DEFAULT 1` (CHECK ≥ 1) su
`codici_iva`, `codifiche_addebito`, `addebiti`, `elenchi_addebiti`, `righe_addebito` (non sulle
figlie, sostituite in blocco). Stesso ordine dei controlli e stessi testi di 4.1 D14 (404, stato,
versione, campi, validazione pura, database, scrittura condizionata con audit), con l'helper di
`anagrafica-versionata.ts`. Codici: `CODICE_IVA_*`, `CODIFICA_ADDEBITO_*`, `ADDEBITO_*`,
`ELENCO_ADDEBITI_*`, `RIGA_ADDEBITO_*` con `_MODIFICATO_NEL_FRATTEMPO`/`_MODIFICATA_`,
`_CODICE_DUPLICATO`, `_IN_USO`; `ELENCO_ADDEBITI_CODICE_DUPLICATO` "Il contratto ha già un elenco
con questo codice."; `ALLEGATO_POSIZIONE_OCCUPATA` come 4.1. Con la RLS un P2002 arriva con
`meta.target` null: `rileggi` fuori transazione come R22 della 4.1b. Le operazioni di massa
(D18-D22) non chiedono la versione delle singole righe: scrivono `versione + 1`, e chi stava
modificando una riga riceve 409 al salvataggio.

**D24. Integrità nel database.** FK composite con `tenant_id`, `NoAction` salvo indicazione:
`addebiti` → `codifiche_addebito` (cinque relazioni con nome: gruppo, categoria, statistiche 1 e 2,
centro), `codici_iva`; `prezzi_listino_addebito` → `addebiti` `CASCADE`; `elenchi_addebiti` →
`contratti_cliente` `CASCADE` (solo la cancellazione fisica, che la 4.1 non fa mai); allegati,
righe → elenco `CASCADE`; righe → `addebiti`, `codici_iva`, `codifiche_addebito` (categoria,
centro); fasce e scadenze → righe `CASCADE`; ogni tabella → `tenants` `CASCADE`. Unici:
`(tenant_id, codice)` su codici IVA e addebiti, `(tenant_id, genere, codice)` sulle codifiche,
`(contratto_id, codice)` sugli elenchi, `(addebito_id, numero)`, `(riga_id, ordine)`,
`(elenco_id, posizione)`, e sulla riga `(elenco_id, tipo, cer_code, addebito_id, riferimento)` con
`NULLS NOT DISTINCT` (PostgreSQL 16; se Prisma non lo rappresenta, l'unico vive solo nella
migration e il `migrate diff` deve restare vuoto: verificarlo nel Task 19, altrimenti solo nel
servizio). CHECK: `versione >= 1`; `codici_iva`: `aliquota BETWEEN 0 AND 100`, `(aliquota = 0) =
(natura IS NOT NULL)`; `addebiti.codice ~ '^[0-9]{5}$' AND codice <> '00000'`; `numero BETWEEN 1
AND 6`; riga: `(tipo = 'CER') = (cer_code IS NOT NULL)`, `(tipo = 'CER') = (addebito_id IS NULL)`,
`tipo ~` regex di D5, `prezzo IS NULL OR prezzo >= 0`, `prezzo_speciale OR prezzo IS NOT NULL`,
`NOT (prezzo_speciale AND minimo_fatturabile IS NOT NULL)`, `condizione BETWEEN 1 AND 9`,
`riferimento_giorno BETWEEN 1 AND 31`, `riferimento_mese BETWEEN 1 AND 12`, `cardinality(cer_proposta)
<= 50`, `cardinality(addebiti_proposti) <= 50`; fasce `ordine BETWEEN 1 AND 7`, `tipo_calcolo IN
(…)`; scadenze `ordine BETWEEN 1 AND 12`, giorno 1-31, mese 1-12; allegati come 4.1 D15; `clienti`
(nuove colonne): `listino BETWEEN 1 AND 6`, `(provvigione_predefinita IS NULL) =
(tipo_provvigione_predefinita IS NULL)`.

**D25. Audit senza dati personali.** `activity_logs` nella stessa transazione. Azioni
`CODICE_IVA_*`, `CODIFICA_ADDEBITO_*`, `ADDEBITO_*`, `ELENCO_ADDEBITI_CREATO|MODIFICATO|ELIMINATO|
SOSTITUITO`, `RIGHE_ADDEBITO_AGGIUNTE`, `RIGA_ADDEBITO_CREATA|MODIFICATA|ELIMINATA`,
`PROVVIGIONI_IMPOSTATE`, `SCONTI_SOSTITUITI`, `PREZZI_VARIATI`, `PREZZI_ARCHIVIO_VARIATI`,
`PREZZI_ISTAT`, `ALLEGATO_ELENCO_CARICATO|RIMOSSO`. Metadata: id, numero del contratto, codici di
elenco/addebito/CER, tipi, campi cambiati, prezzi e percentuali (dati commerciali dell'azienda),
filtri, conteggi. **Mai**: ragione sociale, nome di un privato, note, appunti, nota uso interno,
descrizioni libere, nome del file.

**D26. API, ruoli, azienda.** Come 4.1 D17 (`requireRequestTenantId`, `@Roles` esplicito, letture
`SUPER_ADMIN, ADMIN, OPERATOR, VIEWER`, scritture `SUPER_ADMIN, ADMIN, OPERATOR`, `ParseUUIDPipe`,
`DELETE …?versione=`, feature `contratti`). Le variazioni di massa e l'ISTAT solo `SUPER_ADMIN,
ADMIN` (toccano tutti i contratti). Rotte:
- `/codici-iva`: `GET` (`?incluseDisattivate`), `GET :id`, `POST`, `PATCH :id`, `DELETE :id`.
- `/codifiche-addebito`: come `/codifiche-contratto` della 4.1 (`?genere=` obbligatorio, `GET
  prossimo-codice?genere=` prima di `:id`, `POST` con codice facoltativo).
- `/addebiti`: `GET` (`?testo`, `?tipo`, `?soloAttivi`, paginato), `GET prossimo-codice`, `POST
  variazioni-prezzi/anteprima`, `POST variazioni-prezzi` (prima di `:id`), `GET :id`, `POST`,
  `PATCH :id`, `DELETE :id`.
- `/contratti-clienti/:id/elenchi`: `GET` (`?validiAl=`), `GET prossimo-codice`, `POST`;
  `/contratti-clienti/:id/provvigioni`, `/contratti-clienti/:id/sconti`: `POST`.
- `/elenchi-addebiti/:id`: `GET` (con le righe), `PATCH`, `DELETE`; `POST :id/sostituisci-da`,
  `POST :id/aggiungi-righe`; `GET|POST :id/righe`; allegati `GET :id/allegati`, `POST :id/allegati`
  (multipart `allegato`, `posizione`), `GET :id/allegati/:allegatoId/contenuto`, `DELETE
  :id/allegati/:allegatoId`.
- `/righe-addebito/:id`: `GET`, `PATCH`, `DELETE`.
- `/variazioni-prezzi`: `POST anteprima`, `POST`, `GET istat/mesi`, `POST istat/anteprima`, `POST
  istat`.
Elenchi e righe rispondono con l'elenco intero (decine di righe per elenco); l'archivio è paginato.

**D27. RLS e privilegi.** Nove tabelle con `tenant_id`, `ENABLE` + `FORCE`, `isolamento_azienda` e
`sola_lettura TO wasteflow_lettura` (forma di `20261031110000_ditte_sedi_controparti`); modelli in
`TENANT_SCOPED_MODELS`. Catalogo **55 → 59** dopo il Task 7 (`CodiceIva`, `CodificaAddebito`,
`Addebito`, `PrezzoListinoAddebito`) e **59 → 64** dopo il Task 19 (`ElencoAddebiti`,
`AllegatoElencoAddebiti`, `RigaAddebito`, `ScaglioneRigaAddebito`, `ScadenzaRigaAddebito`).
`ruoli-db.sql` invariato (CRUD predefinito; le righe si cancellano davvero).

**D28. Frontend.** Archivio: pulsante "Archivio addebiti" nella lista clienti accanto a "Agenti" e
"Tabelle di fatturazione", rotta piatta `clienti/addebiti`; dialog con i dati e una tabella dei sei
listini (prezzo, sconto, provvigione). Tabelle: schede "Codici IVA" e "Gruppi e categorie di
addebito" (genere scelto con un `p-selectButton`) in `tabelle-fatturazione.component.ts`. Listino
del contratto: azione "Listino" nella lista dei contratti clienti e nel dialog del contratto
(pulsante, non sezione: il dialog della 4.1 è già lungo), rotta `contratti-clienti/:id/listino`:
intestazione col contratto (numero, cliente, stato, allegato a …), a sinistra gli elenchi (codice,
descrizione, validità, predefinito, "Nuovo elenco", "Solo validi oggi"), a destra la tavola delle
righe con le colonne della `tavola` di WinWaste (`riempitavola`, `ELENCHIaddeb.cs:2204-2378`): tipo,
CER/addebito, riferimento, descrizione, UM, quantità, prezzo (o "speciale"), sconto, IVA,
provvigione, condizione, minimo, categoria, appunti; doppio clic o pulsante apre il dialog della
riga; totale dei fissi annuali ("Totale fissi", `TOTFISSI`). Dialog della riga a schede: Dati,
Prezzo speciale, Scadenze (solo `F`), Proposta (CER/addebiti proposti), Note; campi abilitati per
famiglia (D9) da una tabella del vocabolario, non da regole replicate: il backend resta l'arbitro
(400 con i messaggi di D10-D12). "Nuovo …" in linea (4.1 D20 e `AggiuntaInLinea`) per codice IVA,
gruppo, categoria, centro e addebito d'archivio. Azioni del listino: "Copia da un altro elenco",
"Aggiungi righe da un altro elenco", "Provvigioni", "Sostituisci sconto"; menu "Variazioni prezzi"
(solo ADMIN) nella lista dei contratti clienti con "Modifica automatica prezzi" e "Adeguamento
ISTAT". Sola lettura (VIEWER o contratto annullato): niente pulsanti di scrittura.

**D29. Due migration, due PR.** `20261102300000_listino_archivio_addebiti` (4 tabelle + 3 colonne di
`clienti`) nella 4.2a; `20261102300100_listino_elenchi_righe` (5 tabelle) nella 4.2b, che parte da
master dopo il merge della 4.2a. Ognuna col suo ripristino a mano e il suo paragrafo in
`ops/README.md`; la seconda dipende dalla prima.

**D30. Esclusioni di WinWaste (motivate).** Regole per installazione `ControlloRegole` 01 (scheda
rifiuto obbligatoria), 03 (CNA), 05 (scadenza bloccante dell'addebito, `FrmAddebitiScaduti`), 11
(NICA: righe di rimando, "qualsiasi CER", tipo ricavo, prezzo 0, applica a F/G/H, ordinamenti), 12
(sposta addebiti), 4.1 E17; funzioni NICA (proposta dati, "Aggiungi $", "Correzione", NOTA3,
contratti 500, esclusione degli elenchi con `$`), autodemolitori, import "procedure da Contatti"
(`C001A05`); "A tutti" nascosto (E26: inserisce una riga in ogni elenco dell'azienda senza
anteprima); listini dei contratti temporanei e fornitori (`…TMP`, `…FOR`, 4.1 fuori ambito);
contropartita e articolo di magazzino (piano dei conti e magazzino: 4.4 e oltre; la contropartita
diventerà una colonna additiva di `addebiti` e `righe_addebito` in 4.4); `CATQ` categorie Q1-Q16
(allegato del D.Lgs. 22/1997, non più in vigore dal D.Lgs. 205/2010); descrizioni condivise `DEP`
(D9); colonne tecniche `COD` intero, `VER` (→ `versione`), `ID` (→ audit), `IDT`, `BLOK`,
`IMPORT`.

### Mappa campo per campo (perimetro "tutto come WinWaste")

**M1. `[ELENCHIADDEB]`** (E1)

| WinWaste | Contenuto | WasteFlow (`elenchi_addebiti` salvo indicazione) |
|---|---|---|
| `PRECOD` | cliente + contratto | `contratto_id` → `contratti_cliente` (il cliente è quello del contratto) |
| `COD` | codice (3) | `codice` VarChar(3), unico per contratto |
| `DES` | descrizione (45) | `descrizione` VarChar(45) |
| `NOTA1`, `NOTA2` | note (45) | `nota1`, `nota2` VarChar(45) |
| `C1` [0] | validità dal/al | `valido_dal`, `valido_al` DATE |
| `C1` [1] | riferimento CIG/CUP (lista per cliente) | `codice_cig`, `codice_cup`, `id_documento_pa`, `data_documento_pa` (D8: i dati, non il rimando a una lista) |
| `C1` [2-9] | vuoti | **escluso**: mai scritti |
| `C2`, `C3` | causali e condizioni (solo fornitori) | **escluso** (D30) |
| `C4` [0] | predefinito | `predefinito` Boolean |
| `C4` [1-] | — | **escluso**: mai scritti da questa form |
| file `ELENCO….pdf`, `…X.pdf` | due PDF | `allegati_elenco_addebiti` (posizione 1, 2) |
| `VER` | versione | `versione` |
| `ID` | utente | `activity_logs` |
| `IDT`, `Blok` | tecnici | **esclusi** |

**M2. `[ADDEBCON]`** (E6; 58 campi applicativi + 5 tecnici)

| # | WinWaste | Contenuto | WasteFlow (`righe_addebito` salvo indicazione) |
|---|---|---|---|
| 0 | `COD` | identità (0 = nuova) | `id` uuid |
| 1-3 | `CLIE`, `CONTR`, `ELENCO` | chiave dell'elenco | `elenco_id` → `elenchi_addebiti` |
| 4 | `ADDEB` | CER (6) o addebito (5) | `cer_code` (forma del catalogo) **o** `addebito_id` → `addebiti` |
| 5 | `RIFER` | riferimento (8), `?` qualsiasi | `riferimento` VarChar(8) |
| 6 | `TIPO` | famiglia | `tipo` VarChar(4) (D5) |
| 7 | `DES` | codice della descrizione condivisa | `descrizione` VarChar(45) testo (D9) |
| 8 | `QTA` | tipo quantità o quantità | `tipo_quantita` (CER, V) / `quantita_fissa` (F); per T/N/M/$ implicita nel tipo |
| 9 | `UM` | unità di misura (3) | `unita_misura` VarChar(3) |
| 10 | `PREZZO` | prezzo o `S` | `prezzo` Decimal(14,6) + `prezzo_speciale` |
| 11 | `SCONTO` | cascata | `sconto` VarChar(20) |
| 12 | `IVA` | codice `[ESENZIONI]` | `codice_iva_id` → `codici_iva` |
| 13 | `PROVV` | cascata | `provvigione` VarChar(20) |
| 14 | `TPROV` | S/L | `tipo_provvigione` |
| 15 | `TIPOLOG` | tipologia del rifiuto (CER) / tipo ricavo (regola 11) | `tipologia_rifiuto` / **escluso** il tipo ricavo (D30) |
| 16 | `SF` | stato fisico | `stato_fisico` (codice RENTRI; 3.8 mappa 1-6) |
| 17 | `RECUP` | operazione di recupero | `operazione` (codice RENTRI R/D) |
| 18 | `CATQ` | categoria Q (CER) / periodo scadenze (F) | **escluso** Q1-Q16 (D30) / `periodo_scadenze` |
| 19 | `CATEG` | categoria di addebito | `categoria_id` → `codifiche_addebito` (`CATEGORIA`) |
| 20 | `CONTROP` | contropartita | **escluso**: 4.4 (D30) |
| 21 | `CCR` | centro di costo/ricavo | `centro_ricavo_id` → `codifiche_addebito` (`CENTRO_RICAVO`) |
| 22 | `SPECIAL` | 7 fasce × 5 | `scaglioni_riga_addebito` |
| 23 | `INTEND` | applica a 1-7 | `applica_a` (1-5; 6-7 regola 11, D30) |
| 24-35 | `SCA1-12` | scadenze dei fissi | `scadenze_riga_addebito` |
| 36-47 | `GIAF1-12` | già fatturato | **4.4** (D15) |
| 48 | `CONDIZ` | condizione 1-9 | `condizione` |
| 49-50 | `FACC`, `FDET` | acconto fatturato/detratto | **4.4** (D15) |
| 51 | `SOMMA` | condizioni (prezzo S) o minimo | `condizioni_riferite` / `minimo_fatturabile` |
| 52 | `DATAC` | gg-mm di riferimento/conguaglio | `riferimento_giorno`, `riferimento_mese` |
| 53 | `CFATT` | conguaglio fatturato | **4.4** (D15) |
| 54 | `C1` | stima annua kg (regola 05: scadenza e blocco; fornitori: condizioni) | `stima_annua_kg` / **esclusi** 05 e fornitori (D30) |
| 55 | `C2` | CER di proposta (V) / addebiti proposti (CER) / rimandi (11) | `cer_proposta[]`, `addebiti_proposti[]` / **escluso** rimandi (D30) |
| 56 | `C3` | appunti (135) | `appunti` VarChar(135) |
| 57 | `C4` [0] | nota uso interno | `nota_uso_interno` VarChar(45) |
| 57 | `C4` [1] | periodo extra | `periodo_extra_dal`, `periodo_extra_al` |
| 57 | `C4` [2] | `XX` minimo per categoria | `minimo_per_categoria` |
| 57 | `C4` [3-10] | — | **escluso**: mai scritti |
| — | `VER`, `ID`, `IDT`, `BLOK`, `IMPORT` | tecnici | `versione`, audit, **esclusi** |

**M3. `[ADDEBITI]`** (E8; nomi dalle posizioni di `Registra`, I per 32-35)

| # | WinWaste | Contenuto | WasteFlow (`addebiti` salvo indicazione) |
|---|---|---|---|
| 0 | `COD` | codice (5) | `codice` VarChar(5) |
| 1 | `DES` | descrizione (45) | `descrizione` |
| 2 | `GRUPPO` | gruppo (obbligatorio) | `gruppo_id` → `codifiche_addebito` (`GRUPPO`) |
| 3 | `UM` | unità di misura | `unita_misura` |
| 4 | `IVA` | codice IVA | `codice_iva_id` |
| 5-22 | `P1`…`A6` | sei listini (prezzo, sconto, provvigione) | `prezzi_listino_addebito` (numero 1-6) |
| 23 | `TIPO` | tipo predefinito | `tipo` |
| 24 | `CAT` | categoria | `categoria_id` |
| 25 | `TPROV` | 1 scontato / 2 lordo | `tipo_provvigione` |
| 26 | `CONTROP` | contropartita ricavi | **escluso**: 4.4 (D30) |
| 27 | `CCR` | centro | `centro_ricavo_id` |
| 28-29 | `CAT1`, `CAT2` | categorie statistiche | `categoria_statistica_1_id`, `categoria_statistica_2_id` |
| 30-31 | `CODART`, `LARTIC` | articolo di magazzino | **escluso**: nessun magazzino (D30) |
| 32-33 | appunti 1 e 2 | testo F9 | `appunti` (un campo) |
| 34 | flag autodemolitori | proposta in fatturazione autodemolitori | **escluso**: verticale con chiave di licenza (D30) |
| 35 | `C4` [0] / [12] | nota uso interno / tipo ricavo (regola 11) | `nota_uso_interno` / **escluso** |
| — | (tecnici) | versione, utente | `versione`, audit |

### Schema e migration (riassunto)

```prisma
enum GenereCodificaAddebito { GRUPPO CATEGORIA CATEGORIA_STATISTICA_1 CATEGORIA_STATISTICA_2 CENTRO_RICAVO @@map("genere_codifica_addebito") }
enum TipoProvvigione { SCONTATO LORDO @@map("tipo_provvigione") }
enum TipoQuantitaAddebito { PESO_NETTO PESO_LORDO VOLUME UNO ALTRO @@map("tipo_quantita_addebito") }
enum TipologiaRifiutoAddebito { URBANO URBANO_PERICOLOSO SPECIALE SPECIALE_PERICOLOSO @@map("tipologia_rifiuto_addebito") }
enum ApplicaPrezzoSpeciale { DOCUMENTO PERIODO PROGRESSIVO_DA_DATA CONGUAGLIO_365 GIORNO @@map("applica_prezzo_speciale") }
model CodiceIva              // codici_iva (D3)            @@unique([id, tenantId]) ([tenantId, codice])
model CodificaAddebito       // codifiche_addebito (D4)    @@unique([id, tenantId]) ([tenantId, genere, codice])
model Addebito               // addebiti (D6)              @@unique([id, tenantId]) ([tenantId, codice])
model PrezzoListinoAddebito  // prezzi_listino_addebito    @@unique([addebitoId, numero])
model ElencoAddebiti         // elenchi_addebiti (D8)      @@unique([id, tenantId]) ([contrattoId, codice])
model AllegatoElencoAddebiti // allegati_elenco_addebiti   @@unique([elencoId, posizione])
model RigaAddebito           // righe_addebito (D9)        @@unique([id, tenantId])
model ScaglioneRigaAddebito  // scaglioni_riga_addebito    @@unique([rigaId, ordine])
model ScadenzaRigaAddebito   // scadenze_riga_addebito     @@unique([rigaId, ordine])
// Cliente (4.1b) + listino Int? @db.SmallInt, provvigionePredefinita String? @db.VarChar(20),
//                  tipoProvvigionePredefinita TipoProvvigione?
```

Prima migration (Task 7) `20261102300000_listino_archivio_addebiti`: tipi
`genere_codifica_addebito`, `tipo_provvigione`; tabelle `codici_iva`, `codifiche_addebito`,
`addebiti`, `prezzi_listino_addebito`; `ALTER TABLE clienti ADD COLUMN listino SMALLINT, ADD COLUMN
provvigione_predefinita VARCHAR(20), ADD COLUMN tipo_provvigione_predefinita tipo_provvigione` (null
senza default: solo catalogo, nessuna riscrittura) e i due CHECK `NOT VALID` seguiti da `VALIDATE
CONSTRAINT` (non blocca le scritture); RLS sulle quattro tabelle. Seconda (Task 19)
`20261102300100_listino_elenchi_righe`: tipi `tipo_quantita_addebito`,
`tipologia_rifiuto_addebito`, `applica_prezzo_speciale`; le cinque tabelle; RLS. Ripristino a mano
nel commento di testa e in `ops/README.md`: la seconda prima della prima;
`ALTER TABLE clienti DROP COLUMN …` per le tre colonne (dati persi: esportarli prima).

---

## Vincoli globali

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né `Claude-Session` né altro). Niente push.
- Commenti e testi in italiano, termini tecnici non tradotti. Messaggi all'utente in italiano, senza
  id né dati personali.
- Azienda sempre da `requireRequestTenantId(req)`; `@Roles` esplicito su **ogni** rotta (D26).
  `controller-tenant-selezionato.spec.ts` e `nessun-user-userid.spec.ts` verdi con i controller
  nuovi. La sessione unica non riguarda questo pezzo.
- **Database di test di questo worktree: `wasteflow-pg-test-registro` su `127.0.0.1:55438`.** Mai
  le porte degli altri worktree (55432, 55434, 55436, 55440, 55442, 55444). Niente `DOCKER_HOST`.
  In ogni shell:
  ```bash
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di **ogni** suite Postgres
  `[[ "$DATABASE_URL" == *":55438/"* ]] || { echo "DATABASE_URL non punta a 55438: fermo"; exit 1; }`.
- Prisma solo dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica dello
  schema `npx prisma generate`.
- Test Postgres col ruolo **`wasteflow_app`** (modello
  `src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`), lanciati con
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`. Pulizia
  **solo per id esatti creati**: `const tenantCreati: string[] = []` e in `afterAll`
  `if (tenantCreati.length > 0) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })`;
  se una FK `NoAction` lo impedisce, cancellare prima in ordine righe → elenchi → addebiti →
  codifiche addebito → codici IVA, poi le tabelle della 4.1, sempre con `tenantId: { in:
  tenantCreati }`. **Mai** un `deleteMany` con filtro che può essere `undefined`. Fixture del pezzo:
  `src/test-support/listino-di-test.ts` (Task 8 per codici IVA e codifiche, Task 9 per gli addebiti,
  Task 20 per elenchi e righe), costruita su `creaTabelleFatturazione` e `creaDittaConRuolo`.
- **RAM (16 GB): un solo processo pesante alla volta**, sempre attraverso il lock
  `flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-02-fase4-2-listino/pesante.lock <comando>`.
  jest mirato `npx jest -w 2 <percorsi>`; a fine task backend **una volta**
  `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`; lint dei file
  toccati senza `--fix`, mai `npm run lint`. Karma **una volta** a fine task frontend. Mai Karma e
  jest insieme.
- Fine task backend: `test:cov`, `npx tsc --noEmit -p tsconfig.json`, eslint globale backend
  `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da `apps/backend` con **0 errori**, le suite
  Postgres toccate più `rls-catalogo.postgres.spec.ts` (**59** dal Task 7, **64** dal Task 19).
  Confronto con la linea di base del Task 0 (o del Task 16 per la 4.2b).
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55438; dalla root
  `DB_APP_PASSWORD=… DB_SISTEMA_PASSWORD=… PG_EXEC="docker exec -i wasteflow-pg-test-registro" bash ops/db-ruoli.sh`;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/shadow_listino?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-registro psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_listino"` / `"DROP DATABASE shadow_listino"`) → **vuoto**
  (o solo le note preesistenti di master). Migration **additive**: `SET LOCAL lock_timeout = '5s';`
  in testa, solo `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` su tabelle nuove e vuote; **unica
  eccezione** le tre `ADD COLUMN` nullable su `clienti` del Task 7 con i CHECK `NOT VALID` +
  `VALIDATE` (D7, Q3); nessun indice parziale; nomi di vincoli e indici ≤ 63 caratteri, uguali in
  schema e SQL; FK verso `tenants` `<tabella>_tenant_id_fkey`, composite `<tabella>_<riferimento>_fkey`
  (R17 della 4.1a).
- Task frontend: `cd apps/frontend && CHROME_BIN=/home/graziano/.cache/chrome-test/chrome-headless-shell/linux-156.0.8078.80/chrome-headless-shell-linux64/chrome-headless-shell npx ng test --watch=false --browsers=ChromeHeadless`
  (una volta), `npm run build`, dalla root `npx eslint <file toccati> --max-warnings=-1`.
- Aree che questo pezzo **non** tocca: `application/contracts/**`, `domain/contracts/**`,
  `fe/features/contracts/**`, `application/fir/**`, `api/fir/**`, `application/registro/**` e
  `api/registro/**` (si **importano** `normalizzaCerCode` e `cerNelCatalogo`), `application/rentri/**`,
  `application/pese/**`, `domain/pese/**`, `api/pese/**` (si importano `riconosciTipoFile`,
  `DIMENSIONE_MASSIMA_ALLEGATO`, `nelContestoTenant`), `core/filters/**`, `prisma/sql/ruoli-db.sql`,
  `WasteMovement`, `FIR`. Toccati in modo **mirato**: `application/contratti-cliente/contratti-cliente.service.ts`
  (+ spec, solo D17), `application/clienti/clienti.service.ts`, `domain/clienti/dati-fiscali-cliente.ts`,
  `api/clienti/dto/*cliente*.dto.ts` (solo D7), `fe/features/clienti/{clienti.model,cliente-dialog.component,clienti-list.component}.ts`
  (D7, D28), `fe/features/clienti/tabelle/tabelle-fatturazione.component.ts` (due schede),
  `fe/features/contratti-cliente/{contratti-cliente-list,contratto-cliente-dialog}.component.ts`
  (pulsante "Listino" e menu "Variazioni prezzi"), `app.module.ts` (una riga), `app.routes.ts`.
  Se un task scopre di doverne toccare un'altra, si ferma e lo segnala.
- **Convivenza con altri branch.** File a rischio: `schema.prisma` (enum e modelli **in coda**, dopo
  `AllegatoContrattoCliente`; su `Tenant`, `ContrattoCliente`, `Cliente` solo relazioni inverse in
  fondo), `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`, `README-tenant-transazione.md`,
  `ops/README.md`, `app.module.ts`, `app.routes.ts`, `layout.component.ts`. Al rebase: somma dei
  conteggi RLS, `prisma generate`, `migrate deploy`, `migrate diff` vuoto; se master riceve una
  migration con timestamp successivo a `20261102300000`, rinominare **solo** le nostre non ancora in
  produzione, nello stesso ordine.

## Review focus

Le situazioni più probabili in uso reale, ognuna col suo test:

1. **Variazione di massa mentre un collega modifica una riga dello stesso contratto**: la variazione
   passa, il salvataggio del collega riceve 409 e niente si sovrascrive → Task 24 Postgres `riga
   modificata durante la variazione: 409 al salvataggio, prezzo della variazione`.
2. **Anteprima vecchia**: un operatore applica una variazione dopo che un altro ha cambiato una riga
   del perimetro → 409 `VARIAZIONE_SUPERATA`, nessuna riga scritta → Task 24.
3. **Un contratto diventa allegato mentre un collega gli aggiunge una riga CER** → una delle due
   operazioni fallisce, mai un allegato con righe CER → Task 22 Postgres `allegamento e riga CER
   concorrenti`.
4. **Tabella del prezzo speciale con un buco o soglie non crescenti** (fascia 3 vuota e 4 piena,
   1000 poi 800) → 400 col messaggio, niente scritto → Task 4 e Task 21.
5. **Esempio di `fatturazione.md` §4.5**: 6.000 kg con tipo A → 470,00, con D → 300,00; sconto
   `10+5` su 100,00 → 14,50; provvigione su lordo e su scontato → Task 3 e 4.
6. **Riferimento di un'altra azienda** (codice IVA, addebito, elenco sorgente della copia) → 400 dal
   servizio e FK composita → Task 7, 19, 21, 23 `… di un altro tenant`.
7. **Due operatori creano in linea un gruppo nello stesso istante** → due codici diversi → Task 8.
8. **ISTAT applicato due volte per errore**: la seconda anteprima mostra i prezzi già aumentati,
   l'audit le distingue; contratti senza flag ISTAT mai toccati → Task 24 `contratto senza
   incremento ISTAT: invariato`.
9. **Copia di un elenco con minimi, acconti e conguagli** → esclusi e contati, il resto copiato con
   fasce e scadenze → Task 23.
10. **Listino di un contratto annullato** → sola lettura in API (409) e in UI (niente pulsanti) →
    Task 20, 21, 29.
11. **Scadenza 29/02 senza anno e calendario trimestrale da marzo con anno vuoto** → valida / 400 col
    messaggio di E19 → Task 18.

---

## Task 0: ambiente e linea di base (4.2a)

**File:** nessuno (solo verifica).

- [ ] **Step 1: database di test.** Se il container `wasteflow-pg-test-registro` è acceso con lo
  schema a 55 tabelle RLS, si riusa; altrimenti si ricrea come il Task 0 della 4.1 (stesso comando
  `docker run … postgres:16-alpine`). Variabili dei Vincoli globali; `npm ci` solo se `node_modules`
  manca. Cartella `.superpowers/sdd/2026-11-02-fase4-2-listino/` con il file `pesante.lock`.
- [ ] **Step 2: schema e ruoli.** `npx prisma migrate deploy` (ultima
  `20261102200100_clienti_agenti_contratti_cliente`), `npx prisma generate`, `bash ops/db-ruoli.sh`
  con `PG_EXEC`, `npx ts-node prisma/seed.ts` (catalogo CER) se `cer_codes` è vuota.
- [ ] **Step 3: linea di base.** `test:cov`, `tsc`, `rls-catalogo.postgres.spec.ts` (55),
  `contratti-cliente.service.postgres.spec.ts`, `clienti.service.postgres.spec.ts`. Annotare i test
  già rossi.

## Task 1: dominio puro — codici IVA e nature

**File:** Create `apps/backend/src/domain/listino/codice-iva.ts`, `codice-iva.spec.ts`.

**Interfaces (Produces):**
```ts
export const NATURE_IVA: readonly string[]   // N1, N2.1, N2.2, N3.1…N3.6, N4, N5, N6.1…N6.9, N7
export interface DatiCodiceIva { codice: string; descrizione: string; aliquota: string /* "22.00" */; natura: string | null; attivo: boolean }
export function normalizzaCodiceIva(g: Partial<Record<keyof DatiCodiceIva, unknown>>): DatiCodiceIva
export function validaCodiceIva(d: DatiCodiceIva): string[]
```

- [ ] **Step 1: test che falliscono:** `22 senza natura valido`; `0 senza natura: messaggio D3`;
  `0 con N6.1 valido`; `10 con natura: messaggio`; `N2 generica rifiutata` (scartata dallo SDI);
  `aliquota 100.01 / -1 / "abc": messaggio`; `"22,5" → "22.50"`; `codice di 4 caratteri: messaggio`;
  `descrizione vuota o > 60: messaggio`; `più errori nell'ordine dei campi`.
- [ ] **Step 2:** FAIL. **Step 3:** implementare (commento di testa: D3, FatturaPA, perché non si
  porta l'indetraibile). **Step 4:** PASS, eslint, `tsc`.
- [ ] **Step 5: commit** `feat(listino): regole pure dei codici IVA e delle nature FatturaPA -- <2 file>`

## Task 2: dominio puro — codifiche di addebito e tipi di addebito

**File:** Create `apps/backend/src/domain/listino/{codifica-addebito,tipi-addebito}.ts` + spec.

**Interfaces (Produces):**
```ts
// codifica-addebito.ts
export type GenereCodificaAddebito = 'GRUPPO' | 'CATEGORIA' | 'CATEGORIA_STATISTICA_1' | 'CATEGORIA_STATISTICA_2' | 'CENTRO_RICAVO'
export const ETICHETTE_GENERE_ADDEBITO: Readonly<Record<GenereCodificaAddebito, string>>  // "Gruppo", "Categoria di addebito", "Categoria statistica 1", "Categoria statistica 2", "Centro di ricavo"
export function normalizzaCodificaAddebito(g): DatiCodificaAddebito
export function validaCodificaAddebito(d): string[]      // codice 001-999 a 3 cifre (come E29), descrizione ≤ 45
// riusa primoCodiceLibero da domain/clienti/codifica-contratto.ts (import, nessuna modifica)

// tipi-addebito.ts
export type TipoAddebito = string   // validato da tipoAddebitoValido
export type FamigliaAddebito = 'CER' | 'VARIABILE' | 'FISSO' | 'QUANTITA_MOVIMENTI' | 'CONTEGGIO' | 'MINIMO' | 'ACCONTO'
export function tipoAddebitoValido(t: string): boolean
export function famigliaTipo(t: string): FamigliaAddebito
export function etichettaTipo(t: string): string            // E5, con ??? sostituito
export const TIPI_ELENCABILI: readonly { tipo: string; etichetta: string }[]   // per i menu (T??? e M??? come modelli)
export function tipoAmmessoInArchivio(t: string): boolean    // tutti tranne CER
export function tipoAmmessoInAllegato(t: string): boolean    // solo T… (D17)
```

- [ ] **Step 1: test che falliscono:** ogni tipo di E5 riconosciuto con la sua famiglia; `T123`,
  `M001` validi, `T12`, `TX`, `$X`, `CERX` no; etichette (`T005` → "… di cat. 005 del presente
  elenco"); `CER` non ammesso in archivio; in allegato solo `T…`; codifica: codice `7` → `"007"`,
  `1000` rifiutato, descrizione > 45 rifiutata.
- [ ] **Step 2-4:** FAIL, implementare, PASS + eslint + `tsc`.
- [ ] **Step 5: commit** `feat(listino): tipi di addebito e codifiche di addebito (regole pure)`.

## Task 3: dominio puro — importi della riga

**File:** Create `apps/backend/src/domain/listino/importi-riga.ts` + spec.

**Interfaces (Produces):**
```ts
export function arrotonda2(v: string): string                       // metà per eccesso in valore assoluto
export function cascataValida(f: string | null): boolean            // E10
export function normalizzaCascata(f: unknown): string | null        // "10 + 5,5" → "10+5.5"
export function scontoCascata(importo: string, formula: string | null): string
export function importoRiga(quantita: string, prezzo: string, sconto: string | null): { lordo: string; sconto: string; netto: string }
export function provvigioneRiga(i: { lordo: string; netto: string }, formula: string | null, tipo: 'SCONTATO' | 'LORDO'): string
export function quantitaDaMovimento(tipo: 'PESO_NETTO'|'PESO_LORDO'|'VOLUME'|'UNO'|'ALTRO', um: string, m: { netto?: string; lordo?: string; volume?: string; umVolume?: 'L'|'M' }): string | null
export function oreDecimali(hmm: string): string                    // "1,30" → "1.5"
```

- [ ] **Step 1: test che falliscono:** `arrotonda2("2.345") = "2.35"`, `("-2.345") = "-2.35"`,
  `("2.344") = "2.34"`; `scontoCascata("100.00","10+5") = "14.50"`; `("33.33","10") = "3.33"`;
  `importoRiga("3","0.3333","")` → lordo `1.00`; `provvigioneRiga` su lordo e su netto; cascate non
  valide (`"10++5"`, `"10+5+2+1"`, `"100"`, `",5"`, `"5,"`, `"1,2,3"`); `quantitaDaMovimento`:
  netto in `TON` diviso 1000, litri → `MC` diviso 1000, m³ → `LT` per 1000, `UNO` → "1", `ALTRO` →
  null; `oreDecimali("2,45") = "2.75"`. Nessun `number` JS negli importi (test con
  `"0.1"+"0.2"`).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): importi, sconto e provvigione a cascata della riga (E9, E10)`.

## Task 4: dominio puro — prezzo speciale a scaglioni

**File:** Create `apps/backend/src/domain/listino/prezzo-speciale.ts` + spec. Usa Task 3.

**Interfaces (Produces):**
```ts
export type TipoCalcoloScaglione = 'A'|'B'|'C'|'D'|'E'|'X'|'Y'|'Z'|'W'|'H'
export interface Scaglione { ordine: number; finoA: string | null; prezzo: string; sconto: string | null; provvigione: string | null; tipoCalcolo: TipoCalcoloScaglione }
export type ApplicaPrezzoSpeciale = 'DOCUMENTO'|'PERIODO'|'PROGRESSIVO_DA_DATA'|'CONGUAGLIO_365'|'GIORNO'
export function validaScaglioni(s: readonly Scaglione[], contesto: { conCondizioni: boolean }): string[]
export function validaPrezzoSpeciale(r: { applicaA: ApplicaPrezzoSpeciale | null; condizioniRiferite: string | null; unitaMisura: string; riferimentoGiorno: number | null; riferimentoMese: number | null; condizione: number | null; sconto: string | null; provvigione: string | null; minimoFatturabile: string | null; tipoProvvigione: string | null }, scaglioni: readonly Scaglione[]): string[]
export interface RigaScaglione { descrizione: string; quantita: string; prezzo: string; sconto: string | null; provvigione: string | null }
export function applicaScaglioni(s: readonly Scaglione[], quantita: string, unita: string, o?: { quantitaPrecedente?: string; condizione?: 'P' | 'C'; quantitaCondizionati?: string }): { righe: RigaScaglione[]; condizioneVerificata: boolean } | { errore: string }
```

- [ ] **Step 1: test che falliscono:** l'esempio di `fatturazione.md` §4.5 con A (470,00 in tre righe
  con le descrizioni attese) e con D (300,00 in una riga); B (solo la fascia più alta, quantità 1,
  ": imp.fisso"); C (un fisso per ogni fascia raggiunta); E (solo la 7, tutta la quantità); quantità
  zero → prima fascia; `quantitaPrecedente` che scala fascia per fascia (porta di `umiscondiz` = 5
  spazi); varianti X/Y/Z/W/H → `condizioneVerificata`; X senza condizione → errore; tabella con
  buco, con soglie non crescenti, riga 1 senza soglia, riga 7 senza prezzo → messaggi D12;
  `validaPrezzoSpeciale`: HR, condizione, sconto di riga, minimo, `K/M` con `PERIODO`, condizioni con
  `PROGRESSIVO_DA_DATA`, conguaglio senza data → messaggi D12.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): prezzo speciale a scaglioni, porta di speciale (E12-E14)`.

## Task 5: dominio puro — archivio degli addebiti, listini e proposta

**File:** Create `apps/backend/src/domain/listino/addebito.ts` + spec. Usa Task 1-3.

**Interfaces (Produces):**
```ts
export interface PrezzoListino { numero: 1|2|3|4|5|6; prezzo: string | null; sconto: string | null; provvigione: string | null }
export interface DatiAddebito { codice: string; descrizione: string; gruppoId: string | null; unitaMisura: string; codiceIvaId: string | null; tipo: string; categoriaId: string | null; tipoProvvigione: 'SCONTATO'|'LORDO'; centroRicavoId: string | null; categoriaStatistica1Id: string | null; categoriaStatistica2Id: string | null; notaUsoInterno: string | null; appunti: string | null; listini: PrezzoListino[]; attivo: boolean }
export function normalizzaCodiceAddebito(v: unknown): string | null          // "12" → "00012"
export function normalizzaAddebito(g): DatiAddebito                         // listini: sempre 6, vuoti = null
export function validaAddebito(d: DatiAddebito): string[]
export function prezzoProposto(listini: readonly PrezzoListino[], listinoCliente: number | null): PrezzoListino | null   // E7
export function provvigioneProposta(daListino: { provvigione: string | null; tipo: 'SCONTATO'|'LORDO' }, cliente: { provvigione: string | null; tipo: 'SCONTATO'|'LORDO' | null }): { provvigione: string | null; tipo: 'SCONTATO'|'LORDO' }
```

- [ ] **Step 1: test che falliscono:** codice `"00000"` riservato, `"123456"` rifiutato; gruppo
  mancante; `T…` con UM `KG`/`TON` sì, `LT` no; `CER` come tipo d'archivio no; listino con prezzo
  `"1,5"` → `"1.5"`, cascata non valida → messaggio con il numero del listino ("Listino 3: …");
  `prezzoProposto`: cliente con listino 4 → listino 4; senza listino e solo il listino 1 pieno → 1;
  senza listino e il 2 pieno → null; `provvigioneProposta`: quella del cliente vince se presente.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): archivio addebiti con sei listini e proposta di prezzo (E7, E8)`.

## Task 6: dominio puro — variazioni di prezzo e ISTAT

**File:** Create `apps/backend/src/domain/listino/variazione-prezzi.ts` + spec. Usa Task 3.

**Interfaces (Produces):**
```ts
export type TipoVariazione = 'AUMENTO_PERCENTUALE'|'AUMENTO_IMPORTO'|'DIMINUZIONE_PERCENTUALE'|'DIMINUZIONE_IMPORTO'|'SOSTITUZIONE_IVA'
export function nuovoPrezzo(attuale: string, tipo: Exclude<TipoVariazione,'SOSTITUZIONE_IVA'>, valore: string): { prezzo: string } | { errore: string }
export function nuoviScaglioni<T extends { prezzo: string }>(s: readonly T[], f: (p: string) => { prezzo: string } | { errore: string }): { scaglioni: T[] } | { errore: string }   // zero e vuoti invariati
export interface PercentualeIstat { anno: number; mese: number; percentuale: string }
export function validaPercentualiIstat(p: readonly PercentualeIstat[]): string[]
export function aumentoIstat(attuale: string, percentuale: string): { prezzo: string } | { errore: string }   // ≤ 0 → errore
export function improntaVariazione(righe: readonly { id: string; versione: number }[]): string   // SHA-256 ordinato per id
```

- [ ] **Step 1: test che falliscono:** `+10%` su `"12.5"` → `"13.75"`; su `"0.0125"` → `"0.01375"`
  (precisione dei decimali significativi, minimo 2); `+0.5` importo su `"10"` → `"10.5"`; `−20%` su
  `"1"` → `"0.80"`; `−15` su `"10"` → errore "Il nuovo prezzo sarebbe negativo."; scaglioni con
  prezzi zero invariati; ISTAT: percentuali `[3.0 (2024-01), 2.5 (2024-05)]` valide, `[2, 3]`
  rifiutate, `100` rifiutata, `0` rifiutata; impronta stabile per ordine diverso, diversa al cambio
  di una versione.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): variazioni automatiche di prezzo e adeguamento ISTAT (regole pure)`.

## Task 7: schema A — archivio e tabelle; migration, RLS (55 → 59)

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (enum `GenereCodificaAddebito`, `TipoProvvigione`;
  modelli `CodiceIva`, `CodificaAddebito`, `Addebito`, `PrezzoListinoAddebito` in coda; tre campi e
  relazioni inverse su `Cliente`; relazioni inverse su `Tenant`)
- Create: `apps/backend/prisma/migrations/20261102300000_listino_archivio_addebiti/migration.sql`
- Modify: `prisma-rls.extension.ts` (4 voci, commento "Listino (Fase 4 pezzo 2a)"),
  `rls-catalogo.postgres.spec.ts` (55 → 59), `README-tenant-transazione.md` (tre punti), `ops/README.md`
- Create: `apps/backend/src/application/listino/listino-archivio.schema.postgres.spec.ts`

- [ ] **Step 1: test che falliscono** (ruolo app nel contesto, proprietario per preparare): `codice
  IVA con aliquota 0 e senza natura respinto`; `stesso codice IVA due volte: P2002`; `codifica:
  stesso codice in generi diversi ammesso`; `addebito con codice 00000 respinto`; `listino 7
  respinto`; `due prezzi per lo stesso listino: P2002`; `FK composita: addebito col gruppo di un
  altro tenant respinto`; `cancellare l'addebito cancella i suoi listini`; `clienti: listino 7
  respinto, provvigione senza tipo respinta, cliente esistente invariato` (la colonna è nullable);
  `RLS: nel contesto di B le quattro tabelle di A sono vuote e un insert con tenant di A è
  respinto`; `cancellare il tenant cancella le quattro tabelle`.
- [ ] **Step 2:** FAIL (guardia 55438).
- [ ] **Step 3: schema** in coda dopo `AllegatoContrattoCliente`, `///` su ogni modello (cosa, D, dove
  sono le regole).
- [ ] **Step 4: migration** (commento di testa come `20261102200000_…`, con ripristino a mano: `DROP
  TABLE prezzi_listino_addebito, addebiti, codifiche_addebito, codici_iva; ALTER TABLE clienti DROP
  COLUMN tipo_provvigione_predefinita, DROP COLUMN provvigione_predefinita, DROP COLUMN listino; DROP
  TYPE tipo_provvigione, genere_codifica_addebito;` + `DELETE FROM _prisma_migrations …`, da fare
  **dopo** il ripristino della migration del Task 19): `SET LOCAL lock_timeout`, tipi, tabelle con
  PK, unici, CHECK, FK, indici, `ALTER TABLE clienti` (D7, CHECK `NOT VALID` + `VALIDATE`), RLS.
- [ ] **Step 5:** RLS (4 modelli), catalogo a 59, README, `ops/README.md` ("**Archivio addebiti e
  codici IVA** (Fase 4 pezzo 2a)": rollback del codice innocuo, conteggi prima del ripristino,
  ordine).
- [ ] **Step 6: verifiche** dei Vincoli globali (generate, validate, deploy + `db-ruoli.sh`, `migrate
  diff` vuoto: il CHECK su `clienti` non deve comparire), spec PASS, suite di fine task.
- [ ] **Step 7: commit** `feat(listino): archivio addebiti, listini, codici IVA e codifiche con RLS; listino e provvigione del cliente`.

## Task 8: ListinoModule, codici IVA e codifiche di addebito (servizi e API)

**File:**
- Create: `apps/backend/src/application/listino/{codici-iva,codifiche-addebito}.service.ts` + spec
  unitari + `codici-iva.service.postgres.spec.ts`, `codifiche-addebito.service.postgres.spec.ts`
- Create: `apps/backend/src/api/listino/{listino.module,codici-iva.controller,codifiche-addebito.controller}.ts`
  + spec, `apps/backend/src/api/listino/dto/{codice-iva,codifica-addebito}.dto.ts`
- Create: `apps/backend/src/test-support/listino-di-test.ts` (`creaCodiciIvaEcodifiche(owner,
  tenantId)` → `{ iva22Id, ivaN61Id, gruppoId, categoriaId, centroId, stat1Id, stat2Id }`)
- Modify: `apps/backend/src/app.module.ts` (import e registrazione di `ListinoModule` dopo `ClientiModule`)

**Interfaces (Produces):**
```ts
export interface CodiceIvaVista extends DatiCodiceIva { id: string; versione: number; eliminabile: boolean }
export interface CodificaAddebitoVista { id: string; genere: GenereCodificaAddebito; codice: string; descrizione: string; attiva: boolean; versione: number; eliminabile: boolean }
// ListinoModule: imports [PrismaModule, AuthModule, RuoloEffettivoModule]; controllers e providers del pezzo; exports dei servizi
```

- [ ] **Step 1: test** sul modello dei servizi delle codifiche della 4.1 (`codifiche-contratto.service.ts`,
  stessi casi): crea, lista con disattivati, modifica con versione, 409 versione, 409 codice
  duplicato (P2002 con `rileggi`), elimina, `prossimo-codice`, creazione rapida senza codice e
  `primo codice libero concorrente` (Postgres: due crea paralleli → due codici); `contaUsi` batch
  (D: colonne di `addebiti` in questo task; `righe_addebito` arrivano nel Task 22), `in uso da un
  addebito: elimina 409 "… disattivalo/disattivala invece di eliminarlo"`; controller: ruoli,
  `ParseUUIDPipe`, `genere` obbligatorio.
- [ ] **Step 2-4:** implementare, PASS, suite di fine task.
- [ ] **Step 5: commit** `feat(listino): codici IVA e codifiche di addebito (servizi, API, modulo)`.

## Task 9: archivio degli addebiti (servizio e API)

**File:**
- Create: `apps/backend/src/application/listino/addebiti.service.ts` + spec + `addebiti.service.postgres.spec.ts`
- Create: `apps/backend/src/api/listino/addebiti.controller.ts` + spec, `dto/addebito.dto.ts`
- Modify: `apps/backend/src/api/listino/listino.module.ts`, `src/test-support/listino-di-test.ts`
  (`creaAddebito(owner, tenantId, dati?)`)

**Interfaces (Produces):**
```ts
export interface RiferimentoCodifica { id: string; codice: string; descrizione: string }
export interface AddebitoVista {
  id: string; codice: string; descrizione: string; gruppo: RiferimentoCodifica; unitaMisura: string
  codiceIva: { id: string; codice: string; descrizione: string } | null; tipo: string; etichettaTipo: string
  categoria: RiferimentoCodifica | null; tipoProvvigione: 'SCONTATO' | 'LORDO'; centroRicavo: RiferimentoCodifica | null
  categoriaStatistica1: RiferimentoCodifica | null; categoriaStatistica2: RiferimentoCodifica | null
  notaUsoInterno: string | null; appunti: string | null; listini: PrezzoListino[] /* sempre 6 */
  attivo: boolean; versione: number; eliminabile: boolean
}
export interface FiltroAddebiti { testo?: string; tipo?: string; soloAttivi?: boolean; pagina: number; dimensione: number }
```

- [ ] **Step 1: test:** crea con sei listini e lettura (sempre 6, vuoti null); `prossimo-codice`
  (primo `00001`… libero, come 4.1 D12 col conteggio degli eliminati non pertinente: fisici);
  riferimenti di genere sbagliato (categoria al posto del gruppo) → 400; codice IVA disattivato →
  400; riferimenti letti con `FOR SHARE` (R24 della 4.1b); modifica dei listini in blocco nella
  stessa scrittura condizionata; 409 versione e codice duplicato; elimina fisica, `in uso`
  (`contaUsi` resta 0 finché il Task 22 non aggiunge le righe); filtro `testo` su codice e
  descrizione, paginazione; audit senza `appunti` né `notaUsoInterno`.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): archivio generale degli addebiti (servizio e API)`.

## Task 10: variazione prezzi dell'archivio (servizio e API)

**File:**
- Create: `apps/backend/src/application/listino/variazioni-archivio.service.ts` + spec + postgres spec
- Modify: `apps/backend/src/api/listino/addebiti.controller.ts` (+ spec: rotte `variazioni-prezzi/…`
  **prima** di `:id`), `dto/variazione-prezzi.dto.ts` (nuovo, condiviso col Task 24), `listino.module.ts`

**Interfaces (Produces):**
```ts
export interface FiltroVariazioneArchivio { addebitiIds?: string[]; categorieIds?: string[]; tipi?: string[]; listini?: (1|2|3|4|5|6)[] }
export interface CorpoVariazione<F> { tipo: TipoVariazione; valore?: string; daCodiceIvaId?: string; aCodiceIvaId?: string; filtri: F }
export interface AnteprimaVariazione { totale: number; righe: { id: string; descrizione: string; listino?: number; prima: string; dopo: string }[]; errori: { id: string; descrizione: string; messaggio: string }[]; impronta: string }
```

- [ ] **Step 1: test:** anteprima per listini 2 e 4 e categoria; sostituzione IVA sull'addebito;
  applicazione con impronta giusta (una transazione, `versione + 1` sugli addebiti toccati, un audit
  `PREZZI_ARCHIVIO_VARIATI` col conteggio); impronta superata → 409 e nulla scritto; risultato
  negativo → 400; solo `SUPER_ADMIN`/`ADMIN`; i contratti non cambiano.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): modifica automatica dei prezzi dell'archivio addebiti (E22)`.

## Task 11: listino e provvigione predefinita del cliente (modifica mirata)

**File:** Modify `apps/backend/src/domain/clienti/dati-fiscali-cliente.ts` (+ spec: tre campi, regole
D7), `apps/backend/src/application/clienti/clienti.service.ts` (+ spec, + postgres spec: lettura,
crea, modifica, confronto dei campi), `apps/backend/src/api/clienti/dto/*cliente*.dto.ts`
(`listino?: number` 1-6, `provvigionePredefinita?: string`, `tipoProvvigionePredefinita?`).

- [ ] **Step 1: test:** listino 0/7 → 400 col messaggio di D7; provvigione senza tipo → 400; cliente
  esistente letto con i tre campi null; modifica del solo listino → audit col nome del campo; il
  contratto creato dopo **non** eredita questi campi (non sono di `CAMPI_EREDITATI_DAL_CLIENTE`).
- [ ] **Step 2-4** e **Step 5: commit** `feat(clienti): listino e provvigione predefinita del cliente (4.2 D7)`.

## Task 12: frontend — modelli, servizio, vocabolario; schede codici IVA e codifiche

**File:**
- Create: `fe/features/listino/{listino.model,vocabolario-listino,listino.service}.ts` (+ spec del
  servizio e del vocabolario); `fe/features/listino/tabelle/{codice-iva-dialog,codici-iva-tab,codifica-addebito-dialog,codifiche-addebito-tab}.component.ts` + spec
- Modify: `fe/features/clienti/tabelle/tabelle-fatturazione.component.ts` (+ spec: due `p-tabPanel`
  "Codici IVA", "Gruppi e categorie di addebito")

**Interfaces:** i modelli copiano le `…Vista` dei Task 8-9 e (per la 4.2b) dei Task 20-25 **del
piano** (R29 della 4.1b): `CodiceIva`, `CodificaAddebito`, `Addebito`, `PrezzoListino`; il
vocabolario porta etichette dei tipi (dal dominio, copiate), famiglie, nature IVA, generi, tipi di
provvigione, tipi di quantità, "applica a", tipi di calcolo, periodi delle scadenze, e la tabella
**campo × famiglia** di D9 (`CAMPI_PER_FAMIGLIA`). `codifica-addebito-dialog` ha `@Input() genere` e
`@Input() rapida` come `codifica-dialog` della 4.1.

- [ ] **Step 1: test** (Karma): servizio (URL e parametri), vocabolario (ogni tipo di E5 ha
  etichetta e famiglia), schede (elenco, nuovo, modifica, elimina con conferma, 409 mostrato),
  dialog rapido senza codice.
- [ ] **Step 2-4:** implementare, Karma una volta, `npm run build`, eslint dei file.
- [ ] **Step 5: commit** `feat(listino): modelli e servizi del listino; schede codici IVA e codifiche di addebito`.

## Task 13: frontend — archivio degli addebiti

**File:** Create `fe/features/listino/{addebiti-list,addebito-dialog,variazione-archivio-dialog}.component.ts`
+ spec; Modify `fe/app.routes.ts` (rotta piatta `clienti/addebiti`), `fe/features/clienti/clienti-list.component.ts`
(+ spec: pulsante "Archivio addebiti").

- [ ] **Step 1: test:** lista paginata con ricerca e "solo attivi"; dialog con tabella dei sei
  listini (prezzo, sconto, provvigione) e "Nuovo …" in linea per gruppo, categoria, centro,
  statistiche, codice IVA (`AggiuntaInLinea`, Esc chiude solo il sub-dialog, focus restituito);
  tipo scelto dal menu dei tipi d'archivio con `T???`/`M???` che chiedono le tre cifre;
  variazione: anteprima in tabella, conferma con impronta, 409 → messaggio "rifai l'anteprima";
  VIEWER senza pulsanti.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): pagina dell'archivio addebiti con sei listini e variazione prezzi`.

## Task 14: frontend — listino e provvigione nel dialog del cliente (mirata)

**File:** Modify `fe/features/clienti/{clienti.model.ts,cliente-dialog.component.ts}` (+ spec).

- [ ] **Step 1: test:** tre campi nella sezione "Pagamento e fatturazione" (listino 1-6 come
  `p-dropdown` con "nessuno", provvigione a cascata, tipo S/L abilitato solo con provvigione),
  errori 400 mostrati sul campo; nessun cambiamento agli altri campi (spec esistenti verdi).
- [ ] **Step 2-4** e **Step 5: commit** `feat(clienti): listino e provvigione predefinita nel dialog del cliente`.

## Task 15: e2e 4.2a e chiusura

**File:** Create `e2e/tests/listino/archivio-addebiti.spec.ts`.

- [ ] **Step 1: spec e2e** (solo in CI): dalle tabelle crea un codice IVA 22 e un N6.1; crea un
  addebito "Trasporto" con gruppo creato in linea, listini 1 e 2; imposta il listino 2 su un
  cliente; variazione +10 % sul listino 2 con anteprima e conferma; VIEWER vede l'archivio senza
  pulsanti. In locale solo `npx tsc -p e2e/tsconfig.json --noEmit`.
- [ ] **Step 2:** `git diff --stat 8ed178a..HEAD`: solo i file dei Task 1-15 (aree mirate come da
  Vincoli).
- [ ] **Step 3:** backend completo (`test:cov`, `tsc`, eslint 0 errori, `npm run test:postgres`
  intera con guardia), frontend (Karma, build, eslint delle cartelle toccate), `migrate diff` vuoto,
  `rls-catalogo` 59.
- [ ] **Step 4: commit** `test(e2e): archivio addebiti dai codici IVA alla variazione prezzi`.
- [ ] **Step 5:** prima della PR `ci.yml` via `workflow_dispatch` sul branch; merge solo con
  `test-postgres` ed `e2e` verdi. Rapporto: rollback della migration, prova manuale consigliata.

---

## Task 16: dominio puro — elenco degli addebiti (4.2b, da master dopo la 4.2a)

**File:** Create `apps/backend/src/domain/listino/elenco-addebiti.ts` + spec. Prima: Step 0 = linea di
base come il Task 0 su master `869e98f` (RLS 59, ultima migration `20261102300000_…`, `migrate
status` pulito; numeri di riferimento in R34 dell'addendum), branch `feat/fase4-2b-righe-listino`.
Il primo task della 4.2b è il **Task 16a** dell'addendum.

**Interfaces (Produces):**
```ts
export interface DatiElenco { codice: string; descrizione: string; nota1: string | null; nota2: string | null; validoDal: string | null; validoAl: string | null; predefinito: boolean; codiceCig: string | null; codiceCup: string | null; idDocumentoPa: string | null; dataDocumentoPa: string | null }
export function normalizzaElenco(g): DatiElenco
export function validaElenco(d: DatiElenco): string[]      // D8; CIG/CUP/documento PA: stesse regole e stessi testi di validaContrattoCliente (regole-contratto-cliente.ts:490-502, non esportate: R33)
export function prossimoCodiceElenco(usati: readonly string[]): string | null
export function elenchiValidiAl<T extends { validoAl: string | null }>(e: readonly T[], data: string): T[]
export function elencoProposto<T extends { id: string; validoAl: string | null; predefinito: boolean }>(e: readonly T[], data: string): T | null
```

- [ ] **Step 1: test:** descrizione vuota, una sola data, fine prima dell'inizio, codice con
  spazio, CIG di 9, `dataDocumentoPa` senza documento → messaggi D8; `elenchiValidiAl` (fine vuota e
  fine = data inclusi, fine ieri escluso); `elencoProposto` (uno solo → quello; due con un
  predefinito → il predefinito; due senza predefinito → null; predefinito scaduto → null).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): regole pure dell'elenco addebiti (E1-E3)`.

## Task 17: dominio puro — riga di addebito

**File:** Create `apps/backend/src/domain/listino/riga-addebito.ts` + spec. Modify
`apps/backend/src/domain/listino/importi-riga.ts` (+ spec) solo per i minor rinviati della 4.2a
(R32). Usa Task 2-5, 16a e 18 (già integrati: niente stub).

**Interfaces (Produces):**
```ts
export type CampoRiga = 'tipo'|'cerCode'|'addebitoId'|'riferimento'|'descrizione'|'tipoQuantita'|'quantitaFissa'|'unitaMisura'|'prezzo'|'prezzoSpeciale'|'sconto'|'codiceIvaId'|'provvigione'|'tipoProvvigione'|'tipologiaRifiuto'|'statoFisico'|'operazione'|'categoriaId'|'centroRicavoId'|'applicaA'|'condizione'|'condizioniRiferite'|'minimoFatturabile'|'minimoPerCategoria'|'riferimentoGiorno'|'riferimentoMese'|'periodoScadenze'|'periodoExtraDal'|'periodoExtraAl'|'stimaAnnuaKg'|'cerProposta'|'addebitiProposti'|'appunti'|'notaUsoInterno'|'scaglioni'|'scadenze'
export const CAMPI_PER_FAMIGLIA: Readonly<Record<FamigliaAddebito, readonly CampoRiga[]>>   // D9
export const ETICHETTE_CAMPI_RIGA: Readonly<Record<CampoRiga, string>>
export interface DatiRiga { /* un campo per CampoRiga, scaglioni: Scaglione[], scadenze: Scadenza[] */ }
export interface ErroreRiga { campo: CampoRiga | null; messaggio: string }   // R36: null = regola fra più campi
export function normalizzaRiga(g, inviati: ReadonlySet<string>): { dati: DatiRiga; errori: ErroreRiga[] }   // fuori famiglia: null se non inviato o inviato vuoto (null, '', []), errore se inviato con un valore (R37)
export function validaRiga(d: DatiRiga, contesto: { contrattoAllegato: boolean }): ErroreRiga[]      // D10, D12, D14, D17
export function tipologiaDaCer(cer: string): 'URBANO'|'URBANO_PERICOLOSO'|'SPECIALE'|'SPECIALE_PERICOLOSO'   // forma del catalogo (R35)
export function formaCerValida(cer: string): boolean          // forma del catalogo "NN NN NN" via cerCanonico, non xx xx 00, asterisco ammesso (R35)
export function validaCerProposta(v: readonly string[]): string[]
export function chiaveRiga(d: Pick<DatiRiga,'tipo'|'cerCode'|'addebitoId'|'riferimento'>): string   // D11
export function totaleFissiAnnuo(righe: readonly { tipo: string; quantitaFissa: string | null; prezzo: string | null; scadenze: { anno: number | null }[] }[]): string   // TOTFISSI
```

- [ ] **Step 1: test** (uno per regola di D10, D12-via-Task 4, D14-via-Task 18 solo i rimandi, D17):
  per ogni famiglia un caso valido completo; ogni messaggio di D10 con un caso; campo fuori famiglia
  inviato con un valore → messaggio "non vale per gli addebiti di tipo …", non inviato o inviato
  `null`/`''`/`[]` → null (R37); ogni errore col suo `campo` (R36); `GR` con peso
  lordo rifiutato, con netto ammesso; `%` su `V` rifiutato, su `$D` ammesso; prezzo `"1.1234567"`
  rifiutato; allegato con `CER` e con `V` rifiutati, con `TT` ammesso;
  `tipologiaDaCer(cerCanonico("200301"))` (`"20 03 01"`) urbano, `"20 01 21*"` urbano pericoloso,
  `"17 04 05"` speciale (R35); `totaleFissiAnnuo` conta solo le
  scadenze ogni anno (come `riempitavola`, `ELENCHIaddeb.cs:2290-2306`); nessun messaggio contiene
  il valore ricevuto; minor rinviati di `importi-riga.ts` (R32).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): regole pure della riga di addebito per famiglia (D9-D12, D17)`.

## Task 18: dominio puro — scadenze degli addebiti fissi

**File:** Create `apps/backend/src/domain/listino/scadenze-fisse.ts` + spec.

**Interfaces (Produces):**
```ts
export interface Scadenza { ordine: number; giorno: number; mese: number; anno: number | null }
export type PeriodoScadenze = 'MP'|'BA'|'BP'|'TA'|'TP'|'QA'|'QP'|'SA'|'SP'|'AA'|'AP'|'DA'|'DP'|'XA'|'XD'|'YC'
export function validaScadenze(s: readonly Scadenza[], periodo: PeriodoScadenze | null, extra: { dal: string | null; al: string | null }): string[]
export function calendarioAutomatico(prima: Omit<Scadenza,'ordine'>, frequenza: 'MENSILE'|'BIMESTRALE'|'TRIMESTRALE'|'QUADRIMESTRALE'|'SEMESTRALE'): { scadenze: Scadenza[] } | { errore: string }
export function periodoCompetenza(s: Scadenza, periodo: PeriodoScadenze, anno: number): { dal: string; al: string } | null
export function scadenzeNelPeriodo(s: readonly Scadenza[], dal: string, al: string, contratto: { dataInizio: string; dataFine: string | null }): { scadenza: Scadenza; data: string }[]
```

- [ ] **Step 1: test:** 29/02 con anno vuoto valido, con 2025 no, con 2024 sì; 31/04 no; doppione
  rifiutato; `XA` senza periodo extra → messaggio; trimestrale da 15/02/?? → 15/02, 15/05, 15/08,
  15/11; trimestrale da 15/04/?? → errore di E19; mensile da 31/01/2026 → 31/01, 28/02, 31/03 …
  (forma come `forma` di WinWaste: fine mese se il giorno manca); `periodoCompetenza` `TA` su
  01/04 → 01/04-30/06, `TP` su 30/06 → 01/04-30/06; `scadenzeNelPeriodo` esclude quelle fuori dal
  contratto e fuori dall'intervallo, l'anno vuoto vale per ogni anno dell'intervallo.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): scadenze degli addebiti fissi e calendario automatico (E19)`.

## Task 19: schema B — elenchi e righe; migration, RLS (59 → 64)

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (enum `TipoQuantitaAddebito`,
  `TipologiaRifiutoAddebito`, `ApplicaPrezzoSpeciale`; cinque modelli in coda; inverse su `Tenant`,
  `ContrattoCliente`, `Addebito`, `CodiceIva`, `CodificaAddebito`)
- Create: `apps/backend/prisma/migrations/20261102300100_listino_elenchi_righe/migration.sql`
- Modify: `prisma-rls.extension.ts` (5 voci), `rls-catalogo.postgres.spec.ts` (59 → 64),
  `README-tenant-transazione.md`, `ops/README.md`
- Create: `apps/backend/src/application/listino/listino-elenchi.schema.postgres.spec.ts`

- [ ] **Step 1: test che falliscono:** `riga CER senza cer_code respinta`; `riga V con cer_code
  respinta`; `tipo "TX" respinto`; `prezzo speciale con minimo respinto`; `due righe uguali
  (stesso CER, riferimento null): respinta la seconda` (verifica di `NULLS NOT DISTINCT`, D24);
  `fascia 8 respinta`; `scadenza mese 13 respinta`; `due elenchi con lo stesso codice nello stesso
  contratto: P2002, in contratti diversi ammessi`; `FK composita: riga con l'addebito di un altro
  tenant respinta`; `cancellare l'elenco cancella righe, fasce, scadenze, allegati`; RLS sulle
  cinque; cascata del tenant.
- [ ] **Step 2-7:** come il Task 7 (ripristino a mano: `DROP TABLE scadenze_riga_addebito,
  scaglioni_riga_addebito, righe_addebito, allegati_elenco_addebiti, elenchi_addebiti; DROP TYPE
  applica_prezzo_speciale, tipologia_rifiuto_addebito, tipo_quantita_addebito; DELETE FROM
  _prisma_migrations WHERE migration_name = '20261102300100_listino_elenchi_righe';`). Unico
  `NULLS NOT DISTINCT` come `GiacenzaIniziale` (R19 della 4.2a): `@@unique` nello schema, clausola
  solo nel SQL, `migrate diff` vuoto. Indici delle FK delle righe e test reale dei nomi: R38.
- [ ] **Step 8: commit** `feat(listino): elenchi, righe, fasce, scadenze e allegati dell'elenco con RLS`.

## Task 20: elenchi degli addebiti (servizio e API)

**File:**
- Create: `apps/backend/src/application/listino/elenchi-addebiti.service.ts` + spec + postgres spec
- Create: `apps/backend/src/api/listino/elenchi-contratto.controller.ts` (`@Controller('contratti-clienti')`)
  ed `apps/backend/src/api/listino/elenchi-addebiti.controller.ts` (`@Controller('elenchi-addebiti')`)
  + spec, `dto/elenco-addebiti.dto.ts` (R39)
- Modify: `listino.module.ts`, `src/test-support/listino-di-test.ts` (`creaContrattoConElenco(owner,
  tenantId, opzioni?)` → `{ clienteId, contrattoId, elencoId }`, contratto inserito col proprietario
  in `ATTIVO`; P.IVA dal default `partitaIvaUnica` di `creaDittaConRuolo`, R55)

**Interfaces (Produces):**
```ts
export interface ElencoAddebitiVista extends DatiElenco {
  id: string; contrattoId: string; righe: number; versione: number
  modificabile: boolean     // D16
  eliminabile: boolean
  allegati: { id: string; posizione: 1 | 2; nomeFile: string; dimensioneByte: number }[]
}
export interface ContestoListino { contratto: { id: string; numero: string; stato: string; clienteId: string; contrattoPrincipale: { id: string; numero: string } | null; dataInizio: string; dataFine: string | null } }
// GET /contratti-clienti/:id/elenchi → { contesto: ContestoListino; elenchi: ElencoAddebitiVista[] }
```

- [ ] **Step 1: test:** crea (codice proposto `001`), lista con `validiAl`, `prossimo-codice`;
  predefinito che toglie il flag all'altro nella stessa transazione, sotto il lock consultivo per
  contratto di R40 (Postgres: `due predefiniti concorrenti: entrambe 200, alla fine uno solo`);
  contratto annullato → 409 `LISTINO_NON_MODIFICABILE`; contratto eliminato o di un altro tenant →
  404 sia da `/contratti-clienti/:id/elenchi` sia da `/elenchi-addebiti/:id` (R39); modifica con
  versione, 409; codice duplicato → 409;
  elimina fisica con righe a cascata; audit; la `versione` del contratto non cambia.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): elenchi degli addebiti del contratto (servizio e API)`.

## Task 21: righe di addebito (servizio e API)

**File:**
- Create: `apps/backend/src/application/listino/righe-addebito.service.ts` + spec + postgres spec
- Create: `apps/backend/src/api/listino/righe-addebito.controller.ts` + spec, `dto/riga-addebito.dto.ts`
- Modify: `listino.module.ts`, `elenchi-addebiti.controller.ts` (`GET|POST :id/righe`),
  `elenchi-contratto.controller.ts` (`GET :id/righe-proposta`), `riferimenti-listino.ts`
  (`controllaRiferimentiRiga`, R41), fixture (`creaRiga(owner, tenantId, elencoId, dati)`)
- `righe-addebito.controller.ts` ha anche `GET codifiche-rentri?tabella=` prima di `:id` (R42)

**Interfaces (Produces):**
```ts
export interface RigaAddebitoVista {
  id: string; elencoId: string; tipo: string; etichettaTipo: string; famiglia: FamigliaAddebito
  cerCode: string | null; addebito: { id: string; codice: string; descrizione: string } | null
  riferimento: string | null; descrizione: string | null; tipoQuantita: string | null; quantitaFissa: string | null
  unitaMisura: string; prezzo: string | null; prezzoSpeciale: boolean; sconto: string | null
  codiceIva: { id: string; codice: string; descrizione: string }; provvigione: string | null; tipoProvvigione: 'SCONTATO'|'LORDO' | null
  tipologiaRifiuto: string | null; statoFisico: string | null; operazione: string | null
  categoria: RiferimentoCodifica | null; centroRicavo: RiferimentoCodifica | null
  applicaA: string | null; scaglioni: Scaglione[]; condizione: number | null; condizioniRiferite: string | null
  minimoFatturabile: string | null; minimoPerCategoria: boolean; riferimentoGiorno: number | null; riferimentoMese: number | null
  periodoScadenze: string | null; periodoExtraDal: string | null; periodoExtraAl: string | null
  scadenze: (Scadenza & { fatturabileNelContratto: boolean })[]
  stimaAnnuaKg: string | null; cerProposta: string[]; addebitiProposti: string[]; appunti: string | null; notaUsoInterno: string | null
  versione: number
}
// GET /contratti-clienti/:id/righe-proposta?addebitoId=|cerCode= → valori proposti (D6, D7): descrizione, um, codiceIva, tipo, categoria, centro, prezzo, sconto, provvigione, tipoProvvigione, tipologiaRifiuto
```

- [ ] **Step 1: test:** per ogni famiglia una creazione completa e la sua lettura; proposta
  dall'archivio col listino del cliente e la provvigione del cliente (D7); CER fuori catalogo o di
  capitolo → 400; addebito disattivato, codice IVA di un altro tenant → 400; ogni 409 di D11
  (duplicato, minimo per contratto, acconto per contratto, detrazione `#` per cliente, condizione già
  definita) e il 400 delle condizioni senza condizionati; D17 in creazione (allegato con CER e con
  `V` → 400); fasce e scadenze sostituite in blocco in modifica (Postgres: `due modifiche con la
  stessa versione: una 409, le fasce sono quelle della prima`); elimina; contratto annullato →
  409; riferimenti letti `FOR SHARE`; audit senza appunti né note; 400 con `errori` per campo
  (R36); PATCH con fasce non inviate → invariate (R37); concorrenza "per contratto" e "per
  cliente" sotto i lock consultivi (R40: due `MW` in due elenchi, due `$D #` in due contratti).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): righe di addebito con fasce e scadenze (servizio e API)`.

## Task 22: uso reale delle tabelle e vincolo del contratto allegato

**File:**
- Modify: `apps/backend/src/application/listino/uso-listino.ts` (+ spec): sorgente `rigaAddebito`
  in `ColonneReferentiListino` (`righe`), con `COLONNE_CODICE_IVA.righe = ['codiceIvaId']`,
  `COLONNE_CODIFICA_ADDEBITO.righe = ['categoriaId', 'centroRicavoId']`, `COLONNE_ADDEBITO.righe =
  ['addebitoId']` (R44)
- Modify: `apps/backend/src/application/listino/{codici-iva,codifiche-addebito,addebiti}.service.ts`
  (+ spec, + postgres spec): testi `inUso` di codici IVA e codifiche ("… da addebiti dell'archivio
  o da righe dei listini …", R44); commenti `FOR UPDATE` superati di `addebiti.service.ts:288-291`
  e `codifiche-addebito.service.ts:199-202`; minor rinviati dei Task 8 e 9 (R44)
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts` (+ spec, +
  postgres spec) — **mirata**, D17: solo in `controllaCambiamenti` (il passo 6 di `scrivi` serve
  solo `crea`, e un contratto nuovo non ha righe), dopo `bloccaELeggi`, `SELECT count(*) FROM
  righe_addebito r JOIN elenchi_addebiti e ON e.id = r.elenco_id AND e.tenant_id = r.tenant_id
  WHERE e.tenant_id = $1 AND e.contratto_id = $2 AND r.tipo !~ '^T'` > 0 → 400 col messaggio di D17

- [ ] **Step 1: test:** Postgres con una riga **reale**: `codice IVA in uso da una riga: DELETE →
  409 CODICE_IVA_IN_USO col testo intero, eliminabile false`; lo stesso per categoria e centro
  (`CODIFICA_ADDEBITO_IN_USO`) e per l'addebito (`ADDEBITO_IN_USO`); `allegare un contratto con una riga V: 400`; `con
  sole righe TT: ammesso`; Postgres `allegamento e riga CER concorrenti: mai un allegato con righe
  CER` (due transazioni con `pg_sleep` nel test, come 4.1 R24); spec esistenti dei contratti verdi.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): uso reale delle tabelle dalle righe; contratto allegato solo con addebiti T (4.1 D28)`.

## Task 23: copia di elenchi e righe; provvigioni e sconti su tutto il contratto

**File:**
- Create: `apps/backend/src/application/listino/azioni-listino.service.ts` + spec + postgres spec
- Modify: `elenchi-addebiti.controller.ts` (`sostituisci-da`, `aggiungi-righe`),
  `elenchi-contratto.controller.ts` (`POST :id/provvigioni`, `POST :id/sconti`; nessun controller
  nuovo, R39) + spec, dto, `listino.module.ts`

**Interfaces (Produces):**
```ts
export interface EsitoCopia { copiate: number; escluse: { minimi: number; acconti: number; conguagli: number; duplicate: number; condizioni: number } }   // R45
export interface EsitoImpostazione { aggiornate: number; speciali: number; escluse: number }
```

- [ ] **Step 1: test:** sostituzione da un elenco di un altro cliente con fasce e scadenze, esclusi
  `MW`, `$A`, conguaglio (conteggi), su sé stesso → 400, verso un allegato con righe non T → 400
  (D17), elenco sorgente di un altro tenant → 404; aggiungi righe con un duplicato saltato;
  `FOR UPDATE` in ordine di id (Postgres: `due copie incrociate A←B e B←A: nessun deadlock`);
  provvigione su tutte le righe non speciali (`$D` escluse e contate); sostituzione dello sconto
  `"10 + 5"` → solo le righe con `10+5`; contratto annullato → 409; audit con i conteggi.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): copia di elenchi e righe; provvigioni e sconti su tutto il contratto (E20, E25)`.

## Task 24: modifica automatica dei prezzi dei contratti e adeguamento ISTAT

**File:**
- Create: `apps/backend/src/application/listino/variazioni-prezzi.service.ts` + spec + postgres spec
- Create: `apps/backend/src/api/listino/variazioni-prezzi.controller.ts` + spec; Modify
  `dto/variazione-prezzi.dto.ts` (filtri dei contratti, ISTAT), `listino.module.ts`
- Create: `apps/backend/src/application/listino/conflitti-variazione.ts` (+ spec) con
  `traduciConflitto` esportato; Modify `variazioni-archivio.service.ts` (+ spec) perché lo importi
  invece della copia privata di `:145` (R46)

**Interfaces (Produces):**
```ts
export interface FiltroVariazioneContratti {
  addebitoId?: string; cerCode?: string; clienteId?: string; riferimento?: string; prezzoAttuale?: string; anchePrezziZero?: boolean
  tipiPrezzo?: ('NORMALE'|'SPECIALE')[]; tipi?: string[]; categorieAddebitoIds?: string[]; centriRicavoIds?: string[]
  tipiContrattoIds?: string[]; categorieContrattoIds?: string[]; inizioDal?: string; inizioAl?: string; fineDal?: string; fineAl?: string
  contrattiIds?: string[]; addebitiIds?: string[]; primaScadenzaFissi?: string
}
// R46: NON l'AnteprimaVariazione del Task 10 ({ id, descrizione, listino, prima, dopo }), ma una propria:
export interface AnteprimaVariazioneContratti {
  totale: number
  righe: { id: string; cliente: string | null; contratto: string; elenco: string; voce: string; prima: string; dopo: string }[]   // primi 200; voce = CER o codice addebito
  errori: { id: string; voce: string; messaggio: string }[]
  impronta: string   // improntaVariazione su { id: rigaId, versione }
}
export interface MeseIstat { anno: number; mese: number; contratti: number }
```

- [ ] **Step 1: test:** ogni filtro con un caso (Postgres, dati della fixture su tre clienti);
  annullati ed eliminati mai toccati; `soloMinimi` aggiorna `minimo_fatturabile`; speciali: fasce
  aggiornate, zero invariati; sostituzione IVA; negativo → 400; impronta superata → 409 e nulla
  scritto; oltre 10.000 → 400; `riga modificata durante la variazione: 409 al salvataggio del
  collega` con sovrapposizione dimostrata (R46); 55P03 vero; la variazione dell'archivio non cambia
  le righe (R46); ISTAT: mesi solo dei contratti con `incrementoIstat`, anno corrente escluso, precedente
  escluso senza parametro; percentuali non decrescenti → 400; `contratto senza incremento ISTAT:
  invariato`; ruoli: OPERATOR → 403; un audit per applicazione.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): modifica automatica dei prezzi dei contratti e adeguamento ISTAT (E21, E24)`.

## Task 25: allegati PDF dell'elenco

**File:** Create `apps/backend/src/application/listino/allegati-elenco.service.ts` + spec + postgres
spec; Create `apps/backend/src/api/listino/allegati-elenco.controller.ts` + spec (riusa
`allegato-contratto-upload.ts` della 4.1b importandolo, senza modificarlo); Modify `listino.module.ts`.

- [ ] **Step 1: test:** come i Task 19 della 4.1 (PDF valido, non PDF rinominato → 415, 5 MB → 413,
  posizione occupata → 409, rimozione, contenuto con `Content-Disposition: attachment`, elenco di un
  altro tenant → 404, contratto annullato: caricamento e rimozione ammessi come 4.1 D29, eccezione
  dichiarata a D16); messaggio "L'allegato dell'elenco deve essere un PDF." (R47).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): allegati PDF dell'elenco addebiti (E4)`.

## Task 26: frontend — servizi 4.2b e pagina del listino del contratto

**File:**
- Modify: `fe/features/listino/{listino.model,listino.service,vocabolario-listino}.ts` (+ spec:
  elenchi, righe, azioni, variazioni, ISTAT, allegati, copiati dalle `…Vista` dei Task 20-25 **del
  piano, con le correzioni dell'addendum** R36, R45, R46; vocabolario con `CAMPI_PER_FAMIGLIA` e
  le liste di R48)
- Create: `fe/features/listino/{listino-contratto,elenchi-pannello,elenco-dialog,righe-tavola}.component.ts` + spec
- Modify: `fe/app.routes.ts` (`contratti-clienti/:id/listino`),
  `fe/features/contratti-cliente/{contratti-cliente-list,contratto-cliente-dialog}.component.ts`
  (+ spec: azione e pulsante "Listino")

- [ ] **Step 1: test:** intestazione (numero, cliente, stato, "allegato a …"); elenchi con
  "Solo validi oggi" e predefinito evidenziato; nuovo/modifica/elimina elenco con conferma; tavola
  delle righe con le colonne di D28 e il totale dei fissi; doppio clic apre il dialog della riga
  (stub fino al Task 27); contratto annullato o VIEWER: sola lettura; 409 mostrato con "ricarica";
  azione "Listino" visibile al VIEWER, fuori dalla colonna `*ngIf="puoScrivere()"` (R48).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): pagina del listino del contratto con elenchi e tavola delle righe`.

## Task 27: frontend — dialog della riga (1): dati, quantità, prezzo, proposta

**File:** Create `fe/features/listino/{riga-addebito-dialog,riga-dati-sezione,riga-proposta-sezione}.component.ts` + spec;
Modify `fe/features/listino/addebito-dialog.component.ts` (+ spec: `@Input() rapida`, R49) e i
dialog in linea di codici IVA e codifiche per i minor T12 (R49).

- [ ] **Step 1: test:** scelta "CER o addebito" (autocomplete del catalogo CER e dell'archivio, "Nuovo
  addebito" in linea); tipo dal menu delle famiglie; campi abilitati da `CAMPI_PER_FAMIGLIA`
  (cambiando tipo i campi fuori famiglia si svuotano e spariscono); valori proposti chiamati alla
  scelta e applicati solo ai campi vuoti; tipo quantità con le etichette di E15; codice IVA,
  categoria e centro con "Nuovo …" in linea; sezione Proposta (CER di proposta per `V`, addebiti
  proposti per `CER`); sezione Note; errori 400 sul campo dal campo `errori[].campo` (R36), mai
  per parole chiave; stato fisico e operazione dall'elenco di R42; Esc del sub-dialog e focus come 4.1.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): dialog della riga di addebito, dati e proposta`.

## Task 28: frontend — dialog della riga (2): prezzo speciale e scadenze

**File:** Create `fe/features/listino/{scaglioni-prezzo,scadenze-fisse}.component.ts` + spec; Modify
`riga-addebito-dialog.component.ts` (+ spec).

- [ ] **Step 1: test:** tabella delle 7 fasce (fino a, prezzo, sconto, provvigione, tipo di calcolo
  con la descrizione dinamica di `vedilist1`, `ADDEBCON.cs:8569-8688`: "A = Prezzo × … fino a …",
  ma per `E`/`H` e per la quantità precedente con la semantica del Task 16a, R50);
  "applica a" con le cinque voci di E13; condizioni riferite; data di riferimento; scadenze dei
  fissi: 12 righe giorno/mese/anno (vuoto = ogni anno), "Calendario automatico" calcolato nel
  frontend con una copia di `calendarioAutomatico` del Task 18 (il backend rivalida, come la
  precompilazione della 4.1b; test che confronta la copia con gli stessi casi del Task 18) e il
  periodo di competenza mostrato accanto; periodo extra per `XA`/`XD`/`YC`.
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): dialog della riga, prezzo speciale a scaglioni e scadenze dei fissi`.

## Task 29: frontend — azioni del listino e variazioni di massa

**File:** Create `fe/features/listino/{copia-elenco-dialog,aggiungi-righe-dialog,provvigioni-sconti-dialog,variazione-prezzi-dialog,istat-dialog,allegati-elenco}.component.ts` + spec; Modify
`listino-contratto.component.ts` (+ spec), `fe/features/contratti-cliente/contratti-cliente-list.component.ts`
(menu "Variazioni prezzi", solo ADMIN).

- [ ] **Step 1: test:** copia da un altro elenco (scelta cliente → contratto → elenco, conferma
  "sostituisce le righe", esito coi conteggi); aggiungi righe scelte; provvigioni e sconti con
  l'avviso delle speciali; variazione: filtri di D20 (compreso "contratti scelti", R51), anteprima
  paginata, errori, "Scarica CSV",
  conferma con impronta, 409 → "rifai l'anteprima"; ISTAT: griglia dei mesi con percentuale, tipi,
  anteprima, conferma; allegati dell'elenco (stesso componente della 4.1b come modello; pulsanti
  anche con il contratto annullato, R47); OPERATOR senza il menu variazioni; minor T13 (R51).
- [ ] **Step 2-4** e **Step 5: commit** `feat(listino): copia elenchi, provvigioni e sconti, modifica automatica prezzi e ISTAT`.

## Task 30: e2e 4.2b e chiusura

**File:** Create `e2e/tests/listino/listino-contratto.spec.ts`.

- [ ] **Step 1: spec e2e** (solo in CI): da un contratto attivo apre "Listino", crea l'elenco 001
  predefinito, una riga CER a peso netto con prezzo speciale tipo A a tre fasce, una riga `V`
  dall'archivio (prezzo proposto dal listino del cliente), una riga `F` trimestrale col calendario
  automatico, una `MW`; prova una seconda `MW` (messaggio); copia l'elenco su un secondo contratto e
  legge l'esito; imposta la provvigione 5 % su tutto il contratto; variazione +3 % sui CER con
  anteprima e conferma; ISTAT su un contratto col flag; allega il contratto a un altro (messaggio
  "tipo diverso da T"); annulla il contratto e verifica la sola lettura; VIEWER senza pulsanti.
  Ripetibile e non invasivo come R52: helper di `e2e/utils/attese.ts`, nomi casuali per
  tentativo, variazione filtrata sul contratto del test, ISTAT su un mese casuale di un anno vecchio.
- [ ] **Step 2:** `git diff --stat 869e98f..HEAD`: solo i file dei Task 16a-30 e le
  mirate di D17/D28 (più i file della 4.2a che l'addendum dichiara).
- [ ] **Step 3-5:** come il Task 15 (`rls-catalogo` 64); `ci.yml` via `workflow_dispatch`; merge
  solo con `test-postgres` ed `e2e` verdi.
- [ ] **Step 6: commit** `test(e2e): listino del contratto dall'elenco all'adeguamento ISTAT`.
- [ ] **Step 7: rapporto**: commit, test rossi preesistenti, la mappa M1-M3 con eventuali
  scostamenti, rollback della **sola** seconda migration, prova manuale consigliata (gli scenari
  dell'e2e più: due schede sulla stessa riga → 409, variazione con anteprima superata, copia di un
  elenco con conguaglio).

---

## Ordine

4.2a: Task 0 → 1-6 (puri) → 7 (schema) → 8 → 9 → 10, 11 (backend) e 12 → 13, 14 (frontend) → 15.
1-3 indipendenti; 4 e 6 usano il 3; 5 usa 1-3. 7 prima di ogni servizio. 8 prima di 9 (fixture e
modulo). 9 prima di 10. 11 dopo 7 (colonne di `clienti`). 12 prima di 13 e 14. 4.2b (corretto
dall'addendum, R53): 16a, 16, 18 (puri) e 19 (schema, non dipende dai domini) → 17 (dopo 16a e 18)
e 20 (dopo 16 e 19) → 21 (dopo 17, 18, 20) → 22 (dopo 21) e 25 (dopo 20) → 23 (dopo 21 e 22) e 24
(dopo 21); frontend 26 → 27 → 28 (dopo 16a) e 26 → 29; 30 alla fine.

## Parallelismo

**Chi usa Postgres** (suite `*.postgres.spec.ts` o `rls-catalogo` a fine task): 7, 8, 9, 10, 11, 19,
20, 21, 22, 23, 24, 25 (e 15, 30 per la suite intera). **Non lo usano:** 1-6, 16-18 (dominio puro)
e i frontend 12-14, 26-29. Con un solo database (55438) e la regola della RAM la catena backend resta
sequenziale; il guadagno sta nel far correre i puri insieme e la catena frontend accanto, sempre
con **al massimo un task Postgres per ondata** e ogni processo pesante sotto `flock`.

**File condivisi e chi li tocca:** `schema.prisma`, `prisma-rls.extension.ts`, `rls-catalogo…`,
`README-tenant-transazione.md`, `ops/README.md` → solo 7 e 19; `app.module.ts` → solo 8;
`listino.module.ts` → 8, 9, 10, 20, 21, 23, 24, 25 (tutti backend, ondate diverse);
`listino-di-test.ts` → 8, 9, 20, 21; `addebiti.controller.ts` → 9, 10; `dto/variazione-prezzi.dto.ts`
→ 10, 24; `elenchi-addebiti.controller.ts` → 20, 21, 23; i tre servizi d'archivio → 8, 9 e 22;
`contratti-cliente.service.ts` → solo 22; file dei clienti → solo 11 (BE) e 14 (FE);
`listino.model.ts`, `listino.service.ts`, `vocabolario-listino.ts` → 12 e 26 (i task frontend
successivi li leggono); `app.routes.ts` → 13, 26; `tabelle-fatturazione.component.ts` → 12;
`contratti-cliente-list.component.ts` → 26, 29; `riga-addebito-dialog.component.ts` → 27, 28;
`listino-contratto.component.ts` → 26, 29. Backend e frontend non condividono file.

**4.2a**

| Ondata | Task in parallelo | Perché insieme | Rischio |
|---|---|---|---|
| 1 | **1** ∥ **2** ∥ **3** | domini senza file in comune, nessun database | basso |
| 2 | **4** ∥ **5** ∥ **6** | usano 1-3 già integrati; file propri | basso |
| 3 | **7** (PG, migration) ∥ **12** | 12 scrive i modelli dalle interfacce del piano (R29 della 4.1b) | medio: scostamenti di vista da riportare |
| 4 | **8** (PG) ∥ **13** | 8 dopo 7; 13 dopo 12 | medio: 13 usa rotte dei Task 9-10 non ancora scritte |
| 5 | **9** (PG) ∥ **14** | 9 dopo 8; 14 dopo 12, file dei clienti FE soli | basso |
| 6 | **10** (PG) | dopo 9 (stesso controller) | — |
| 7 | **11** (PG) | dopo 7; messo qui per l'unico database | — |
| 8 | **15** | tutto integrato | — |

**4.2b**: la tabella originale (16 ∥ 17 ∥ 18 → … → 30 in nove ondate) è **sostituita** dalla
sezione "Parallelismo 4.2b" dell'addendum in fondo (R53).

**Regole operative** (come R30 della 4.1b): un worktree per task (`git worktree add
../rifiuti-wt-42-<task> -b wt/42-<task> <HEAD dopo l'ondata precedente>`) coi tre `node_modules`
copiati per reflink (`cp -a --reflink=auto`), mai condivisi; il worktree frontend non lancia
`prisma generate`; ogni processo pesante sotto il `flock` del pezzo; la migration si applica **una
volta** sul 55438 nell'ondata che la crea, mai `migrate reset`; i test isolano per `tenantId`;
integrazione a fine ondata nel worktree principale con `git cherry-pick` backend → frontend, poi
revisione opus dell'ondata. Variante con un secondo database (`wasteflow_ci_b`): sconsigliata come
nella 4.1b.

## Fuori ambito (seguiti)

- **4.3 Legame movimento → cliente, contratto, elenco, riga e prezzo congelato**
  (`MOVIMENTI.CLIE/CONT/GRUPPADD/FOGLIO`): uso di `elencoProposto`, ricerca della riga per CER e
  riferimento (`?` qualsiasi), proposta delle righe `V` con `cerProposta`/`addebitiProposti`,
  "Aggiorna prezzi movimenti" (F6, `Modificaprezzi`, E28), FK dei movimenti verso le righe che
  bloccherà l'eliminazione di elenchi e righe usati.
- **4.4 Valorizzazione e fattura**: "applica a" B-E con somme di periodo, progressivi e conguagli,
  condizionati fra righe, `T…`, `N…`, `M…` (minimo di documento e per categoria), `$A`/`$D`/`$R`
  con i loro marcatori e il residuo, marcatori `GIAF`/`FACC`/`FDET`/`CFATT` in tabella propria
  (D15), `specialegamma`, provvigioni maturate, contropartite (colonna additiva su `addebiti` e
  `righe_addebito`) e piano dei conti, IVA per aliquota e natura nel tracciato, scadenze dei fissi
  e periodi del contratto insieme, uso del riferimento PA dell'elenco in fattura, fatture per
  elenco (`opz6`); **4.5** emissione SDI.
- **3.8 Import** di `ADDEBITI`, `ELENCHIADDEB`, `ADDEBCON`, `[ESENZIONI]`, `Categorie`, `CLIFOR.LIS`
  e `C4` provvigioni: codici d'origine, descrizioni condivise `DEP` risolte in testo, stati fisici
  1-6 e recuperi verso i codici RENTRI, `SCA` `ggmmaa` con `??`, marcatori già scritti (per non
  rifatturare il pregresso), elenco dei casi non mappati (regole d'installazione, `K/M`/`K/L`).
- Listini di contratti **temporanei** e **fornitori**; funzioni NICA, CNA, ECOER, autodemolitori;
  regole d'installazione 01/03/05/11/12; "A tutti" (D30).
- Statistiche e stampe del listino (`STAMPCONTR`, `frmstampaaddebiti`, `SituazioneAddebiti`), export
  Excel delle variazioni (qui CSV), magazzino e articoli abbinati.
- Scarico automatico degli indici ISTAT; job di adeguamento automatico.

## Domande per Graziano

In ordine d'importanza (da porre con AskUserQuestion, al massimo 4 per volta). Il piano è scritto con
la prima opzione di ciascuna.

1. **Q1 — Fin dove arriva il "motore" in 4.2?** (cambia Task 3, 4, 6, 18 e la taglia)
   - **Regole della singola riga ora, somme in 4.4 (consigliata)**: importo, sconto e provvigione a
     cascata, prezzo speciale a scaglioni con tutte le varianti, scadenze dei fissi, variazioni e
     ISTAT; "applica a" B-E, condizionati fra righe, T/N/M/$ in 4.4 con i movimenti veri (D1).
   - **Motore completo in 4.2**: anche somme di periodo, progressivi, conguagli, condizionati,
     minimi di documento e acconti, provati su movimenti finti (+6-8 task, regole scritte senza dati
     reali).
   - **Solo dati e validazioni, nessun calcolo**: tutto il motore in 4.4 (−4 task; 4.4 diventa più
     grande).
2. **Q2 — Quali famiglie di addebito si possono creare dalla prima uscita?** (cambia Task 2, 17, 21,
   27-28)
   - **Tutte quelle di WinWaste per i clienti (consigliata)**: CER, V, F con scadenze, T…, N…, M…,
     $A/$D/$R, prezzo speciale con tutti i tipi: "uguale a WinWaste", e 3.8 importa ogni riga.
   - **Il caso comune**, come diceva la roadmap: CER, V, F, MW e scaglioni semplici (A e D); le altre
     dopo un'estrazione di `ADDEBCON` reale (meno lavoro ora, ma l'import 3.8 lascerà righe fuori).
3. **Q3 — Archivio addebiti: quanti listini e il listino del cliente?** (cambia Task 5, 7, 11, 14)
   - **Sei listini come WinWaste, con listino e provvigione predefinita sul cliente (consigliata)**:
     tre colonne additive su `clienti` (unico `ALTER` del pezzo, nullable, senza riscrittura).
   - **Sei listini senza listino sul cliente**: la riga propone sempre il listino 1 (nessun `ALTER`;
     chi usa listini diversi per cliente sceglie a mano).
   - **Un solo prezzo d'archivio**: niente tabella dei listini (−1 tabella; i listini 2-6 di WinWaste
     si perdono all'import).
4. **Q4 — Consegna** (cambia la sezione "Consegna" e il Task 15)
   - **Due PR, 4.2a archivio e motore puro, 4.2b elenchi e righe (consigliata)**: come la 4.1, una
     migration per PR.
   - **Una PR sola**: meno passaggi, revisione e rollback più pesanti.
   - **Tre PR** (archivio; elenchi e righe; azioni di massa e ISTAT): revisioni più piccole, una
     migration in più da tenere in ordine.
5. **Q5 — Adeguamento ISTAT: quali contratti?** (cambia D22 e Task 24)
   - **Solo i contratti con "Incremento ISTAT" spuntato (consigliata)**: il flag portato in 4.1
     serve a questo.
   - **Come WinWaste**: tutti i contratti iniziati nel mese scelto, il flag resta informativo.
6. **Q6 — Codici IVA** (cambia D3, Task 1, 7, 8, 12)
   - **Tabella dei codici IVA dell'azienda ora, con aliquota e natura (consigliata)**: la riga ha l'IVA
     obbligatoria come in WinWaste e 4.4 la trova pronta.
   - **Solo l'aliquota numerica sulla riga** (niente tabella; esenzioni e reverse charge rimandati a
     4.4 con una migration di trasformazione).

## Risposte di Graziano (01/11/2026)

Tutte le opzioni consigliate: Q1 regole della singola riga ora, somme in 4.4; Q2 tutte le famiglie di addebito di WinWaste per i clienti; Q3 sei listini, con listino e provvigione predefinita sul cliente (unico `ALTER` del pezzo); Q4 due PR, 4.2a (Task 0-15) e 4.2b (Task 16-30); Q5 ISTAT solo sui contratti con "Incr. ISTAT" acceso (scelta fatta dopo aver visto che WinWaste applica a tutti i contratti del mese e ignora il flag); Q6 tabella dei codici IVA per azienda con aliquota e natura.

## Addendum 4.2b (02/11/2026)

Vale per la PR 4.2b (Task 16a, 16-30), branch `feat/fase4-2b-righe-listino` da master `869e98f`
(4.2a fusa con la PR #42 e in produzione, migration `20261102300000_…` applicata). Fonti: il codice
reale della 4.2a, i ruling R1-R28 della 4.2a (`rulings-4.2a.md` e righe "Ruling:" del ledger,
archiviati in `rifiuti/.superpowers/archivio/rifiuti-wt-rentri-registro-4.2a/`), la revisione e la
re-revisione finali della 4.2a, la decisione di Graziano del 02/11. Il preflight con i 29 difetti e
il testo completo dei ruling **R29-R57** sta in
`.superpowers/sdd/2026-11-02-fase4-2-listino/preflight-4.2b.md`; qui c'è la parte vincolante per
task. Dove l'addendum e il testo dei Task 16-30 divergono, vale l'addendum (le righe sbagliate dei
task sono già state corrette nel testo).

### Decisione di Graziano (02/11)

I due casi di `speciale` di WinWaste che fatturano due volte la stessa quantità si **correggono**,
come differenza voluta e dichiarata:
1. la `E` (e la sua variante `H`) azzera le fasce precedenti come la `D`;
2. con la quantità precedente (prezzo "da data", `applicaA = PROGRESSIVO_DA_DATA`) `B`, `C` e `D`
   non ripagano la parte già fatturata.

Oggi `apps/backend/src/domain/listino/prezzo-speciale.ts` li porta fedeli (JSDoc "FATTURAZIONE
DOPPIA EREDITATA (R20)", `:239-252`; azzeramento solo per `BDYW` a `:306`; quantità riscritta per
`B C D` a `:325-332`) e i test li fissano (`prezzo-speciale.spec.ts:118`, `:128`, `:138`, `:255`).

### Task 16a: dominio puro — prezzo speciale senza doppia fatturazione (primo task della 4.2b)

**File:** Modify `apps/backend/src/domain/listino/prezzo-speciale.ts` +
`prezzo-speciale.spec.ts`. Nessun altro file. Firma di `applicaScaglioni`, `validaScaglioni` e
`validaPrezzoSpeciale` invariata (salvo il messaggio nuovo di R31 se Graziano lo conferma).

**Interfaces:** nessuna nuova. Cambia la semantica (R29, R30):

| Caso | WinWaste (oggi in WasteFlow) | WasteFlow dopo il 16a |
|---|---|---|
| `E`/`H` raggiunta | tutta la quantità al prezzo della 7, **più** le righe delle fasce precedenti | tutta la quantità al prezzo della 7, le fasce precedenti azzerate (come `D`/`W`) |
| `D`/`E` con quantità precedente | la quantità **totale** (precedente + nuova) al prezzo della fascia più alta | la sola quantità **nuova** al prezzo della fascia più alta raggiunta dal totale |
| `C` con quantità precedente | il fisso di ogni fascia raggiunta dal totale, anche se già fatturato | il fisso delle sole fasce raggiunte per la prima volta |
| `B` con quantità precedente | il fisso della fascia più alta, anche se già fatturato | il fisso della fascia più alta solo se raggiunta per la prima volta (Q8) |
| `A` (con o senza precedente) | invariato | invariato |

- [ ] **Step 1: test ribaltati e nuovi** (tabella `[1-1000 a 0,10; 1000-5000 a 0,08; oltre a
  0,05]` salvo indicazione):
  - `E azzera le fasce precedenti come D (differenza voluta, 02/11)`: `[A 1-1000 a 0,10; E oltre a
    0,05]` su 6.000 → `[['6000','0.05']]` (era `['1000','0.10'], ['6000','0.05']`);
  - `D + E: una sola riga`: `[D 1-5000 a 0,08; E oltre a 0,05]` su 6.000 → `[['6000','0.05']]`;
  - `H azzera le fasce precedenti`: `[A 1-1000; H oltre]` con condizione `P` su 6.000 → `['6000']`,
    `condizioneVerificata = true`;
  - `D con quantità precedente fattura solo la quantità nuova`: 1.000 nuovi + 2.000 precedenti →
    `[['Per q.tà oltre KG 1000','1000','0.08']]` (era `3000`);
  - `E con quantità precedente`: `[A 1-1000; E oltre]`, 500 nuovi + 5.800 precedenti → `[['Per
    q.tà oltre KG 1000','500','0.05']]`;
  - `C con quantità precedente: solo le fasce raggiunte per la prima volta`: 1.000 + 800 →
    `[['Per q.tà oltre KG 1000: imp.fisso','1','0.08']]`;
  - `B con quantità precedente`: 1.000 + 800 → la sola riga della fascia 2; 100 + 1.200 → `righe:
    []` (fascia 2 già raggiunta);
  - `quantità nuova zero con D`: 0 + 2.000 → `righe: []`;
  - restano verdi senza modifiche: l'esempio §4.5 (A 470,00, D 300,00), B, C, quantità zero,
    `A` con precedente (`spec:184`, `:194`), le varianti X/Y/Z/W, gli errori.
- [ ] **Step 2:** FAIL dei test ribaltati.
- [ ] **Step 3: codice.** `'BDEYWH'.includes(tipo)` per l'azzeramento; con `daData`, per `D`/`E` la
  quantità è `q − precedente`, per `B`/`C` il fisso vale solo se `precedente ≤ soglia inferiore`
  della fascia (fascia 1: `precedente = 0`). Il paragrafo JSDoc R20 diventa **"DIFFERENZA VOLUTA DA
  WINWASTE (decisione del 02/11)"**: cosa fa WinWaste (con le righe di `FATAUTOMATICA.cs`
  17230-17290 già citate), cosa fa WasteFlow, perché (la stessa quantità non si fattura mai due
  volte), e che 3.8 deve segnalarlo nel rapporto d'import (le tabelle `…E` e quelle "da data" con
  `B`/`C`/`D` fatturano meno che in WinWaste). Nessun riferimento a R20 come "fedele".
- [ ] **Step 4:** `npx jest -w 2 src/domain/listino`, `tsc`, eslint del file (sotto `flock`).
- [ ] **Step 5: commit** `fix(listino): prezzo speciale senza doppia fatturazione per E/H e quantità precedente (differenza voluta)`.
- **R31 (Q7, in attesa di Graziano):** con l'opzione consigliata il 16a aggiunge a
  `validaScaglioni` "Dopo una fascia di tipo D o W le fasce successive non possono essere
  progressive (A o X)." con un test (`[D 1-5000; A oltre]` respinta). Senza risposta all'avvio
  dell'ondata 1 il 16a scrive solo R29-R30 e la regola entra con il Task 17.

### Correzioni per task (dal codice reale della 4.2a e dai ruling)

**Task 16** — Branch e linea di base (R34): `migrate status` pulito con ultima
`20261102300000_listino_archivio_addebiti` (la migration è stata corretta in locale dopo la prima
applicazione per R28: se il checksum non torna, ripristino a mano e `migrate deploy`), RLS 59,
`test:cov` (6527 verdi a fine 4.2a), Postgres (431; MUD e `unita-locali-mud` rosse solo in locale
per la guardia di porta). CIG, CUP e documento PA: regole e testi copiati da
`validaContrattoCliente`, con un test che confronta i testi (R33); `"La data del documento della PA
si indica solo con il documento."` per `dataDocumentoPa`.

**Task 17** — Dopo 16a e 18, niente stub (R53). Forma del CER del catalogo via `cerCanonico` (R35).
`ErroreRiga` col campo (R36). "Inviato" = valore non vuoto; regole del PATCH (R37). Minor rinviati
di `importi-riga.ts` secondo R20: `oreDecimali("1,") = "1.00"`, `oreDecimali(",30") = "0.50"`,
quantità negative passate da `quantitaDaMovimento` come `xqta`, caso X/HR nella forma di `cvore`
(R32). `validaPrezzoSpeciale` del 16a resta l'unica fonte delle regole del prezzo speciale.

**Task 18** — Invariato.

**Task 19** — Migration `20261102300100_listino_elenchi_righe` (dopo l'ultima di master,
`20261102300000_…`); RLS **59 → 64** in `rls-catalogo.postgres.spec.ts:64`,
`README-tenant-transazione.md` (le tre occorrenze "(59)") e cinque voci in coda a
`TENANT_SCOPED_MODELS` dopo `PrezzoListinoAddebito` (`prisma-rls.extension.ts:116`), commento
"Listino (Fase 4 pezzo 2b)". `NULLS NOT DISTINCT` come R19. Indici `(tenant_id, addebito_id)`,
`(tenant_id, codice_iva_id)`, `(tenant_id, categoria_id)`, `(tenant_id, centro_ricavo_id)` su
`righe_addebito` e `(tenant_id, contratto_id)` su `elenchi_addebiti`; **niente** indici sulle FK di
`addebiti` (tabella esistente: resta un seguito). Test dei nomi di vincoli e indici contro l'elenco
atteso (anche per quelli della 4.2a) al posto di `length(conname) > 63`. Allegati con le colonne di
`allegati_contratto_cliente`. Ripristino con `DELETE FROM _prisma_migrations`. `ops/README.md`:
paragrafo "**Elenchi e righe di addebito** (Fase 4 pezzo 2b)" e, nel paragrafo della 4.2a, "se è
applicata la `20261102300100_…`, ripristinare prima quella" (R38, R54).

**Task 20** — Controller `elenchi-contratto.controller.ts` ed `elenchi-addebiti.controller.ts`
(R39); `prossimo-codice` prima di `:id`. Contratto letto con `eliminato_il IS NULL` anche dalle
rotte `/elenchi-addebiti/:id`. Lock nell'ordine di R40: contratto `FOR SHARE` → lock consultivo per
contratto (`pg_advisory_xact_lock(hashtext('listino-contratto'), hashtext(contrattoId))`, forma a
due interi) per predefinito e creazione senza codice (con nuovo tentativo su P2002 come
`addebiti.service.ts`) → elenco `FOR UPDATE`. Errori P2028/P2034/40P01/55P03 → 409
`OPERAZIONE_CONCORRENTE` già da `traduciErrorePrisma` (`anagrafica-versionata.ts:107-118`). Fixture:
`creaContrattoConElenco` senza P.IVA esplicita (`partitaIvaUnica`), più i minor T8 della fixture
(`genere: any` → `GenereCodificaAddebito`, commento di pulizia) (R55).

**Task 21** — `controllaRiferimentiRiga` in `riferimenti-listino.ts` (R41): addebito `FOR SHARE`
attivo e non `CER`, codice IVA, categoria e centro con i messaggi già scritti, stati fisici e
operazioni contro `rentri_codifiche_semplici` per `external_id`, `addebitiProposti` di tipo `V`,
`cerProposta` nel catalogo. `GET /righe-addebito/codifiche-rentri?tabella=stati-fisici|attivita-rs`
dal repository esistente (R42). 400 `{ error: 'RIGA_ADDEBITO_NON_VALIDA', message, errori }` (R36).
Lock di R40: lock consultivo per cliente (`hashtext('listino-cliente')`) solo per `$D` con `#`, per
contratto per `M…` e `$…`, poi elenco `FOR UPDATE`, poi riferimenti `FOR SHARE`. `RIGA_ADDEBITO_DUPLICATA`
anche dall'indice unico (R43). `righe-proposta` con `prezzoProposto`/`provvigioneProposta` del Task
5 (R6, R23, R57) in `elenchi-contratto.controller.ts`. CER scritto nella forma di `cerNelCatalogo`.

**Task 22** — `uso-listino.ts` con la sorgente `rigaAddebito` in `COLONNE_ADDEBITO` (e in quelle di
codici IVA e codifiche); test Postgres con una riga **reale**: `DELETE` → 409 `ADDEBITO_IN_USO`
(`CODICE_IVA_IN_USO`, `CODIFICA_ADDEBITO_IN_USO`) col testo intero ed `eliminabile = false`; testi
"addebiti dell'archivio" adeguati ("… da addebiti dell'archivio o da righe dei listini …"); commenti
`FOR UPDATE` da aggiornare in `addebiti.service.ts:291` (blocco `:288-291`) e
`codifiche-addebito.service.ts:201` (blocco `:199-202`): oggi c'è il lock consultivo, il nuovo
tentativo su P2002 copre la creazione a codice esplicito; `contaUsiListino` resta batch (un
`groupBy` per colonna, una chiamata per `list`/`getById`). D17 solo in `controllaCambiamenti`. Minor
rinviati T8/T9 dei servizi d'archivio (R44).

**Task 23** — Rotte in `elenchi-contratto.controller.ts` ed `elenchi-addebiti.controller.ts`, nessun
controller nuovo (R39). `aggiungi-righe` con le esclusioni di `sostituisci-da` e le regole di
condizione di D11, contate in `escluse.condizioni` (R45). Provvigione vuota svuota provvigione e
tipo (R45). Copia: contratto di arrivo `FOR SHARE`, elenchi `FOR UPDATE` in ordine di id.

**Task 24** — `AnteprimaVariazioneContratti` propria; `traduciConflitto` in
`conflitti-variazione.ts` (P2028 → `OPERAZIONE_CONCORRENTE`, gli altri → `VARIAZIONE_SUPERATA`,
anche per l'archivio); lock righe `ORDER BY id` poi fasce `ORDER BY riga_id, ordine`, `FOR NO KEY
UPDATE`, `lock_timeout` 10 s, `OPZIONI_TRANSAZIONE` come l'archivio; anno corrente con
`annoSolareItaliano` (`core/time/anno-italiano.ts:13`); percentuali con `validaPercentualiIstat`
del Task 6; tetto di 10.000 righe (`MAX_ELEMENTI_FILTRO` del DTO e `MAX_RIGHE` del servizio); ruoli
`RUOLI_VARIAZIONI` di `api/listino/ruoli.ts`. Test con sovrapposizione dimostrata, 55P03 vero, e
"la variazione dell'archivio non cambia le righe" (chiude il test vacuo del T10) (R46).

**Task 25** — Messaggio del tipo per l'elenco, import senza modifiche dei pezzi della 4.1b,
eccezione dichiarata a D16 per gli allegati di un contratto annullato (R47). Controller
`allegati-elenco.controller.ts` con prefisso `elenchi-addebiti` (R39).

**Task 26** — Azione "Listino" visibile al VIEWER (R48); vocabolario con `CAMPI_PER_FAMIGLIA`,
tipi di quantità (E15), "applica a" (E13), tipi di calcolo (R50), periodi delle scadenze; modelli
dalle interfacce corrette (R36, R45, R46); minor T12 del vocabolario (R48).

**Task 27** — `addebito-dialog.component.ts` con `@Input() rapida`; errori per campo; stati fisici e
operazioni da R42; minor T12 dei dialog in linea (R49).

**Task 28** — Descrizioni dei tipi di calcolo con la semantica del 16a (R50).

**Task 29** — Filtro "contratti scelti"; allegati anche col contratto annullato; minor T13 (R47,
R51).

**Task 30** — e2e con gli helper di `e2e/utils/attese.ts` (`cliccaEChiudi`, `attendiRisposta`,
`attendiElenco`, `ATTESA_SERVER`) e nomi casuali **per tentativo** (`conPrefissoUnico` nel corpo del
test), cliente via API con `partitaIvaCasualeValida`, variazione filtrata sul contratto del test,
ISTAT su un mese casuale di un anno 1995-2015, pulizia in `afterAll` (R52). `git diff --stat
869e98f..HEAD`. Il rapporto elenca le differenze volute del 16a per 3.8.

**Minor della 4.2a che restano fuori dalla 4.2b** (aree non toccate): provvigione `''` del cliente
senza tipo (T11) e smistamento degli errori per parole chiave nel dialog del cliente (T14); messaggi
inglesi di `@Min/@Max` (convenzione esistente); indici delle FK di `addebiti`; componente comune
delle codifiche (R25); P.IVA da `Date.now()` in 5 spec di MUD, giacenze, FIR e RENTRI (R55).

### Parallelismo 4.2b

**Chi usa Postgres:** 19, 20, 21, 22, 23, 24, 25 (e 30 per la suite intera). **Non lo usano:**
16a, 16, 17, 18 (dominio puro) e i frontend 26-29. Un solo database di test, **55438**
(`wasteflow-pg-test-registro`): la migration la applica **una volta** il 19, nell'ondata 1, dal suo
worktree; mai `migrate reset`. Ogni processo pesante (jest, `test:cov`, Karma, `ng build`, suite
Postgres, `tsc` del backend) sotto
`flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-02-fase4-2-listino/pesante.lock`;
prima di ogni suite Postgres la guardia di porta dei Vincoli globali; prima dei processi pesanti
`free -g` (sulla macchina girano anche jest e podman di altri progetti).

**Worktree:** uno per task, `git worktree add ../rifiuti-wt-42b-<task> -b wt/42b-<task> <HEAD del
principale dopo l'ondata precedente>`, i tre `node_modules` copiati per reflink (`cp -a
--reflink=auto`), mai condivisi; il worktree del 19 lancia `prisma generate` nel proprio
`node_modules`, quelli frontend mai. Integrazione a fine ondata nel worktree principale con `git
cherry-pick` (backend in ordine di numero, poi frontend), poi `prisma generate` nel principale e
revisione opus dell'ondata; i worktree fusi si rimuovono.

| Ondata | Task in parallelo | Perché insieme | Rischio |
|---|---|---|---|
| 1 | **16a** ∥ **16** ∥ **18** ∥ **19** (PG, migration) | i tre domini hanno file propri; il 19 non dipende dai domini (schema, SQL, RLS) | medio: quattro task da rivedere, ma il 16a è piccolo |
| 2 | **17** ∥ **20** (PG) ∥ **26** | 17 dopo 16a e 18 (niente stub); 20 dopo 16 e 19; 26 sulle interfacce del piano corrette dall'addendum | medio: 26 scrive i modelli prima delle rotte |
| 3 | **21** (PG) ∥ **27** | 21 dopo 17, 18, 20; 27 dopo 26 | medio: 27 dipende dal formato `errori` di R36 |
| 4 | **22** (PG) ∥ **25** (PG, eccezione) ∥ **28** | 22 dopo 21, 25 dopo 20; 28 dopo 27 e 16a | medio |
| 5 | **23** (PG) ∥ **24** (PG, eccezione) ∥ **29** | 23 dopo 21 e 22; 24 dopo 21; 29 dopo 26 (non tocca i file di 27-28) | medio: 29 usa rotte di 23-24 ancora in scrittura |
| 6 | **30** | tutto integrato; controllo del contratto d'interfaccia FE/BE; e2e e CI | — |

**Eccezioni alla regola "al massimo un task Postgres per ondata"** (come T10 ∥ T11 della 4.2a):
- **22 ∥ 25** — file disgiunti (22: `uso-listino.ts`, servizi d'archivio, `contratti-cliente.service.ts`;
  25: servizio e controller degli allegati, `listino.module.ts`), dati isolati per `tenantId`,
  esecuzioni Postgres serializzate dal `flock`, nessuna migration.
- **23 ∥ 24** — file disgiunti salvo `listino.module.ts` (una riga ciascuno, conflitto banale al
  cherry-pick); le variazioni e l'ISTAT filtrano sempre per azienda, quindi le righe create dai test
  del 23 in altre aziende non entrano nelle anteprime del 24.
- Costo se sbagliate: un test che fallisce per interferenza, da rilanciare; se succede due volte, il
  24 passa a un'ondata 5b prima del 30.

**File condivisi e chi li tocca** (ondate diverse salvo dove detto):
- `prezzo-speciale.ts` (+ spec) → solo 16a. `importi-riga.ts` (+ spec) → solo 17.
- `schema.prisma`, migration, `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`,
  `README-tenant-transazione.md`, `ops/README.md` → solo 19.
- `listino.module.ts` → 20, 21, 23, 24, 25 (23 e 24 nella stessa ondata).
- `listino-di-test.ts` → 20, 21.
- `elenchi-contratto.controller.ts` → 20, 21, 23; `elenchi-addebiti.controller.ts` → 20, 21, 23.
- `riferimenti-listino.ts` → 21. `uso-listino.ts` e i tre servizi d'archivio → 22.
- `variazioni-archivio.service.ts`, `dto/variazione-prezzi.dto.ts`, `conflitti-variazione.ts` → 24.
- `contratti-cliente.service.ts` (+ spec) → solo 22, mirata.
- FE: `listino.model.ts`, `listino.service.ts`, `vocabolario-listino.ts` → 26 (i successivi li
  leggono; se 27-29 hanno bisogno di un tipo nuovo lo aggiungono **in coda** e lo dichiarano nel
  rapporto); `app.routes.ts` → 26; `contratti-cliente-list.component.ts` → 26, 29;
  `contratto-cliente-dialog.component.ts` → 26; `addebito-dialog.component.ts` e i dialog in linea di
  codici IVA e codifiche → 27; `riga-addebito-dialog.component.ts` → 27, 28;
  `listino-contratto.component.ts` → 26, 29.
- Backend e frontend non condividono file. `e2e/` → solo 30.

### Domande aperte per Graziano

Da porre con AskUserQuestion prima dell'ondata 1 (Q7 cambia il 16a, Q8 un test del 16a, Q9 il
Task 21). Il piano procede con l'opzione consigliata.

- **Q7** (R31) — Tabella con una fascia `D`/`W` seguita da una fascia `A`/`X` raggiunta (fattura due
  volte la quantità della fascia alta): **rifiutarla in validazione, con le righe WinWaste così
  segnalate da 3.8 (consigliata)** / tenerla come WinWaste, dichiarata.
- **Q8** (R30) — `B` con quantità precedente: **fisso solo la prima volta che la fascia più alta è
  raggiunta (consigliata)** / differenza fra il fisso della fascia raggiunta ora e quello già
  fatturato (zero se negativa).
- **Q9** (R56) — Proposta del prezzo dall'archivio (marcata "da riferire" nel ledger della 4.2a):
  **solo se il listino ha un prezzo, differenza voluta di R6 (consigliata)** / come WinWaste (niente
  proposta se il listino ha un qualunque campo; col listino del cliente sconto e provvigione anche
  a prezzo vuoto). Se Graziano ha già risposto, vale la risposta.
