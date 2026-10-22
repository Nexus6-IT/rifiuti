# Piano C (integrità registro e FIR): confutazione del documento e della fedeltà a WinWaste

Data: 2026-10-22. Oggetto: `docs/superpowers/plans/2026-10-21-fase0-c-integrita-registro-fir.md`, letto contro la spec (`winwaste/docs/confronto-con-rifiuti.md` §4 e §7, `confronto-rifiuti/01-registro-fir-giacenze.md`) e contro la ricostruzione di WinWaste (`movimenti.md`, `formulari.md`, `giacenze.md`, `pese.md`, `rentri.md`, `rentri/03-aggancio-a-winwaste.md`, XSD in `rentri/xsd/`). Ho tenuto conto dei tre giri precedenti, di `decisioni-per-graziano.md` (esito del 2026-10-22), del ledger `progress.md` e di `final-review.md`. Il codice (`c9b10dd..23c5a17`) l'ho letto solo con `git show`, per confermare che una lacuna del documento è reale. Non ho modificato nulla nel worktree, salvo questo file.

Non ripeto i punti già decisi (DG-01…DG-51). Quando torno su una decisione è per un'evidenza che i giri precedenti non avevano: la indico ogni volta.

Severità: **Critica** = il rilascio produce dati legalmente sbagliati o blocca il lavoro; **Importante** = una regola del piano contraddice il modello RENTRI o WinWaste e vincola le fasi successive; **Media** = una lacuna che l'utente incontra, con una via d'uscita; **Minore** = da annotare.

## Riepilogo

| Severità | Numero |
|---|---|
| Critica | 0 |
| Importante | 3 |
| Media | 7 |
| Minore | 1 |

---

## Obiezioni

### C-W-01 — Il peso a destino non va "nella ricopia": nel modello RENTRI è l'esito dello scarico, mentre nel carico del destinatario è la quantità stessa

- **Severità:** Importante
- **Dove:** piano, Decisione 1 (riga 23: "Consiglio: (a)"), Task 4 (`stessiDatiRicopia`), "Fuori ambito" (peso a destino nella ricopia). WinWaste: `formulari.md` §2.1 riga 81 e §2.2 righe 113-115; `rentri/03-aggancio-a-winwaste.md` §3.1 righe 195, 202-203 e 240-241; XSD `rentri-movimenti-1.0.xsd` righe 52-66 e 152-158.
- **Affermazione:** la Decisione 1 tratta il peso a destino come una quantità alternativa da copiare nel movimento, con un'unica regola per carico e scarico: (a) il peso a destino se il FIR è `CONSEGNATO`, (b) la quantità dichiarata. In WinWaste e in RENTRI le due direzioni seguono regole diverse.
  - **Scarico del produttore** (`aT`, `DT`, `NP`): `QuantitaRifiuto` è la quantità **all'origine** (`C4§15`, con l'unità in `C4§16`). Il peso verificato va in un blocco a parte dello **stesso** movimento: `Esito { PesoVerificatoDestino, DataFineTrasporto, Respingimento }`, con `C4§22` per gli OPER 11/23. Il registro RENTRI riceve quindi una sola registrazione, con la quantità di partenza e l'esito.
  - **Carico dell'impianto** (`T*`): la quantità è `NETTO`, e nei formulari `NETTO` è il peso a destino ("pesi a destino in kg").
  - L'opzione (a) consigliata dal piano sbaglierebbe quindi lo scarico (sostituirebbe la quantità di partenza), e il predefinito (b) sbaglia il carico del destinatario (gli carica la dichiarata invece dell'accettata).
