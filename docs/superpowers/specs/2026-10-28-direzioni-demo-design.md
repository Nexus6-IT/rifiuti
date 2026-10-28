# Direzioni di design per la demo: Studio, Bilancio, Modulo, Piazzale

Data: 2026-10-28. Stato: da approvare.
Origine: demo "WasteFlow, cinque direzioni" del 2026-10-21. La direzione Registro (tema chiaro/scuro) e il contrassegno dell'azienda attiva sono in produzione dal 2026-10-28 (PR #29). Questo documento copre le quattro direzioni rimaste.
Rettifiche normative e di dominio: sessione winwaste, 2026-10-28, riportate qui con la fonte indicata da lei. Ogni articolo citato va riverificato sul testo vigente prima di scriverlo nel codice.

## Perché

Le quattro direzioni servono a una **demo commerciale** davanti a un potenziale cliente il cui profilo non è ancora deciso: consulente ambientale, azienda produttrice, trasportatore o impianto. La demo deve reggere per tutti e tre. Conta che il flusso sia **vero** (dati calcolati dal sistema, azioni che fanno davvero quello che dicono) e convincente sui dati di esempio, più che coprire ogni caso limite. In produzione non ci sono utenti reali.

## Obiettivi

1. **Studio**: il consulente vede in una vista le scadenze di tutte le aziende che segue e passa all'azienda giusta con un clic.
2. **Bilancio**: il titolare con ruolo sola lettura capisce in un minuto quanto produce, quanto va a recupero, se il MUD è a posto.
3. **Modulo**: chi compila un FIR lo fa su un form impaginato come il formulario ufficiale, con il campo mancante segnato dove andrebbe scritto.
4. **Piazzale**: l'addetto all'impianto di destino conferma peso ed esito del conferimento da un tablet, con pulsanti grandi e una sola decisione per schermata.
5. **Tenant demo**: uno script crea un consulente con 4-5 aziende e circa 9 mesi di attività verosimile, ripristinabile prima di ogni demo.

## Non obiettivi

- La coda offline del Piazzale (salvataggio senza rete e invio al ritorno). In questa fase l'offline è solo dichiarato.
- La firma qualificata locale. Il provider QES è uno stub e il provider sandbox ECDSA non ha valore legale: nessuna schermata lo presenta come firma valida.
- Sostituire le schermate esistenti: il form FIR attuale e la dashboard consulente restano.
- Una seconda formula per numeri che il sistema calcola già altrove (MUD, deposito temporaneo, scostamento del peso).

## Anti-obiettivi (falliscono la demo anche se "funzionano")

- Una scadenza normativa sbagliata o inventata davanti a un consulente.
- Un numero del Bilancio diverso da quello del MUD per gli stessi movimenti.
- Un PDF scambiabile per un documento con valore dichiarativo.
- Un movimento registrato nell'azienda sbagliata a partire da Studio.
- Dati della demo scritti a mano nel seed invece che calcolati dai movimenti (i numeri grandi che mentono).
- Dati reali di altre aziende nel tenant demo.

## Vincoli trasversali

- **Isolamento per tenant e per azienda** in ogni query e servizio nuovo (regola PO). Le letture su più aziende del consulente passano dal client di sistema con il contesto di ogni azienda, come le rotte consulente esistenti (RLS pezzo 2b).
- **Una sola fonte per ogni regola**: i servizi nuovi di Studio sono gli stessi che alimentano il cruscotto della singola azienda; il Bilancio usa la logica del MUD; il Piazzale usa `calcolaScostamentoPeso`.
- **Branch aperti da non toccare** finché non sono in master: F2-6 deposito (`feat/fase2-6-deposito`), F2-8 MUD per sede (`feat/fase2-8-mud-sede`), F2-10 controparti (`feat/fase2-10-controparti`). Si parte con ciò che è libero e ci si aggancia dopo il loro merge (decisione di Graziano).
- Stack esistente: Angular 17 standalone + PrimeNG 17 con i token del tema Registro; NestJS + Prisma. Nessuna libreria UI nuova.
- Termini tecnici non tradotti, testi dell'interfaccia in italiano, nessuna dicitura "4ª copia".

