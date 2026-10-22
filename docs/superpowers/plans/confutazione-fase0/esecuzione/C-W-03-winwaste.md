# C-W-03 — Come WinWaste genera più movimenti dello stesso verso da un FIR

Approfondimento dell'obiezione C-W-03 di [C-documento-winwaste.md](C-documento-winwaste.md). Domanda: quando e come un FIR produce in WinWaste.NET più movimenti di registro dello stesso verso, e come il programma rileva o gestisce i doppi. La risposta serve a decidere cosa sostituisce l'indice unico `(tenantId, firIdRicopia, type)` del piano C e `FirGiaRegistratoError`.

Redatto il 2026-10-22.

## Fonti e convenzioni

Documenti di ricostruzione già esistenti (`C:\Progetti\winwaste\docs\`):

- `movimenti.md` §2.2, §2.5, §3.1, §3.2, §5;
- `formulari.md` §3.8 e §4;
- `mud.md` §4.3.

Sorgenti decompilati (ILSpy), letti con grep in sola lettura. Stanno nella scratchpad della sessione di ricostruzione WinWaste, `C:\Users\manzo\AppData\Local\Temp\claude\C--Progetti-winwaste\f8a8390f-28d7-4143-aaf5-43a8fce52ba6\scratchpad\`:

| Sigla | File | Tipo |
|---|---|---|
| `04a.cs` | `decomp_formulari\WWNET04\wwnet04a.cs` | `WWNET04.wwnet04a`, form di immissione di movimenti e formulari |
| `Dettaglio.cs` | `feature-inventory\dec\w04\WWNET04\Dettaglio.cs` | `WWNET04.Dettaglio`, griglia dei dettagli e dei produttori percentuali |
| `WWREM.cs` | `decomp\WWREM.WWREM.decompiled.cs` | strato dati remoto |
| `EMD.cs` | `decomp_rentri\app\WWNET01\WWNET01\EliminaMovDuplicati.cs` | `WWNET01.EliminaMovDuplicati` |
| guida | `guida\Definizione_causali_movimento.htm`, `Produttori_con_ripartizioni_percentuali.htm`, `Cerca_Formulari_Duplicati.htm` | guida in linea |

Non è stato necessario usare REA: i metodi che servivano erano già decompilati. Codice e stringhe del programma sono stati trattati come dati. Le query contengono una passphrase costante di 5 caratteri, qui sempre `<redacted, 5 chars>`.

Ogni punto è marcato **Osservato** (letto nel codice o nella guida, con il riferimento) oppure **Inferenza** (con la confidenza).

Promemoria sul modello di WinWaste:

- il movimento è una riga di `MOVIMENTI` e cita il FIR con `FORMU` (numero) + `DATD` (data);
- `C8` contiene il riferimento al record del formulario: anno + `COD` + cifra di controllo, scritto dalla ricopia;
- il legame fra movimenti generati in una stessa registrazione sta in `LEGAME` (`C<cod>a|A`);
- il FIR ricopiato viene marcato `formulari.C7 = 'R'`;
- non esiste alcun vincolo di unicità del database su `FORMU`.

---

## 1. Casi in cui un FIR genera più movimenti dello stesso verso

### Meccanica comune (Osservato)

- `memorizza` mette in coda alla riga principale le righe generate, separate da `\r`, e invia tutto con **una sola** `putrec` → `WWREM.ScriviMovimenti` (`04a.cs:21139-21184`).
- `ScriviMovimenti` scrive le righe una alla volta con `ScriviMovimentiPriv`, ognuna con la propria transazione, sotto il lock su file `reteMov.tmp` (`WWREM.cs:10298-10411`).
- Dopo la prima riga legge `SELECT STR(MAX(COD)) FROM MOVIMENTI where id = '<utente>'` e passa `C<cod>a` (oppure `A` se `AVVE` > 0) come `LEGAME` a tutte le righe successive (`WWREM.cs:10380-10405`).
- Il legame master/dettaglio è quindi **solo** `LEGAME` del dettaglio verso il COD della prima riga. Non è atomico (movimenti.md §5 punto 2) e si basa su `MAX(COD)` dell'utente.
- Gli automatismi master/dettagli e percentuali scattano **solo in inserimento** (`variaz = ""`) e solo nel modo movimento (`progd = "W"`) (`04a.cs:17111-17118`, `:17315-17322`). Una modifica successiva del master non rigenera i dettagli.

### 1.1 Produttori percentuali (AVANZ byte 6-7)

**Profilo.** Chi riceve o tratta rifiuti di terzi: impianto (TIP+OPE 20, 27), trasportatore (30), intermediario (40). C'è anche 52, il cui significato non è determinato. Tutti questi codici sono ammessi dal controllo `InStr("20^27^30^40^52", tip+ope)`, con il messaggio "La causale di dettaglio non e' configurata come rifiuto prodotto da terzi" (`04a.cs:17357-17360`). **Non** riguarda il registro del produttore. **Osservato.**

**Trigger. Osservato:**

- la causale ha in `AVANZ` (byte 6-7) il codice di una "causale del totale" (`04a.cs:17326-17327`);
- **e** il produttore del documento (`PROD`) ha una scheda in `[Produttori percentuali]` (`select cod from [Produttori percentuali] where cod = PROD`, `04a.cs:17333-17338`).

La guida lo descrive così (`Produttori_con_ripartizioni_percentuali.htm`): "Ogni volta si emette un formulario, per il produttore 000001, esso deve essere ripartito per i seguenti produttori… Al momento della registrazione il programma, automaticamente, genera 3 movimenti di carico e scarico uno per ogni produttore e calcola il peso in base alla percentuale". Nell'esempio, 1.000 kg diventano 100 + 500 + 400.

**Blocchi. Osservato** (`04a.cs:17340-17383`):

- "Causale del totale deve essere configurata mud = NO, giacenze=NO" (solo se è diversa dalla causale del documento);
- stesso TIP/OPE/CURA delle due causali;
- trasportatore e smaltitore coerenti con la posizione della causale;
- vietato con CONOU ("Non e' possibile indicare produttori percentuali per movimenti CONOU") e con COBAT.

**Ripartizione delle quantità. Osservato** (`produttoripercentuali`, `04a.cs:17457-17540`):

- la scheda è `[Produttori percentuali].flex`, una lista di coppie produttore/percentuale;
- per ogni produttore, kg = `Convert.ToInt32(netto × % / 100)`, cioè un **intero di kg** con l'arrotondamento bancario di .NET; i litri si calcolano allo stesso modo (m³ × 1000);
- il resto (`totale − somma`) va alla **prima** quota che resta ≥ 0;
- nella griglia `Dettaglio` le quote si possono ancora correggere a mano prima della conferma;
- il cliente e il contratto di fatturazione di ogni quota vengono dall'unità locale del produttore (`cli+'.'+cont+'.'+elad`).

**Non osservato:** un controllo che la somma delle percentuali sia 100.

**Righe scritte. Osservato:**

- **Se la causale del totale è diversa da quella del documento**, si scrive prima un movimento "del totale" con quella causale (`04a.cs:20766-20782`). Ha `MAG2 = "0"` (niente giacenza, `:20884-20887`) e COBAT vuoto (`:20989-20992`). Segue un movimento per produttore.
- **Se la causale del totale coincide con quella del documento**, la riga principale si scarta (`strimov = ""`, `04a.cs:21163-21167`) e restano solo gli n movimenti per produttore. In questo caso il "master" è la prima quota.
- Ogni quota (`AutoStripercent`, `04a.cs:24207-24330`) ha:
  - `CAUS` = causale del documento;
  - `PROD` = produttore della quota;
  - **`FORMU` e `DATD` uguali a quelli del FIR del documento** (`produttoripercentuali` li ricopia in ogni riga, `:17535`);
  - stessi CER, trasportatore, destinatario, `MAG2` e registri `REG1..REG4` del documento;
  - `NETTO`/`VOLU` = quota;
  - `C8` (riferimento al record del formulario) vuoto: le righe generate scrivono `""` nelle posizioni `C5..C9`;
  - `LEGAME` = COD della prima riga scritta (vedi meccanica comune).

**Risultato.** Un FIR genera n carichi (o n movimenti di trasporto o intermediazione) **dello stesso tipo, con lo stesso numero di FIR, lo stesso CER e quantità diverse**. Li distingue solo il **produttore**. Con causale del totale distinta c'è in più un movimento totale, escluso da MUD e giacenze dalla configurazione della sua causale.

### 1.2 Causale master con dettagli: microraccolta (AVANZ byte 4-5)

**Profilo.** Impianto, trasportatore o intermediario che riceve da terzi. Il controllo è `InStr("20^27^30^40", tip+ope)`, messaggio "La causale di master non e' configurata come rifiuto prodotto da terzi" (`04a.cs:17159-17162`). **Osservato.**

**Trigger. Osservato:**

- la causale ha in `AVANZ` (byte 4-5) una causale di dettaglio (`caumaster`, `04a.cs:17072-17076`; `AutodettagliCalcola`, `:17109-17285`);
- alla conferma si apre la griglia `Dettaglio` con le colonne "Cod.Prod. | Unità locale | Num.Formulario | Data formul. | Peso | Litri | N.Colli | Contratto | …" (`Dettaglio.cs:377`).

Dalla guida (`Definizione_causali_movimento.htm`): "CAUSALE MASTER configurata ai soli fini di fatturazione (no MUD e no REGISTRO). CAUSALE DETTAGLI: configurata ai soli fini di stampa registro e dichiarazione MUD. Questa funzione viene utilizzata da coloro che effettuano micro raccolta e registrano in un'unica operazione i singoli formulari."

**Blocchi. Osservato** (`04a.cs:17134-17170`):

- "Causale di master deve essere configurata MUD = NO, GIACENZE = N0";
- "La causale dei dettagli non e' configurata allo stesso modo della causale di master" (TIP/OPE/CURA);
- "La causale dei dettagli non va esclusa dal MUD e/o GIACENZE";
- trasportatore e smaltitore del dettaglio coincidenti con quelli del master.

**Quantità. Osservato** (`Dettaglio.CreaFlex`, `Dettaglio.cs:1090-1182`):

- ogni riga ha il proprio peso e i propri litri, inseriti dall'utente;
- se la somma dei dettagli differisce dal netto del master compare un avviso: "Il peso totale dei dettagli e' Kg … Nel master e' invece indicato Kg … Il peso netto nel master sara' posto pari a Kg … Prosegue lo stesso?". Lo stesso avviso esiste per i litri;
- confermando, il netto (e il lordo) del master **diventa la somma** dei dettagli (`04a.cs:17222-17270`).

**Righe scritte. Osservato:**

- **Master**: la riga principale, con la causale master (no MUD, no giacenza), `MAG2 = "0"` (`04a.cs:20884-20887`), il `FORMU` del documento e il netto totale. Serve alla fattura.
- **Dettagli** (`AutoStridettagli`, `04a.cs:24010-24205`), uno per riga della griglia:
  - `CAUS` = causale di dettaglio;
  - `PROD` = produttore della riga;
  - **`FORMU`/`DATD` = numero e data del formulario della riga** (`array2[2]`, `array2[3]`, `:24041-24050`);
  - `NETTO`/`VOLU` della riga;
  - registri `REG1..4` presi dalla posizione della causale di dettaglio;
  - cliente/contratto della riga se la causale di dettaglio fattura;
  - `LEGAME` verso il master.

**Unicità nella griglia. Osservato:**

- senza SISTRI il numero di formulario della riga **non è obbligatorio**, solo il peso ("Inserire il peso o cancellare tutti i dati della riga");
- con SISTRI sono obbligatori numero e data ("Inserire nr.formulario o cancellare tutti i dati della riga", `Dettaglio.cs:803-865`);
- lo stesso produttore su due righe dà solo un avviso: "Il produttore indicato e' gia' stato inserito in altra riga della tabella — Prosegue lo stesso?" (`Dettaglio.cs:863`). Nella variante con CER per riga l'avviso è "Produttore+CER indicato e' gia' stato inserito in altra riga della tabella" (`:896`);
- **non c'è controllo** su un numero di formulario ripetuto fra le righe, né contro l'archivio: `giaesisteformu` guarda solo il `FORMU` del master.

**Risultato.** Nel registro e nel MUD c'è **un movimento per FIR di dettaglio**: di norma **FIR diversi**, uno per conferente. Il master è una riga di sola fatturazione, con il `FORMU` del documento. Qui il caso "stesso FIR, stesso verso" nasce solo:

- dal master rispetto al dettaglio che porta lo stesso numero, se l'utente lo ripete;
- da due righe della griglia con lo stesso numero, cosa che il programma non impedisce.

Questo **corregge in parte** C-W-03, che descriveva la microraccolta come "un FIR, più conferenti".

### 1.3 Spurghi multiluogo, art. 230 c. 5 (tipo spurgo in AVANZ byte 52)

**Profilo.** Lo spurghista che registra come produttore. Nel master il produttore diventa il trasportatore: `PROD.Text = TRAS.Text` (`04a.cs:19522-19529`). **Osservato.** **Inferenza** (alta): è la regola dell'art. 230 c. 5, per cui chi esegue la manutenzione è considerato produttore.

**Trigger. Osservato** (`calcolaIsmaster`, `04a.cs:19550-19582`, chiamato dalla ricopia `:19508-19533`). Alla ricopia di un FIR con causale spurgo:

1. si contano in `formulari` (`c7 <> 'A'`) i record con **lo stesso `FORMU`**. Uno solo → "Formulario con un singolo luogo di raccolta", movimento normale;
2. se sono più d'uno e in `movimenti` non esiste ancora un master (`qcat > 'Q' and substring(qcat,2,1) = '2' and formu = …`), compare il messaggio: "In archivio formulari sono presenti piu' documenti con il numero formulario … Non risulta ancora registrato il documento MASTER con il TOTALE netto a destino. Registrarlo adesso. Solo successivamente si potranno registrare i documenti di dettaglio". La maschera passa in modo **MASTER** (`ListaSPURGHI = 1`);
3. se il master esiste già, la maschera passa in modo **DETTAGLIO** (`ListaSPURGHI = 2`).

**Righe scritte. Osservato:**

- **Master**:
  - `QCAT = S2`, `T2` o `U2` (`04a.cs:20905-20921`);
  - `PROD = TRAS`, cliente azzerato, `C8` (riferimento a un record di formulario) vuoto;
  - pesi azzerati, perché l'utente inserisce il **netto totale a destino**;
  - `Cancellaricopiato` **non** viene chiamato (`04a.cs:14063-14065`): i record del formulario restano disponibili per i dettagli.
- **Dettaglio**, uno per record di formulario con quel numero:
  - `QCAT = Z3`;
  - `MAG2 = "0"`, cioè nessuna giacenza (`:20888-20891`);
  - **`REG1..REG4` vuoti** (`:20994-21001`), quindi il dettaglio non va su nessun registro;
  - `C8` punta al proprio record di formulario;
  - dopo il salvataggio il record del formulario viene marcato `C7 = 'R'`.
- Il master non si cancella finché ha dettagli: "Non e' possibile eliminare questo movimento perche' ha dettagli registrati" (`mastercondettagli`, `04a.cs:10606-10609`, `:19536-19548`).
- Il controllo dei doppi **salta del tutto** per le causali spurgo (`giaesisteformu`, `04a.cs:32269-32272`).

**Ripartizione delle quantità.** Il master ha il totale a destino. Nel calcolo dei massimi autorizzati il peso del dettaglio vale 0 (`calcolamassimi`, `04a.cs:56086-56089`). **Inferenza** (media): il dettaglio porta la quantità del suo luogo di raccolta, ma solo a fini informativi e di fattura. Non è verificato che la quantità del dettaglio non resti vuota.

**Risultato.** Un **numero di FIR** con N record di formulario (uno per luogo) produce 1 master + N dettagli, **tutti con lo stesso `FORMU`**. Solo il master va a registro e a giacenza.

### 1.4 Altri automatismi che replicano il FIR (fuori dal nucleo della domanda)

- **Carichi automatici dopo trattamento** (AVANZ byte 8-9, solo TIP+OPE 21 o 27). **Osservato:** `AutoCarMovimenti` scrive un carico per ogni riga della scheda tecnica e ricopia `FORMU`/`DATD`/`NUMD` del documento **solo se il produttore è di terzi** (`PROD > '9'`, `04a.cs:23160-23215`). Il FIR resta lo stesso; i carichi sono dello stesso verso fra loro e si distinguono per CER e riferimento. **Inferenza** (media): una riga per rifiuto in uscita dalla scheda.
- **Carico automatico dei rifiuti prodotti** (AVANZ byte 1-2). Lo scarico genera un carico identico con `*` nel riferimento (movimenti.md §3.2). È di verso **opposto**.
- **`($$PARTENZA$$)`**. **Osservato:** dopo il salvataggio si scrive un secondo movimento con causale + 1, `REG1 = REG2` e lo stesso `FORMU` (`04a.cs:21438-21448`). In modifica compare solo l'avviso "NON SI DIMENTICHI DI MODIFICARE manualmente ANCHE il movimento di RICARICO!". **Inferenza** (media): partenza e ricarico su due registri, quindi verso o registro diversi. Non è stato verificato.
- **Trasporto e intermediazione (OPER 30, 40)**: un solo movimento vale come carico e scarico insieme (movimenti.md §2.4).

### Tabella riassuntiva

| Caso | Profilo | Trigger | Stesso FORMU? | Cosa distingue le righe | Quantità | Legame | Va a registro/MUD |
|---|---|---|---|---|---|---|---|
| Produttori percentuali | impianto, trasportatore, intermediario (20/27/30/40/52) | AVANZ 6-7 + scheda del `PROD` | **sì, tutte** | produttore | % del netto, kg interi, resto alla prima quota | `LEGAME` → prima riga (totale o prima quota) | le quote sì; il totale no (causale no MUD/giacenze) |
| Master/dettagli (microraccolta) | impianto, trasportatore, intermediario (20/27/30/40) | AVANZ 4-5 | no: un FIR per dettaglio (numero libero, anche vuoto) | FIR e produttore della riga | per riga; il master = somma | `LEGAME` → master | dettagli sì; master no |
| Spurghi multiluogo | spurghista-produttore (art. 230 c. 5) | causale spurgo + più record formulari con lo stesso numero | **sì, tutte** | `QCAT` x2/Z3 e record del formulario (`C8`) | master = totale a destino; dettagli informativi | `FORMU` + `QCAT`; nessun `LEGAME` (registrazioni separate) | solo il master |
| Carichi dopo trattamento | impianto (21/27) | AVANZ 8-9 + scheda tecnica | sì, se il produttore è di terzi | CER in uscita | da scheda | `LEGAME` → scarico | sì |

---

## 2. Come WinWaste rileva o gestisce i doppi

1. **Avviso alla digitazione e al salvataggio, mai blocco.** **Osservato:** `giaesisteformu`, `04a.cs:32265-32390`, chiamato all'uscita dai campi numero e data (`:11204`, `:11258`) e alla conferma F10 (`:12832`).
   - **Movimenti (`progd = W`).** Cerca `select top 9 datd,caus,dtuk from movimenti where dtuk > '0' and replace(formu,' ','') = <numero senza spazi>`, nell'anno corrente e nel precedente. Se **tutti** i soggetti sono propri (`PROD`, `TRAS`, `SMAL`, `INTE` < '9'), filtra anche `and caus = <causale>`. In modifica esclude il movimento stesso. La data del FIR, il CER e la quantità **non** fanno parte della chiave.
   - **Messaggio** (titolo "ATTENZIONE", pulsante predefinito **No**): "Consultando gli archivi movimenti <anno> e anno scorso / Il formulario <n> risulta gia' registrato: / Data formul.: … Caus.: … Data reg.: … [e altri....] / Si desidera continuare lo stesso ?". "No" annulla il salvataggio, "Sì" prosegue.
   - **Dopo un "Sì"** la stessa query viene memorizzata in `ultimoformucontrollato` e non si ripete per quel numero fino al reset della maschera (`:5997`, `:32667`).
   - **Formulari (`progd = B`).** Stesso controllo su `formulari` (`c7 <> 'A'`), con il messaggio "Il formulario … risulta gia' presente".
   - **Esclusioni:** le causali spurgo (nessun controllo) e le righe generate (dettagli, quote, carichi automatici): `FORMU` si controlla solo sulla maschera.
2. **Nessun vincolo nel database e nessuna chiave di idempotenza.** **Osservato:** `ScriviMovimentiPriv` fa un INSERT e assegna `COD = MAX(COD)+1`. L'unica serializzazione è il lock su `reteMov.tmp`. Il FIR ricopiato viene marcato `C7 = 'R'` (`Cancellaricopiato`, `04a.cs:14403-14460`). **Non è stato trovato** un filtro che impedisca di ricopiare di nuovo un FIR già `R`: la ricerca per "incolla" usa `c7 = ''` (formulari.md §3.3), il percorso F6 non è stato verificato.
3. **Doppio clic o nuovo tentativo.** **Osservato:**
   - dopo un salvataggio riuscito la maschera torna vuota (`dacapo(10)`, `04a.cs:14104`), e una seconda pressione di F10 non trova più i dati;
   - se il server risponde "Impossibile registrare il documento. Riprovare tra qualche istante" (lock non ottenuto, `WWREM.cs:10310`), non è stato scritto nulla;
   - non c'è protezione per un errore **dopo** la scrittura: la registrazione rifatta passa solo dall'avviso del punto 1.

   **Inferenza** (alta): in WinWaste la protezione dai doppi è l'avviso più l'operatore.
4. **Controllo a posteriori prima della fattura.** **Osservato:** la guida descrive "Cerca formulari duplicati" (fatturazione automatica, F12): "è possibile controllare prima di fare la fatturazione se sono stati registrati doppi alcuni formulari", per periodo e causali (`Cerca_Formulari_Duplicati.htm`). La query non è stata decompilata.
5. **Pulizia manuale dei doppi di trasporto e intermediazione.** **Osservato:** `EliminaMovDuplicati` (`EMD.cs:202-320`):
   - seleziona i movimenti con produttore e destinatario propri e trasportatore o intermediario terzo, con `formu <> ''`, ordinati per `formu, datd, inte, cod`;
   - marca come doppio ogni riga con **stesso `formu` e stessa `datd`** della precedente: tiene la prima, le altre si colorano di rosso;
   - dopo la conferma "Questa funzione cancella i movimenti indicati in rosso. Continuare?" le annulla con `UPDATE … dtuk = '$$'+…, id = 'ELIM<gg-mm>'`.

   La chiave è (FIR, data FIR); CER e quantità non contano. **Inferenza** (media): poiché `inte` non è nella chiave, un movimento di trasporto e uno di intermediazione dello stesso FIR possono essere eliminati come doppi l'uno dell'altro.
6. **MUD.** **Osservato** (mud.md §4.3): le quantità sono `sum(kgnum)` per CER e stato fisico, filtrate per causale e ruolo, senza deduplicazione per `formu`. Il master e il totale non contano perché la loro causale ha MUD = NO. **Inferenza** (alta): due righe identiche dello stesso FIR si sommano due volte. WinWaste non ha un equivalente della regola "doppi identici contati una volta" del piano A.

---

## 3. Osservazioni e inferenze in sintesi

**Osservato**

- Produttori percentuali: n movimenti dello stesso verso, con lo stesso numero di FIR e lo stesso CER, distinti solo dal produttore. In più può esserci un movimento totale fuori da MUD e giacenza.
- Microraccolta: master di sola fatturazione + un dettaglio per FIR di conferente, ciascuno con il proprio numero di FIR.
- Spurghi multiluogo: 1 master (registro e giacenza) + N dettagli fuori registro, tutti con lo stesso numero di FIR.
- I doppi del numero FIR sono solo un avviso superabile, con chiave `formu` (+ `caus` se tutti i soggetti sono propri). Non c'è vincolo nel database né idempotenza. Esistono una ricerca dei doppi prima della fattura e un'utility che annulla i doppi di trasporto e intermediazione per (formu, datd).
- Master e dettagli non si scrivono in modo atomico; il legame è `LEGAME` = `C<cod del primo>`.

**Inferenza**

- (alta) Nessuno di questi automatismi riguarda il registro del **produttore iniziale**. Fa eccezione lo spurghista, che però registra a registro un solo movimento, il master. Per il segmento produttori, "un FIR, un movimento per verso" è quindi coerente con WinWaste.
- (alta) Per il segmento gestori (impianto, trasportatore, intermediario) WinWaste genera di proposito più movimenti dello stesso verso con lo stesso numero di FIR (percentuali), e lo stesso vale per gli spurghi fuori registro.
- (media) Nei dettagli percentuali `C8` è vuoto, quindi in WinWaste il "collegamento al record FIR" sta solo sulla riga principale. Il collegamento delle quote al FIR passa per il numero.

**Incognite**

- Se la ricopia F6 esclude i FIR già `C7 = 'R'`: il percorso non è stato decompilato.
- La query di "Cerca formulari duplicati" (WWNET07) e se considera CER e quantità.
- Il significato di TIP+OPE 52 e il verso del ricarico `($$PARTENZA$$)`.
- Se la somma delle percentuali deve essere 100 (`WWNET05.ProdutPerc` non è stato decompilato).
- La quantità effettiva scritta sui dettagli spurgo e il loro trattamento nel MUD (`QCAT` `Z3`).
- Cosa succede a un dettaglio quando si modifica o si cancella il master in microraccolta e nelle percentuali. Per gli spurghi la cancellazione è bloccata; per gli altri casi non è stato trovato un blocco.

---

## 4. Raccomandazione di design per rifiuti

Obiettivo: tenere il comportamento sicuro ai nuovi tentativi del piano C per i produttori, cioè stessa ricopia → `giaRegistrato`, dati diversi → `FirGiaRegistratoError`. Allo stesso tempo, ammettere i casi legittimi dei gestori **senza** tornare al solo avviso di WinWaste, che produce i doppi che poi WinWaste deve ripulire con `EliminaMovDuplicati`.

1. **Discriminante nella chiave unica, al posto della sola terna.**
   - Aggiungere a `WasteMovement` la colonna `ricopiaChiave String @default("") @map("ricopia_chiave")`, NOT NULL.
   - Sostituire `@@unique([tenantId, firIdRicopia, type])` con `@@unique([tenantId, firIdRicopia, type, ricopiaChiave])`.
   - Valori:
     - `''` per la ricopia ordinaria;
     - `prod:<unitaLocaleId>` per una quota per produttore (caso percentuali);
     - `cer:<cer>` per i carichi generati da trattamento;
     - `dett:<n>` per un dettaglio senza altra chiave naturale.
   - La migration è additiva: tutte le righe esistenti ricevono `''`, che è già unico grazie all'indice attuale; le righe storiche (`firIdRicopia` NULL) non cambiano.
   - Facoltativo: una colonna `ricopiaTipo` (enum `ORDINARIA | QUOTA_PRODUTTORE | DETTAGLIO | TOTALE`) per la UI e per il MUD, derivata dalla causale o dal comando e mai dall'input libero.
2. **Use case.**
   - La ricerca idempotente diventa `findMany({ tenantId, firId, type, ricopiaChiave })`. `stessiDatiRicopia` → `giaRegistrato`; dati diversi → `FirGiaRegistratoError`, **solo dentro la stessa chiave**.
   - Per il produttore la chiave è sempre `''`, quindi il comportamento del piano C non cambia.
   - La chiave non la sceglie l'utente: la impone il flusso (quote o dettagli generati da una scheda, come in WinWaste). Altrimenti diventa un modo per aggirare il controllo.
   - Master e dettagli si scrivono in **una sola transazione**, a differenza di WinWaste. Il legame sta in `movimentoPadreId` (FK), non in un `LEGAME` testuale.
   - Per il nuovo tentativo di un'intera registrazione multipla: una `Idempotency-Key` del client salvata sul movimento padre (unique `(tenantId, idempotencyKey)`). Se si ripete restituisce l'intero gruppo già scritto.
3. **Stesso numero FIR su un FIR diverso** (spurghi multiluogo, numeri ripetuti fra FIR). Sono `firId` distinti, quindi non toccano l'indice. Si tiene un **avviso** come quello di WinWaste ("Il formulario … risulta già registrato… continuare?"), con chiave numero normalizzato + anno e, se tutti i soggetti sono propri, la causale.
4. **Aggregazione MUD del piano A (DG-29).**
   - Raggruppare per `(firId, type, ricopiaChiave)` e non per `(firId, type)`: due quote con la stessa quantità ma produttori diversi non sono doppi e devono contare entrambe.
   - Le righe `ricopiaTipo = TOTALE` (o un flag `escludiDaMud`) vanno escluse, come fa WinWaste con la causale "MUD = NO", così il totale non si somma alle quote.
   - "Doppi identici contati una volta" resta solo per le righe storiche con `firIdRicopia` NULL, o con la stessa chiave.
   - `FIR_SCARICATO_PIU_VOLTE` va calcolato per chiave, non per FIR.
5. **Segmento.** Finché la Fase 0 serve solo i produttori basta la colonna con default `''`: costa una migration additiva ora invece di una che tolga l'indice dopo. Gli automatismi (quote percentuali, dettagli) si aggiungono quando si sceglie il segmento gestori (§6.1).