- **Conseguenza per l'utente:** un impianto ricopia un FIR come CARICO e gli si propone la dichiarata (1.000 kg) invece dei 940 kg pesati. Quando se ne accorge, una seconda ricopia con 940 kg riceve `FirGiaRegistratoError` (Task 4) e il registro non ha rettifiche: la giacenza dell'impianto resta 60 kg più alta per sempre. Per il produttore, oggi non c'è nessun posto dove annotare l'esito o il respingimento parziale che RENTRI vuole sulla registrazione di scarico.
- **Evidenza:** `rentri/03` riga 195: "`netto` → `QuantitaRifiuto` … Per `aT/TaT/DT/NP/RE` vale invece `C4§15`". Riga 202: "`netto` oppure `C4§22` (oper 11/23) → `PesoDestino`". Riga 241: `Esito {PesoVerificatoDestino, DataFineTrasporto, Respingimento{…}}`. Nello XSD, `Movimento` contiene `Esito` di tipo `mov:DatiEsito`, facoltativo, accanto a `Rifiuto.Quantita`. Codice: `registro.component.ts` copia `r.quantita` per entrambi i tipi (Decisione 1 del piano).
- **Correzione proposta:**
  - **Piano:** riscrivere la Decisione 1 e la voce dei follow-up separando i due tipi. Nello SCARICO resta la quantità dichiarata; il peso a destino e il respingimento diventano **campi d'esito** del movimento, da integrare dopo (un'integrazione, non una seconda ricopia né una rettifica). Nel CARICO del destinatario la ricopia propone `effectiveWeight` quando c'è. Togliere "Consiglio: (a)".
  - **Decisione per Graziano:** se nel CARICO del destinatario usare già in Fase 0 il peso effettivo, che è una modifica di una riga in `onFirSelect`. Con la regola del ±10% ancora attiva (DG-36), quel peso resta comunque vincolato.
  - **Follow-up:** colonne d'esito su `WasteMovement`, da aggiungere prima della trasmissione del registro.

### C-W-02 — "L'import della Fase 3 passerà dallo use case" contraddice la continuità dei protocolli, e il go-live a metà anno riparte da 1