## Orchestrazione

Opus coordina e rivede, gli implementatori sono agenti Sonnet (decisione di Graziano). Nessuna patch entra senza revisione del coordinatore contro il codice e i test eseguiti. Le quattro direzioni procedono in parallelo, ciascuna nel proprio branch e worktree.

---

## 1. Studio

### Cosa vede il consulente
Una scheda "Scadenze" in testa alla dashboard consulente esistente (`/permissions/consultant-dashboard`). Elenco unico delle scadenze di tutte le aziende che segue, raggruppato in **Scaduto**, **Oggi**, **Domani**, **Questa settimana**, **Più avanti** (fino a 30 giorni). Ogni riga:
- contrassegno dell'azienda (iniziali e colore, componente già esistente);
- cosa scade, in italiano, con il termine e la fonte normativa in un tooltip o in una riga secondaria;
- gravità (critico, avviso, informativo), con lo stesso vocabolario di `VoceAttenzione`;
- un'azione che **cambia azienda attiva e apre la pagina giusta**, con conferma visibile dell'azienda dopo il cambio.

Filtri: per azienda e per tipo di scadenza. Stato vuoto esplicito ("nessuna scadenza nei prossimi 30 giorni").

### Fonti delle scadenze

**Già calcolate per azienda, da aggregare** (`application/dashboard/raccogli-attenzione.use-case.ts`): certificato RENTRI, autorizzazione destinatario, iscrizione Albo trasportatore, scorta vidimata.

**Nuove, calcolate nel backend dai dati veri:**

a) **Registro di carico e scarico, annotazione in ritardo.** Art. 190 c. 1 D.Lgs. 152/2006 (post D.Lgs. 116/2020). Il termine dipende dal ruolo dell'azienda:
   - produttore iniziale: 10 giorni lavorativi dalla produzione e dallo scarico;
   - raccolta e trasporto: 10 giorni lavorativi dalla consegna all'impianto di destino;
   - commerciante e intermediario: 10 giorni lavorativi dalla consegna all'impianto di destino;
   - impianto di recupero o smaltimento: 2 giorni lavorativi dalla presa in carico.

   Il sistema non vede i movimenti "non annotati". Il segnale calcolabile è: **FIR del mio tenant senza il movimento corrispondente nel mio registro**, collegato tramite `firId` sul movimento:
   - se l'azienda è il produttore del FIR, manca lo SCARICO;
   - se è il destinatario e il FIR è consegnato o accettato, manca il CARICO, che per la regola C-W-01 porta il peso verificato.

   Il termine si conta dall'evento giusto per il ruolo. "L'azienda è il produttore o il destinatario" si decide confrontando P.IVA e CF dell'anagrafica con `Tenant.partitaIva` e `Tenant.codiceFiscale`, con la normalizzazione già usata dal MUD (`codiciAzienda()` in `mud-integrazioni.service.ts`, regola A-W-13). Non si scrive un secondo confronto.

   **Il ruolo giuridico dell'azienda (l'attività del registro) oggi non esiste nel modello** e nessun branch lo introduce. Finché manca:
   - come scadenza si mostra **solo il termine del produttore** (10 giorni lavorativi), solo per i FIR in cui l'azienda è il produttore;
   - per gli altri casi si mostra una riga "termine da configurare in base all'attività", senza inventarne uno.

   Dedurre il ruolo FIR per FIR va bene come controllo di coerenza, non come fonte del termine di legge.

   **Decisione di Graziano: l'attività sta sulla CAUSALE**, come in WinWaste (tipo di attività per causale: produzione, gestione impianto, trasporto, intermediazione; fonte `C:\Progetti\winwaste\docs\movimenti.md` §2.4 e §3.1). Diventerà una colonna "attività" nel catalogo causali di F2-5 e nelle causali aziendali, con un pezzo dedicato **che non fa parte di questo lavoro**: il catalogo è un'area condivisa. Quando sarà in master, il termine si ricaverà dalla causale del movimento: 10 giorni lavorativi dall'evento del ruolo, oppure 2 per la gestione dell'impianto. Studio è progettato perché l'aggancio richieda solo di cambiare la sorgente del termine.

   Serve un **calendario dei giorni lavorativi** con le festività nazionali italiane, Pasquetta compresa. Oggi esiste solo un'approssimazione in un commento (`waste-movement.entity.ts:41`, "10 gg lavorativi ≈ 14 gg calendario"). Va scritta come funzione pura con i suoi test. Le festività patronali sono escluse, e va dichiarato.

b) **FIR senza riscontro.** Art. 188 D.Lgs. 152/2006 (comma da verificare): il produttore deve avere il riscontro (copia controfirmata o chiusura) entro 3 mesi dal conferimento al trasportatore; in mancanza deve comunicarlo all'ente. Per i FIR digitali RENTRI non si conosce con certezza un termine diverso: si usa **3 mesi dal conferimento** come soglia prudente, dichiarata come regola generale, con un preavviso. Non si inventa un termine RENTRI. Dati: stato del FIR (consegnato o chiuso) e `rentriStatoFormulario`. La scadenza scatenata è l'adempimento "comunicazione all'ente", non solo un avviso.

c) **Deposito temporaneo.** Art. 185-bis c. 2 lett. b. **Non si calcola in Studio.** Lo calcola F2-6 (FIFO dal carico più vecchio ancora in giacenza, criterio temporale di 3 mesi di calendario oppure criterio quantitativo con limite di un anno, soglie per azienda e registro, avvisi PREAVVISO/SUPERATO). Studio consuma il servizio di F2-6 dopo il suo merge. Fino ad allora la riga del deposito non compare: non c'è un'implementazione provvisoria.

d) **Altre scadenze annuali** che un consulente controlla:
   - MUD: 30 aprile (L. 70/1994), data configurabile per le proroghe; lo stato viene da `MUDReport`;
   - RENTRI: diritto di segreteria e contributo annuale (DM 59/2023), data da verificare per l'anno corrente e configurabile;
   - ADR: relazione annuale del consulente per la sicurezza entro il 28 febbraio, solo per le aziende soggette ad ADR. Il flag non esiste: va aggiunto sull'azienda (con eccezione per sede se servirà), con una migration additiva. Finché non c'è, la scadenza non compare;
   - autorizzazioni proprie dell'azienda gestore (artt. 208, 214-216, AUA): solo se l'anagrafica dell'azienda ha già i dati; altrimenti è un seguito.

   La caratterizzazione dei rifiuti "a specchio" non entra: è buona prassi, non un termine di legge.

### Struttura
- Un servizio di dominio per ogni regola nuova, puro e testato, usato **sia** dal cruscotto della singola azienda (`dashboard/attenzione`) **sia** da un nuovo endpoint consulente che aggrega le aziende associate. Così i numeri coincidono.
- Ogni scadenza porta `fonte` (articolo) e `dataTermine`, così il raggruppamento per giorno si fa nel frontend da un solo campo.

### Lasciato all'implementatore
Nome e forma dell'endpoint, paginazione, ordinamento dentro un gruppo.

---

## 2. Bilancio