- **Severità:** Importante
- **Dove:** piano, Decisione 10 (riga 32, ultima frase) e Task 10. Spec: `01-registro-fir-giacenze.md` §5.2 riga 239 e §5.3 punto 4; `confronto-con-rifiuti.md` §9 ("continuità del registro e della numerazione"). WinWaste: `movimenti.md` §3.3 righe 216-219; `rentri/03` riga 225; XSD `IdentificativoMovimento` {Anno, Progressivo}.
- **Affermazione:** il piano dice che l'import da WinWaste "dovrà passare dallo use case con la data di registrazione originale (lo use case la accetta ancora, il controller no)". Ma lo use case assegna sempre `MAX(progressive_number)+1` sotto il lock `<tenant>-<anno>`, e a ogni scarico applica anche il controllo di giacenza e quello di collegabilità del FIR. La spec chiede invece di migrare `PROT1` (o `RENregistrazioni.PROTOCOLLO` dopo RENTRI) "conservando il numero originale". Dopo l'entrata in vigore di RENTRI quel progressivo è già stato trasmesso all'ente come `NumeroRegistrazione {Anno, Progressivo}`.
- **Conseguenza per l'utente:** un cliente WinWaste che passa a WasteFlow a giugno comincia dal movimento n. 1 del 2026, mentre il suo registro (e RENTRI) ha già i numeri da 1 a N per lo stesso anno. Quando WasteFlow trasmetterà il registro, le coppie (anno, progressivo) si sovrapporranno a registrazioni già trasmesse. Una volta usati i primi numeri, il vincolo `@@unique([tenantId, progressiveYear, progressiveNumber])` impedisce di importare dopo la storia dell'anno con i numeri originali. L'import "dallo use case" la rinumererebbe comunque.
- **Evidenza:** `registra-movimento.use-case.ts` @ `23c5a17` (lock dell'anno, poi `MAX`). `movimenti.md` §3.3: "Dopo l'entrata in vigore del RENTRI … il progressivo vive allora in `RENregistrazioni.PROTOCOLLO`". `rentri/03` riga 225: `ANNO`, `PROTOCOLLO`, `IDRENTRI` → `Riferimenti.NumeroRegistrazione`.
- **Correzione proposta:**
  - **Piano:** correggere l'ultima frase della Decisione 10. L'import **non** passa dalla numerazione dello use case: serve un percorso di import che scriva il numero originale (o un "primo progressivo" per tenant e anno) ed escluda i controlli che non hanno senso sullo storico.
  - **Decisione per Graziano, prima del primo cliente reale:** il go-live si fa solo al 1° gennaio, oppure si introduce un progressivo iniziale configurabile per tenant e anno. Va indicato anche nel riepilogo «Cosa vede l'utente».

### C-W-03 — L'unicità "un FIR, un movimento per tipo" è una regola da produttore, ma la Fase 0 deve valere per ogni segmento

- **Severità:** Importante
- **Dove:** piano, Decisioni 2 e 3, Task 4 (indice `(tenant_id, fir_id_ricopia, type)`, `FirGiaRegistratoError`). Spec: `confronto-con-rifiuti.md` §7, Fase 0 "valgono per qualunque segmento", e §6.1 (segmento ancora da scegliere). WinWaste: `movimenti.md` §3.2 righe 205-207 (AVANZ 4-5 master/dettagli, AVANZ 6-7 produttori percentuali); `formulari.md` §3.8 riga 271 (spurghi multiluogo, MASTER più dettagli) e §4 riga 283 (duplicati solo come avviso, "Si desidera continuare lo stesso?").
- **Affermazione:** il piano, e DG-29 a valle, si basano su "per un produttore non esistono due movimenti legittimi sullo stesso FIR e tipo". In WinWaste lo stesso documento genera di proposito più movimenti dello stesso verso:
  - i **produttori percentuali** producono n carichi, uno per produttore;
  - la **causale master con dettagli** (microraccolta, spurghi multiluogo) mette in fattura il master e nel registro e nel MUD i dettagli;
  - il controllo dei duplicati del numero FIR fra i movimenti è **solo un avviso** che si può superare.
  
  Il piano invece rifiuta con errore ogni seconda ricopia con dati diversi (nello use case legge `fir_id`, quindi anche lo storico) e la vieta nel database con l'indice unico.
- **Conseguenza per l'utente:** un impianto o un trasportatore che riceve una microraccolta (un FIR, più conferenti, più carichi con quantità diverse) può registrare solo il primo carico collegato al FIR. Gli altri restano senza collegamento, oppure non si registrano. Allargare la regola dopo richiede una migration che tolga l'indice, e va rivisto anche il "doppi identici contati una volta" del piano A (DG-29), che fonderebbe due dettagli legittimi con la stessa quantità.
- **Evidenza:** `movimenti.md` righe 206-207; `formulari.md` righe 271 e 283; migration `20261021120000_registro_ricopia_fir_unica`; `registra-movimento.use-case.ts:327-332` @ `23c5a17` (`findMany` su `{ tenantId, firId, type }`).
- **Correzione proposta:** **decisione per Graziano.**
  - (a) Scrivere esplicitamente nel piano che la regola vale per il segmento produttori e che la scelta del segmento gestori (§6.1) la riapre, con il costo indicato (migration e piano A).
  - (b) In alternativa, legare l'idempotenza a una chiave della richiesta (`Idempotency-Key` del client, salvata sul movimento) invece che a FIR e tipo, e trasformare "stesso FIR, dati diversi" in un avviso da confermare, come in WinWaste.
  
  Il predefinito (a) costa solo testo.

### C-W-04 — Il termine di annotazione si conta in giorni di calendario, mentre la legge dice giorni lavorativi; il termine dei gestori non si applica mai

- **Severità:** Media
- **Dove:** piano, Decisione 10 ("il ritardo di legge si conta in giorni italiani di calendario") e Task 10 (`ritardoRegistrazioneGg`). Giro 3 dominio, riga 83 ("il piano lo calcola già"). Spec: `01-registro-fir-giacenze.md` R10 riga 35.
- **Affermazione:** l'art. 190 fissa 10 giorni **lavorativi** per i produttori e 2 per i gestori. Lo dice anche il commento dello schema (`schema.prisma:1710-1711`). L'entità usa una soglia fissa di 14 giorni di calendario (`waste-movement.entity.ts:45`). `TERMINE_REGISTRAZIONE_GESTORE_GG = 3` non è letta da nessuna parte (`git grep`: solo la definizione). Il Task 10 ha riscritto proprio questo calcolo e lo ha confermato come termine "di calendario". La frase del giro 3 secondo cui il piano calcola già il termine dei 10 giorni lavorativi non è esatta.
- **Conseguenza per l'utente:**
  - **Falso allarme.** Movimento di lunedì 21/12/2026, con sabati, domeniche e festivi esclusi: il decimo giorno lavorativo è il 07/01/2027, cioè 17 giorni di calendario. Una registrazione del 05/01 riceve il toast "ATTENZIONE: fuori termine di legge" pur essendo in termine.
  - **Allarme che manca.** Per un impianto (2 giorni lavorativi) un ritardo fra 3 e 14 giorni non viene mai segnalato.
- **Evidenza:** `waste-movement.entity.ts:41-46`, `:112`, `:182` @ `23c5a17`; `registra-movimento.use-case.ts:302-303` (il log riporta "termine di legge (14 gg)").
- **Correzione proposta:**
  - **Piano:** correggere la Decisione 10 ("stima in giorni di calendario, non il termine di legge"). Il toast diventa "possibile ritardo" invece di "fuori termine di legge".
  - **Follow-up:** un calendario dei giorni lavorativi (festività nazionali, Pasquetta; il trattamento del sabato va validato con il consulente) e la soglia scelta in base al ruolo del tenant.

### C-W-05 — Unità: RENTRI ammette solo kg e litri, il DTO accetta testo libero, e un'unità sconosciuta salta il controllo di giacenza

- **Severità:** Media
- **Dove:** piano, Decisione 4, Task 1 e Task 3 (passo 1: "Se `!u.massa` … si prosegue senza lock né query"). WinWaste: `movimenti.md` §2.2 righe 116 e 94-95 (`KGNUM` sempre in kg, volume a parte); XSD `rentri-enum-1.0.xsd` righe 59-64 (`UnitaMisura` = `kg` | `l`).
- **Affermazione:** il piano tratta "ogni altra unità" come non di massa e salta il controllo di giacenza. Tre problemi:
  1. **L'unità è testo libero via API.** `RegistraMovimentoDto.unit` ha solo `@IsString() @MaxLength(10)`, quindi `"Kg."`, `"KGS"` o `"Q"` diventano "non di massa" e lo scarico passa senza controllo, con un solo warning nel log. È l'opposto del fail-closed che il piano applica altrove (Decisione 9, giacenza non calcolabile).
  2. **I litri si possono confrontare con i litri**, e sono l'unità dei rifiuti liquidi ammessa da RENTRI (oli esausti, emulsioni). Il piano invece li esclude dal controllo.
  3. **L'esempio della Decisione 4 non può accadere.** Il "rifiuto in m³ ricopiato da FIR" non esiste: l'enum del FIR è `kg`, `litri`, `t` (`domain/fir/value-objects/quantita.ts:8-12`). Il m³ arriva solo da chiamate API dirette.
  
  WinWaste invece ha sempre un netto in kg (`KGNUM`) e il volume come dato in più.
- **Conseguenza per l'utente:** per gli oli usati in litri nessuno scarico viene mai controllato. Un client API con un errore di battitura nell'unità aggira il blocco. Un registro in `M3` non sarà trasmissibile a RENTRI.
- **Evidenza:** `registra-movimento.dto.ts` @ `23c5a17` (campo `unit`); XSD `UnitaMisura`; `quantita.ts`.
- **Correzione proposta:**
  - **Piano:** nel DTO, `@IsIn` sugli alias noti (KG, T e LITRI/L con i loro alias), con rifiuto per tutto il resto (fail-closed). Nella query del Task 2, un secondo saldo per la famiglia "litri" con lo stesso blocco e lo stesso avviso.
  - **Follow-up:** il selettore dell'unità, già previsto, limitato a kg, t e litri.

### C-W-06 — La chiave della giacenza (tenant e CER) mescola sedi, registri e stati fisici; il piano A avvisa chi ha più sedi, il piano C no

- **Severità:** Media
- **Dove:** piano, Task 2 e 3 (lock `giacenza|tenant|CER`, messaggio "nel registro restano X"), Task 6. WinWaste: `giacenze.md` §2.1 riga 59 (chiave = unità locale, magazzino, posizione, CER, stato fisico) e §3.1 righe 133-137 (stesso CER **e** stesso `FISI`, carichi del registro dopo RENTRI); `movimenti.md` §2.4 riga 154 (OPER 30/40, trasporto c/terzi e intermediazione, nessuna giacenza). Piano A: DG-26 (avviso per più unità locali).
- **Affermazione:** la spec rimanda l'unità locale alla Fase 2, e questo lo accetto. Il piano però non dice all'utente che il saldo che blocca o autorizza uno scarico è un totale di tutta l'azienda. Ci finiscono anche i carichi di trasporto c/terzi e gli stati fisici diversi dello stesso CER, che WinWaste tiene separati. Il piano A, per lo stesso limite, mostra un avviso esplicito quando il tenant ha più `RentriUnitaLocale` attive; il piano C non lo fa, né nel messaggio di blocco né nella pagina giacenze.
- **Conseguenza per l'utente:** un'azienda con due sedi registra uno scarico alla sede B coperto da un carico della sede A. Lo scarico passa senza avviso, e la pagina giacenze mostra un unico numero che non corrisponde a nessun deposito reale. Il messaggio "nel registro restano X" sembra un dato puntuale, ma è un totale aziendale.
- **Evidenza:** `giacenza-disponibile.ts` @ `23c5a17` (nessun filtro di sede o stato fisico); `schema.prisma:1861` (`RentriUnitaLocale` esiste, ma il movimento non ha la sede).
- **Correzione proposta:**
  - **Piano:** con più di una `RentriUnitaLocale` attiva, aggiungere un avviso (nella risposta dello scarico e in testa alla pagina giacenze): "la giacenza è calcolata su tutte le sedi". Aggiungerlo anche a «Cosa vede l'utente».
  - **Follow-up di Fase 2:** chiave unità locale, registro e stato fisico, ed esclusione dal saldo delle causali di solo transito (trasporto c/terzi, intermediazione).

### C-W-07 — "Le rettifiche della Fase 2 non sono vincolate" vale per l'indice, non per lo use case e per la query di giacenza

- **Severità:** Media
- **Dove:** piano, Decisione 3 (ultima frase) e "Fuori ambito" (riga 1381). XSD `rentri-movimenti-1.0.xsd` righe 40-50 (`AnnullamentoMovimento` con `NumeroRegistrazioneAnnullata`) e righe 70-75 (`NumeroRegistrazioneRettifica`). WinWaste: `movimenti.md` §3.6 (l'annullato prende `DTUK='$$…'`, tutte le query filtrano `dtuk > '0'`, le quantità tornano ai carichi).
- **Affermazione:** nel modello RENTRI una rettifica o un annullamento è una **nuova** registrazione che sostituisce o annulla la precedente. Una rettifica dello scarico di un FIR ha quindi lo stesso FIR e lo stesso tipo. Il piano garantisce solo che l'indice non collida (`fir_id_ricopia` a `NULL`). Due punti però restano legati:
  - il controllo idempotente dello use case legge `fir_id` e, con dati diversi, lancia `FirGiaRegistratoError`;
  - `giacenzaDisponibileAl` somma ogni riga, quindi conterebbe sia l'originale sia la rettifica.
  
  In WinWaste tutte le letture escludono i movimenti superati.
- **Conseguenza per l'utente:** nessuna oggi. In Fase 2 una rettifica fatta passare dallo stesso use case verrebbe rifiutata, e una fatta con un use case a parte raddoppierebbe la giacenza e il MUD, finché qualcuno non ritocca tre moduli condivisi (`ricopia-fir.ts`, `giacenza-disponibile.ts` e l'aggregazione del piano A).
- **Evidenza:** `registra-movimento.use-case.ts:327-332`; query del Task 2 (nessun filtro di stato).
- **Correzione proposta:** **piano**, sezione "Fuori ambito". Riscrivere la voce: la Fase 2 deve introdurre un marcatore di movimento "superato o annullato", che escludono la query di giacenza, il controllo idempotente e l'aggregazione MUD. In alternativa le rettifiche passano da uno use case dedicato che rispetti questa regola. Nient'altro da cambiare oggi.

### C-W-08 — Il messaggio sul FIR in bozza fa registrare uno scarico senza numero di formulario

- **Severità:** Media
- **Dove:** piano, Task 5, messaggio `BOZZA` ("registra lo scarico senza collegare questo FIR"). WinWaste: `movimenti.md` §2.2 riga 80 (`FORMU`, testo) e §3.5 riga 228 (il movimento cita il FIR con `FORMU` + `DATD`); XSD `DatiIntegrazioneFir.NumeroFir` (stringa).
- **Affermazione:** in WinWaste il movimento porta il numero e la data del formulario come testo, anche quando il FIR non è gestito nel programma. In WasteFlow l'unico riferimento è `firId`, cioè un FIR presente nel database. Il messaggio nuovo indirizza l'utente verso uno scarico senza alcun riferimento al formulario usato davvero. Lo stesso accade per ogni FIR di terzi che non è in WasteFlow.
- **Conseguenza per l'utente:** lo scarico registrato seguendo il messaggio non dice con quale formulario è partito il rifiuto, né in un'ispezione né per la futura `IntegrazioneFir` verso RENTRI. L'unico rimedio è scriverlo a mano nelle note, e il messaggio non lo dice.
- **Evidenza:** schema `WasteMovement` @ `23c5a17` (nessun campo per il numero FIR); testo del Task 5 (riga 792).
- **Correzione proposta:**
  - **Piano:** aggiungere al messaggio "…e riporta nelle note numero e data del formulario usato".
  - **Follow-up:** un campo testuale per numero e data del FIR sul movimento, come `FORMU` e `DATD` di WinWaste. Serve anche all'import della Fase 3.

### C-W-09 — Autocompletamento dei FIR: con 200 FIR caricati e i ricopiati ancora in lista, un tenant migrato non trova i FIR da registrare

- **Severità:** Media
- **Dove:** piano, Task 5 (filtro `firCollegabileNelRegistro` applicato **dopo** `getFIRList(1, 200)`) e "Fuori ambito" (righe 1380 e 1382, due voci separate). WinWaste: `formulari.md` §2.3 riga 127 (l'"incolla" cerca solo i FIR con `c7 = ''`, cioè non ancora ricopiati, per numero).
- **Affermazione:** il piano tratta come due follow-up indipendenti il limite dei 200 e i FIR già ricopiati che restano in lista. Insieme formano un problema che si vede dal primo giorno. Il filtro è lato client sulla prima pagina, quindi bozze e annullati occupano posti fra i 200. Dopo un import di storico, i 200 più recenti possono essere tutti già ricopiati. WinWaste propone solo i FIR non ancora ricopiati e li cerca per numero.
- **Conseguenza per l'utente:** un cliente migrato, o con più di 200 FIR, apre il registro e non trova il FIR della settimana precedente. Deve registrare lo scarico senza collegamento, e si torna al caso di C-W-08.
- **Evidenza:** `registro.component.ts:1195-1204` @ `23c5a17`.
- **Correzione proposta:** **follow-up da chiudere prima della Fase 3.** Una sola voce invece di due: una ricerca lato server dei FIR collegabili e non ancora ricopiati per il tipo scelto, con filtro per numero. Riunire le due voci di "Fuori ambito".

### C-W-10 — Senza numero vidimato, il PDF continua a chiamare "Numero FIR" il riferimento interno

- **Severità:** Media
- **Dove:** piano, Task 9 (riga 1167: "Senza numero RENTRI il titolo resta 'Numero FIR' con `firNumber`, come oggi") e Decisione 9 (è collegabile anche un FIR "emesso in locale" senza vidimato). Precedenti: G2-D-15 e DG-14. WinWaste: `formulari.md` §2.1 righe 68-69 (`FORMU` = numero fiscale o seriale vidimato; `NUMD` = numero interno, campo distinto) e §3.3 (dopo l'entrata in vigore di RENTRI i blocchi ViViFIR non si usano più).
- **Affermazione (residuo di G2-D-15 con evidenza nuova):** il piano accetta il predefinito DG-14 (il numero legale è il vidimato). Nel caso più frequente oggi, però, cioè tenant in modalità `MANUALE` (il default dello schema) e scorta non collegata, il PDF stampa ancora `FIR-AAAA-NNNNNN` sotto l'etichetta "Numero FIR". WinWaste non presenta mai il numero interno (`NUMD`) come numero del formulario: il numero del formulario è sempre `FORMU`, preso da una serie fiscale o da un blocco vidimato.
- **Conseguenza per l'utente:** l'utente stampa e fa viaggiare un documento che sembra un FIR numerato, ma non ha la vidimazione digitale che il regime RENTRI richiede (da validare con il consulente). Lo stesso documento si collega al registro come FIR "emesso".
- **Evidenza:** `pdf.service.ts:118-129` @ `23c5a17`.
- **Correzione proposta:**
  - **Piano:** senza `rentriNumeroFir`, etichetta "Riferimento interno (FIR non vidimato)" e nessun "Numero FIR".
  - **Decisione per Graziano:** se emettere in locale senza numero vidimato debba essere consentito prima del piano della scorta.

### C-W-11 — Due decimali: WinWaste e RENTRI lavorano al grammo; in tonnellate il passo è di 10 kg

- **Severità:** Minore
- **Dove:** piano, Task 4 (`@IsNumber({ maxDecimalPlaces: 2 })`), colonna `quantity numeric(10,2)` (`schema.prisma:1723`, e `:301` per il FIR). WinWaste: `movimenti.md` §2.6 (`Str(sum(kgnum-giascar),16,3)`); `rentri/03` riga 195 (formato `######0.000`).
- **Affermazione:** il piano rende esplicito un limite che prima era un arrotondamento silenzioso. Ora una quantità con 3 decimali viene rifiutata dall'API. In tonnellate 2 decimali valgono 10 kg. Lo storico WinWaste ha 3 decimali in kg.
- **Conseguenza per l'utente:** un client API riceve un 400 su `12,345 kg`. L'import della Fase 3 arrotonda (lo use case non passa dal DTO) e il saldo per CER non torna più al grammo con WinWaste.
- **Correzione proposta:**
  - **Follow-up prima della Fase 3:** migration a `numeric(14,3)` su movimento e FIR.
  - **Piano:** aggiungere il nuovo rifiuto dell'API a «Cosa vede l'utente» (il ledger lo prevede già per la PR).

---

## Cosa regge

- **Giacenza dentro la transaction, sotto un lock per tenant e CER preso dopo quello del progressivo.** Il piano chiude il difetto D21 della spec in modo più solido di WinWaste. WinWaste serializza con un file `reteMov.tmp` e calcola `MAX()+1` fuori dal batch, che fa sempre COMMIT (`movimenti.md` §5.1, §5.4). Il test con due anni di registrazione diversi prova davvero il lock.
- **Blocco sul saldo complessivo e avviso sull'ordine delle date (DG-15).** È fedele a WinWaste: l'abbinamento considera i carichi con data ≤ scarico, ma un carico con data successiva al trasporto dà solo un avviso (`giacenze.md` §3.2), e nessun limite blocca (`giacenze.md` §5.2). Il conteggio per giorno italiano evita i falsi avvisi di WinWaste, che confronta stringhe `aaaammgg` costruite con l'anno del database.
- **Tonnellate convertite e unità vuota uguale a kg.** È corretto e allinea la pagina giacenze a `KGNUM` di WinWaste, dove tutto è in kg. Le obiezioni di C-W-05 riguardano solo le unità diverse da quelle di massa.
- **Riferimento interno del FIR sotto lock per tenant e anno di emissione, con l'anno letto dal numero e il massimo numerico.** Elimina il difetto D2b/D14 (in WinWaste la verifica e l'avanzamento di `INTEFORM` sono separati) e regge un import con numeri in formato diverso.
- **FIR e firme salvati nella stessa transaction (D20)**, con la firma senza utente bloccante. WinWaste sul FIR digitale salva solo una marca in `C6` e perde l'esito: rifiuti è più solido.
- **Data di registrazione assegnata dal server.** Il registro resta cronologico per costruzione, ed è coerente con `DataOraRegistrazione` dello XSD (`dateTime`). Rende inutile il controllo "Protocolli non consecutivi" di WinWaste. L'unico rilievo è quello sull'import (C-W-02), non sulla regola.
- **Idempotenza della ricopia per il segmento produttori**, con il FIR ricopiato riconosciuto come in WinWaste (`C7='R'`), e la migration che non può fallire sui doppi storici (verificati a 0 sul VPS di collaudo).
- **Collegabilità dei FIR presi da RENTRI** (bozza locale con numero RENTRI) e **stato dell'ente salvato davvero** (Task 0): è necessario e corretto. Senza il Task 0 l'annullamento all'ente non avrebbe mai effetto.
- **Data della ricopia solo quando è vera (DG-19):** è più prudente di WinWaste, che propone la data di emissione presa dalla cache RENTRI.
- **Nessuna contraddizione** con il §7 della spec sui punti di Fase 0 che il piano copre: giacenza nella transaction e per unità di misura, numerazione FIR e salvataggio atomico. La regola del ±10% figura nella Fase 0 della spec ma è rinviata da DG-36: è una scelta già presa, la segnalo solo perché C-W-01 ne cambia il contenuto.