### Dove
Per chi ha il **ruolo sola lettura** (`UserRole.VIEWER` nell'azienda selezionata) è il cruscotto, cioè la rotta di default dopo il login. Questo vale solo se l'utente non è un consulente con aziende associate: un consulente atterra sempre sulla sua dashboard con Studio, qualunque sia il suo ruolo nelle aziende clienti. Per gli altri ruoli è una pagina raggiungibile dal menu. Periodo: anno in corso, fino a oggi, con la possibilità di scegliere l'anno.

### Cosa mostra
- **Tonnellate prodotte** nel periodo, confrontate con lo stesso periodo dell'anno precedente.
- **Recupero (R) contro smaltimento (D)** come barra a due colori, con "di cui in operazioni preliminari (R13/D15)" e una quota "da verificare" per i pesi con operazione dedotta o mancante.
- **Tre rifiuti principali** per peso: EER, descrizione, tonnellate.
- **Quota di rifiuti pericolosi** sul totale.
- **Stato del MUD**: anno, stato (`MUDReport`: DRAFT, REVIEWING, SUBMITTED, ARCHIVED), scadenza configurabile. Il blocco è disegnato per avere più righe, una per sede, in vista di F2-8.
- **Mesi con movimenti**: mesi con almeno un movimento vigente. Non si scrive "mesi completi", perché un mese senza produzione è legittimo.
- **Segnali aperti**, solo come conteggi con un link: ritardi del registro e FIR senza riscontro (servizi di Studio), avvisi del deposito (servizio di F2-6, dopo il merge).
- **Giacenza a fine periodo**, dai saldi del registro.

### Regole di calcolo: la stessa logica del MUD, mai una seconda formula
- **Prodotto** = CARICHI **vigenti** del registro la cui causale ha ruolo MUD `PRODOTTO`. Il ruolo si legge dal catalogo causali di F2-5 (`application/registro/causali/catalogo-causali.repository.ts`, `classificaMovimento` in `application/mud/aggregazione/mud-regole.ts`). La vigenza si filtra con `domain/waste-movement/vigenza.ts`. L'unità è kg (`convertiInKg`); litri e m³ restano fuori dal totale e sono segnalati a parte.
- **Il peso verificato a destino non entra nel prodotto del produttore** (regola C-W-01). Le giacenze iniziali di F2-2 non sono prodotto.
- **R/D** = SCARICHI vigenti con ruolo `AVVIATO`, con la precedenza di `recuperoOSmaltimento` del MUD: codice operazione del movimento, poi operazione della causale, poi codice operazione del FIR, poi deduzione dal tipo di operazione (marcata come "da verificare").
- **Funzione condivisa**: i totali per anno, EER e ruolo vengono da una funzione estratta da `MudAggregazioneService` e usata sia dal MUD sia dal Bilancio, con un test che fissa l'uguaglianza dei totali "prodotto". L'estrazione la fa F2-8, che sta già modificando quel file (coordinato con winwaste). Fino al merge di F2-8, il backend del Bilancio legge soltanto e non modifica `mud-aggregazione.service.ts`.
- `esg/report`: va verificato da dove prende i numeri. Se ha una sua formula si allinea al MUD; non è una fonte.
- **Costi dai contratti**: entrano solo se il modulo contratti ha importi affidabili per periodo. Oggi c'è un `basePrice` facoltativo: in questa fase non si mostrano costi. È un seguito.

### Dati incompleti
Ogni blocco dichiara le sue lacune: unità non convertibili, pesi con operazione da verificare, mesi senza movimenti. Un totale non deve mai sembrare completo quando non lo è.

### PDF
Esportazione dalla pagina, solo per l'azienda selezionata e con lo stesso controllo di ruolo.
- In testata: **"Documento informativo interno. NON sostituisce il MUD né il registro di carico e scarico."**, con data e ora di generazione e periodo coperto.
- Nessun logo o intestazione di enti pubblici; nessuna formula come "dichiarazione" o "attestazione".
- La fonte di ogni numero ("dal registro di carico e scarico, movimenti al gg/mm/aaaa") e le stesse avvertenze di incompletezza mostrate a schermo.
- Nessun codice fiscale di persone fisiche.

Generazione con PDFKit come gli altri PDF del backend, nella risposta HTTP, senza code né cache.

### Sequenza
1. Subito: la pagina, la funzione di calcolo provvisoria **solo in lettura** sopra le stesse regole del MUD (`classificaMovimento`, vigenza, `convertiInKg`, `recuperoOSmaltimento`, importate e non copiate), il blocco MUD, il PDF.
2. Dopo F2-8: si passa alla funzione condivisa e si aggiunge il test di uguaglianza con il MUD.
3. Dopo F2-6: il conteggio degli avvisi del deposito.

---

## 3. Modulo

### Cos'è
Una seconda impaginazione del **form di creazione e modifica della bozza** del FIR, attivabile dall'utente: un interruttore "Vista modulo" nel form, ricordato per utente. Le sezioni sono numerate e ordinate come il **formulario del DM 4 aprile 2023 n. 59**, non come il DM 145/1998. I dati inseriti sono in blu, come la penna sulla copia; il campo obbligatorio mancante è bordato e annotato in rosso **nel punto in cui andrebbe scritto**. In modalità scura il modulo diventa una tavola da cianografia, coi token del tema.

### Fonte dell'impaginazione
Il modello ufficiale va preso dal sito RENTRI (sezione modelli del formulario) e da lì vanno numerate le sezioni. La corrispondenza campo per campo con il contratto RENTRI esiste già in `docs/audits/rentri-lacune-modello-fir-2026-09-10.md`. Nel repo non c'è l'elenco ufficiale delle sezioni: il primo passo dell'implementatore è ricavarlo e scriverlo in questo documento. Finché non è fatto, nessuna schermata dice "conforme al modello ufficiale".

### Campi mancanti: una sola lista, nel backend
Oggi i controlli sono sparsi in tre punti:
- creazione: DTO e use case;
- emissione: solo lo stato e la firma;
- trasmissione RENTRI: le regole vere, in `application/rentri/mappatura/*`.

In più il frontend ne ha una copia parziale (`fir-list.component.ts`, `validateFir`). Un FIR oggi si emette con dati RENTRI incompleti e l'errore emerge solo alla trasmissione.

Per questo il Modulo richiede un **endpoint di backend "prerequisiti di emissione"**: esegue la mappatura RENTRI in sola validazione e restituisce l'elenco dei campi mancanti o non traducibili, ciascuno con il suo codice e il percorso del campo. Il Modulo colora i campi a partire da quell'elenco. Nel frontend non si scrive una seconda lista.

**Decisione di Graziano: blocco "come WinWaste".** L'emissione si blocca sui prerequisiti solo per le aziende o i FIR che trasmettono a RENTRI (modalità di legame attiva o certificato presente). I FIR locali restano liberi, ma il Modulo segna in rosso i loro campi lo stesso.

**L'endpoint e il blocco non fanno parte di questo lavoro.** Sono un pezzo backend dedicato, messo in coda dalla sessione winwaste dopo il merge di F2-10, che modifica `costruisci-payload-rentri.ts` e `mappa-parti.ts`. Quel pezzo deve anche adeguare i test e2e che emettono FIR RENTRI minimi (`e2e/tests/fir*` e gli helper).

Il Modulo è costruito per consumare l'endpoint appena esiste. Fino ad allora colora soltanto i controlli di creazione del DTO e lo dichiara nell'interfaccia ("controllo parziale: i requisiti RENTRI sono verificati all'emissione"). Il seed demo produce comunque FIR completi.

### Vincoli da F2-4/F2-7 (in master)
- Si modifica solo una bozza con `modificabile` true; il motivo arriva in `motivoNonModificabile`, con i testi in `fir-form.ts`.
- Dopo l'emissione il modulo è in sola lettura.
- Il PUT `/fir/:id` è una sostituzione completa con `versione` e `unitaMisura` (kg, litri, t), senza `rifiuto.descrizione`, `categoria` o `tipoOperazione`.
- 409 FIR_MODIFICATO_NEL_FRATTEMPO: si ricarica e si avvisa. 409 FIR_NON_MODIFICABILE: si chiude.
- Le tratte senza `trasportatoreId` non si aprono.
- Riusare `formDaFir` e il resto di `features/fir/fir-form.ts`: il Modulo cambia l'impaginazione, non il modello del form.

### Dipendenza da F2-10
La scelta delle parti (produttore, trasportatore, destinatario, tratte; oggi in `fir-list.component.ts`) cambia con F2-10, che aggiunge la sede. Nel Modulo la selezione delle parti sta in un **componente isolato** che riusa le tendine attuali, da adattare dopo il merge di F2-10. Il resto del Modulo parte subito.

---

## 4. Piazzale

### Cos'è
Una modalità per tablet, rotta dedicata `/piazzale`, per l'addetto alla pesa o l'autista all'impianto di destino.
- Bersagli da almeno 56 px, una sola decisione per schermata, contrasto massimo, giallo ad alta visibilità solo sull'azione principale. La tipografia leggibile è a scelta dell'implementatore dentro il tema.
- Il peso si corregge con i pulsanti più e meno oltre che con il tastierino.
- Lo stato della rete è sempre dichiarato in testa. **Senza rete l'invio è bloccato** con un messaggio chiaro, riusando `connection-monitor.service.ts` e `offline-indicator`.

### Flusso
1. Elenco dei FIR in arrivo, **solo dal tenant dell'azienda selezionata**: la lettura fra tenant resta esclusa e la RLS la vieta. Entrano:
   - i FIR acquisiti da RENTRI (`acquisisci-formulario-rentri.use-case.ts`, rami NUOVO e COLLEGA_ESISTENTE), che sono la fonte principale;
   - quelli creati dall'impianto stesso.

   In tutti e due i casi il destinatario deve essere l'azienda, verificato con `codiciAzienda()` del MUD, e il FIR in stato IN_TRANSITO. Un FIR per riga, ricercabile per numero o targa. P.IVA e CF identificano l'azienda, non la sede: con più unità locali, la sede si prende dall'unità locale del formulario RENTRI quando c'è, altrimenti la sceglie l'utente.
2. Una schermata per FIR: da chi, EER con descrizione, peso dichiarato.
3. Peso verificato. Lo scostamento si calcola con `calcolaScostamentoPeso` e `SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO` già esistenti, e si mostra come **avviso, non come dato normativo**: nessuna norma fissa una tolleranza.
4. Esito, che dipende da come è nato il FIR:
   - **FIR legato a RENTRI**: accettato (A), parziale (P) o respinto (R) tramite `POST rentri/.../:id/accettazione`. La quantità è obbligatoria per A e P; causale (NC, IR, A) e motivo sono obbligatori per P e R. Contratto: `docs/contracts/rentri/formulari.yaml`.
   - **FIR locale**: solo il peso, con `POST fir/:id/conferma-consegna`. Parziale e respinto non esistono per i FIR locali e **non si simulano nel frontend**.
5. Firma. Predefinito: **il Piazzale registra peso ed esito, la firma dell'accettazione resta all'ufficio** (RENTRI separa già InserimentoAccettazione e FirmaAccettazione). La schermata finale dice chiaramente "accettazione registrata, da firmare in ufficio". Solo se l'utente è un firmatario autorizzato con firma remota RENTRI, il Piazzale può avviare la firma remota esistente (`completa-operazione-con-firma.use-case.ts`, conferma sul telefono entro 120 secondi, esiti COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA).

### Limiti dichiarati
- Lo stato interno del FIR non distingue parziale e respinto (diventa tutto CONSEGNATO). Il Piazzale mostra l'esito dal dato RENTRI, non dallo stato interno.
- Avvisare il produttore dello scostamento di peso è utile (il suo registro e il MUD usano la quantità dichiarata), ma la notifica non esiste. È un seguito.

---

## 5. Tenant demo

- Uno script in `tools/` o `scripts/` crea un consulente, 4-5 aziende con ruoli diversi (almeno un produttore, un trasportatore, un impianto), anagrafiche coerenti, circa 9 mesi di FIR e movimenti di registro generati **attraverso le regole del dominio**, non scritti in tabella a mano. Così Bilancio, Studio e MUD li calcolano davvero.
- I dati devono far comparire ogni tipo di scadenza di Studio almeno una volta, scostamenti di peso, FIR RENTRI e locali in arrivo per il Piazzale, un MUD in bozza.
- Nessun dato reale di altre aziende. P.IVA con checksum valido: si usa il generatore di F2-10 (`e2e/utils/partita-iva.ts`) dopo il merge; fino ad allora un generatore locale nello script, da sostituire.
- Lo script è **idempotente e ripristinabile**: cancella e ricrea solo il tenant demo, identificato in modo inequivocabile, senza toccare gli altri tenant.
- Si esegue in produzione a mano, prima di una demo. Il deploy non lo lancia.
- **RENTRI per la demo: la fake** (decisione di Graziano). `tools/rentri-fake` viene pubblicata sul VPS come servizio interno nello stack `/opt/rifiuti/`, senza esposizione pubblica. **Solo i tenant demo** la usano: l'indirizzo RENTRI si sceglie per tenant, e tutti gli altri tenant restano sulla configurazione attuale. Così i FIR "legati a RENTRI" del seed nascono dal flusso vero (emissione, trasmissione, acquisizione da parte dell'impianto) e il Piazzale fa A/P/R end-to-end, senza certificati e senza dati verso l'ente. La schermata RENTRI del tenant demo dichiara "ambiente dimostrativo". Va verificato che oggi l'indirizzo RENTRI sia configurabile per tenant; se è globale, serve un override per tenant, additivo.
- **Utenti demo in Keycloak** (decisione di Graziano). Lo script crea nel realm `ignicraft`:
  - `demo-consulente`, associato come consulente alle aziende demo;
  - `demo-titolare`, con ruolo VIEWER su un'azienda produttrice;
  - `demo-piazzale`, OPERATOR sull'impianto.

  Le password stanno in `/opt/rifiuti/.env` e si usa il service account del backend già esistente. Il ripristino cancella e ricrea solo questi utenti e i tenant demo, riconosciuti da un marcatore esplicito, e non tocca nient'altro nel realm. La sessione singola vale anche per loro: in demo si usano tre browser o profili distinti.

---

## Sequenza e branch

| Filone | Parte subito | Si aggancia dopo |
|---|---|---|
| Studio | calendario lavorativo, regole Registro, FIR senza riscontro, scadenze annuali, endpoint consulente, scheda | F2-6: deposito |
| Bilancio | pagina, calcolo in sola lettura sulle regole MUD, blocco MUD, PDF | F2-8: funzione condivisa e test di uguaglianza; F2-6: avvisi deposito |
| Modulo | impaginazione e sezioni dal modello ufficiale, vincoli F2-4/F2-7, colorazione dai controlli di creazione del DTO (dichiarato) | F2-10: selezione delle parti con le sedi, ed endpoint prerequisiti di emissione (F2-10 tocca `costruisci-payload-rentri.ts` e `mappa-parti.ts`) |
| Piazzale | tutto | nessuno |
| Tenant demo | fake RENTRI sul VPS con indirizzo per tenant, utenti Keycloak, script con il generatore locale | F2-10: generatore P.IVA |

Ogni filone ha il suo branch da master e la sua PR. Il rilascio passa dalla pipeline di master come sempre.

## Decisioni di Graziano (2026-10-28)

- Si fanno tutte e quattro le direzioni, in parallelo, con Opus coordinatore e revisore e implementatori Sonnet.
- Si parte con ciò che è libero e ci si aggancia a F2-6, F2-8 e F2-10 dopo il loro merge.
- La demo è commerciale e il profilo del cliente non è ancora deciso.
- Tenant demo seminato e ripristinabile, con la fake RENTRI per i soli tenant demo e utenti Keycloak creati dallo script.
- Piazzale: flusso vero online, offline solo dichiarato.
- Modulo: è il form di compilazione e modifica della bozza.
- Bilancio: è il cruscotto del ruolo sola lettura.
- L'attività sta sulla causale, con un pezzo dedicato fuori da questo lavoro.
- Blocco dell'emissione "come WinWaste", solo per chi trasmette a RENTRI, con un pezzo dedicato fuori da questo lavoro.

## Pezzi esterni da cui dipende la demo (non in questo lavoro)

- F2-6 deposito temporaneo, F2-8 MUD per sede (con la funzione condivisa MUD/Bilancio), F2-10 controparti.
- Colonna "attività" nel catalogo delle causali.
- Endpoint "prerequisiti di emissione" con il blocco per chi trasmette a RENTRI.

## Seguiti dichiarati

- Coda offline del Piazzale.
- Notifica dello scostamento di peso al produttore.
- Costi dai contratti nel Bilancio.
- Autorizzazioni proprie dell'azienda gestore.

## Scelte del coordinatore (da controllare)

- Studio come prima scheda della dashboard consulente, orizzonte di 30 giorni, gruppo "Scaduto" in testa.
- Festività patronali escluse dal calendario lavorativo, dichiarato.
- FIR senza riscontro: 3 mesi dal conferimento, regola generale, anche per i FIR RENTRI.
- Bilancio come rotta di default solo per il ruolo sola lettura.
- Niente costi nel Bilancio in questa fase.
- Modulo come interruttore dentro il form esistente, non come rotta separata.
- Piazzale: la firma resta all'ufficio per default.
- Seed con un generatore di P.IVA locale fino al merge di F2-10.
