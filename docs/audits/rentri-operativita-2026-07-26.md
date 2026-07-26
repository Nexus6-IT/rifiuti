# Cosa si può fare dal gestionale senza usare il portale RENTRI

**Data:** 2026-07-26
**Fonte di verità:** `docs/contracts/rentri/formulari.yaml` (openapi 3.0.4, `version: 1.0.20260723-1089`, `x-api-id: rentrigov.formulari`, server `https://demoapi.rentri.gov.it/formulari/v1.0`), 65 path. Riscontri incrociati con `docs/contracts/rentri/anagrafiche.yaml` per i prerequisiti di iscrizione/unità locale. Nessuna informazione di questo documento proviene dal web o da memoria: ogni affermazione è tracciata al path/riga del contratto scaricato dall'ente.

Metodo: lettura diretta dello YAML (grep + read mirati), non della fake `tools/rentri-fake/` né dei documenti di audit precedenti (`ACCERTAMENTI.md`, `FEDELTA.md`), usati solo come mappa di orientamento iniziale — le affermazioni qui sotto sono verificate contro il file sorgente, con numero di riga.

---

## 1. Il ciclo di vita del formulario è governabile via API?

Risposta sintetica: **sì per quasi tutte le fasi del formulario digitale nativo**, con due buchi strutturali — la vidimazione/creazione del numero FIR per il **cartaceo** non è un'operazione dell'API formulari (è un'operazione di registro/vidimazione fuori da questo contratto, cfr. `ACCERTAMENTI.md` §"API registri": non esposta su alcun path testato), e il concetto di "quarta copia" cartacea non esiste come tale nell'API.

| Fase del processo reale | Endpoint (contratto) | Metodo | Note |
|---|---|---|---|
| Creazione/vidimazione FIR digitale | `POST /` (riga 187) | POST, asincrono (202 + `TransazioneModel`) | Il numero FIR **non** è fornito dal chiamante: `NuovoFormularioModel` (riga 9907) richiede solo `num_iscr_sito` + `dati_partenza` (+ opz. `dati_trasporto_partenza`); l'esito arriva via `/status`→`/result` come `EsitoNuovoFormularioModel.numero_fir` (riga 9503-9512), assegnato dall'ente. |
| Modifica dati FIR | `PUT /{numero_fir}` (riga 352) | PUT, asincrono | "Modifica FIR", stessa meccanica 202/Location. |
| Dati quantità | `POST /{numero_fir}/quantita` (riga 1789) | POST, asincrono | |
| Dati trasporto (iniziale/successivo) | `POST /{numero_fir}/trasporto` (riga 2518) | POST, asincrono | |
| Presa in carico da trasportatore successivo / annotazioni / trasbordo / sosta tecnica | `POST /{numero_fir}/annotazione` (1037), `/trasbordo-parziale` (2313), `/trasbordo-totale` (2414), `/sosta-tecnica` (2164), `/destinatario` (nuovo destinatario, 1393) | POST, tutti asincroni | Coprono l'intera casistica di trasporto plurimo, trasbordo, sosta tecnica, cambio destinatario in corsa. |
| Accettazione / respingimento (anche parziale) da parte del destinatario | `POST /{numero_fir}/accettazione` (431) | POST, asincrono | Il "respingimento" **non** è un endpoint a sé: è il valore `tipo_accettazione = R` (Respinto) dentro `DatiAccettazioneModel` (righe 6828, 6837: valori ammessi `A`=intero, `P`=parziale, `R`=respinto). |
| Firma (di ciascun passaggio: produttore, trasportatore, destinatario, annullamento, ecc.) | `POST /{numero_fir}/hash` (1498, calcolo hash da firmare) + `POST /{numero_fir}/acquisizione-firma` (531, imposta i dati di firma) + `POST /{numero_fir}/rollback-firma` (2079) | POST, asincroni | Presenti nel contratto. `EsitoGetHashPerFirmaModel.digest_to_sign` (riga ~9425, citato in `ACCERTAMENTI.md`) è il campo restituito da questi endpoint. **Nessun valore legale è certificabile da questo solo contratto**: la Guida tecnica di compilazione XAdES/ETSI non è qui, cfr. memoria `rifiuti-firma-non-legale`. |
| Trasbordo, sosta tecnica | vedi sopra | POST | Coperti. |
| Annullamento | `POST /{numero_fir}/annulla-fir` (1232, corrente) — `.../annulla` (1136) è **deprecato**, sostituito dal primo | POST, asincrono | + `POST /{numero_fir}/note-annullamento` (1642) per le motivazioni, + firma dell'annullamento tramite gli endpoint di firma sopra (stato `FirmaAnnullamento`, riga 9042). |
| Reset stato | `POST /{numero_fir}/reset` (1888) | POST, asincrono | Non richiesto esplicitamente dalla domanda ma parte del ciclo di correzione errori. |
| Allegati | `POST /{numero_fir}/allegato` (776), `GET/DELETE /{numero_fir}/allegato/{allegato_id}` (882) | POST/GET/DELETE | |
| Stampa/quarta copia | `GET /{numero_fir}/pdf` (1739) | GET | Restituisce "una stampa in PDF del FIR" (riga 1745). **Non esiste nel contratto il concetto "quarta copia"** come oggetto distinto: non risulta alcuna occorrenza della stringa in `formulari.yaml`. La stampa PDF è l'unico surrogato documentale generico, disponibile a "un'utenza che abbia incarichi per (o coincida con) almeno uno dei soggetti coinvolti" (riga 1748). |
| Visibilità (presa in carico logica di un FIR creato da terzi) | `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` (657, corrente) — `/acquisizione/{num_iscr_sito}` (716) deprecato; rilascio: `/rilascio-visibilita/{num_iscr_sito}` (2030, corrente) — `/respingi` (1980) deprecato | POST | Vedi §3: è il meccanismo di aggancio cross-soggetto. |
| Stato/azioni disponibili | `GET /{numero_fir}/stato` (2265), `GET /{numero_fir}/azioni` (1330) | GET | "Azioni disponibili" utile per pilotare la UI del gestionale sullo stato macchina reale del FIR. |
| Invio a dispositivo (es. lettore di bordo) | `POST /{numero_fir}/invia-a-dispositivo` (1583) | POST | Fuori scope tipico gestionale documentale, ma presente. |
| Chiusura ciclo di vita — copia digitale | `POST /copia-digitale/caricamento/{numero_fir}` (3731) | POST, asincrono | "chiusura del ciclo di vita del FIR mediante invio, da parte del destinatario, del file xFIR" (riga 3737-3739). Vedi §4. |
| Copia cartacea (doppio binario) | `POST /copia-cartacea/caricamento/{num_iscr_sito}` (3001) + conferma da parte degli altri soggetti `GET/PUT /copia-cartacea/conferma/{identificativo_soggetto}` (3357) | POST/GET/PUT, asincroni | Vedi §4. |
| Validazione xFIR | `POST /xfir/valida` (5981), `GET/POST /{numero_fir}/xfir` (2625, download/upload) | GET/POST, asincroni | Endpoint di validazione **dell'ente**, distinto dal caricamento chiusura ciclo. |
| Vidimazione/registro numero FIR (creazione slot cartaceo) | **assente** | — | `ACCERTAMENTI.md` conferma: nessun path `/registri`, `/registro`, `/vidimazione` risponde su `formulari.yaml`; l'API registri non è esposta in questi contratti scaricati. |

**Fasi senza copertura API dirette, che obbligano al portale (o restano fuori contratto):**
1. **Vidimazione/attribuzione del numero FIR cartaceo** — non è un'operazione di questa API (nessun path `/registri*`/`/vidimazione*`, confermato in `ACCERTAMENTI.md`). Se l'operatore emette ancora formulari cartacei vidimati, quell'atto resta fuori dall'API formulari.
2. **"Quarta copia" come concetto distinto** — non esiste nel contratto; solo la stampa PDF generica (`/{numero_fir}/pdf`) è disponibile via API.
3. Le operazioni deprecate (`/annulla`, `/acquisizione/{num_iscr_sito}`, `/respingi`, `/trasmissioni/{num_iscr_sito}*` senza `operatore`/`soggetto-delegato`) sono ancora nel contratto ma segnalate `deprecated: true`: un'integrazione nuova non dovrebbe usarle, anche se tecnicamente rispondono.

---

## 2. Gli identificativi

| Identificativo | Assegnato da | Quando | Stabilità | Riferimento |
|---|---|---|---|---|
| `numero_fir` | **Ente** (RENTRI) | Al termine dell'elaborazione asincrona di `POST /` (creazione FIR); restituito in `EsitoNuovoFormularioModel.numero_fir` (riga 9509) | **Stabile per tutta la vita del FIR** — è l'identificatore con cui si richiama ogni operazione successiva (`/{numero_fir}/...`). Pattern fisso: `^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$` (riga 457 e ricorrente su ogni path `{numero_fir}`). Non è mai fornito dal chiamante in creazione. |
| `transazione_id` | **Ente** | Ad ogni chiamata **asincrona** (creazione, modifica, ogni operazione marcata "[ASYNC]") | **Non stabile / non riusabile**: è l'id della singola operazione asincrona, formato `uuid` (`TransazioneModel.transazione_id`, riga 10276-10278), da consumare via `/{transazione_id}/status` → `/{transazione_id}/result` e poi si esaurisce. Non identifica il FIR nel tempo, solo quella specifica richiesta. |
| `num_iscr_sito` | **Ente**, all'iscrizione dell'unità locale (fuori da questo contratto — cfr. `anagrafiche.yaml`) | Assegnato una volta, all'iscrizione RENTRI dell'unità locale; il chiamante lo **possiede già** e lo passa come parametro | Stabile, riferibile all'operatore. Pattern `^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$` (riga 684 e ricorrente). Recuperabile via `anagrafiche.yaml` → `GET /operatore/{num_iscr}/siti` (anagrafiche.yaml riga 219) o, per un soggetto delegato, `/soggetto-delegato/{num_iscr_ass}/siti` (riga 1200). |
| `identificativo` | **Ente**, generato per oggetti figli (allegati, copie cartacee/digitali, trasmissioni) | Al momento della creazione dell'oggetto figlio | Stabile per quell'oggetto (es. `CopiaCartaceaConfermaModel.identificativo`, riga 6364; `TrasmissioneDatiItemResult.identificativo`, riga 10297) | |
| `identificativo_soggetto` | **Esiste come dato anagrafico del chiamante** (codice fiscale), non assegnato dall'API formulari | Usato come parametro di ricerca (`GET /`) e come chiave delle liste "copie disponibili per conferma" | Stabile (è il CF del soggetto) — vedi riga 34-51: "coincide con il codice fiscale di uno dei soggetti indicati nel FIR" | |

**Conclusione sull'aggancio:** l'unico identificativo stabile e riusabile per legare un record del nostro gestionale al FIR RENTRI è `numero_fir`, assegnato dall'ente e non prevedibile prima della creazione. Il gestionale deve quindi: (a) creare il FIR via `POST /`, attendere l'esito asincrono, e persistere il `numero_fir` restituito come chiave esterna; oppure (b) per un FIR creato da terzi, trovarlo via ricerca (§3) e persistere lo stesso `numero_fir`. `transazione_id` **non va mai usato** come chiave di lungo periodo: esiste solo per il polling della singola operazione.

---

## 3. Si può associare un formulario già esistente su RENTRI a uno creato nel nostro software?

**Sì, esiste un meccanismo esplicito nel contratto — ricerca per soggetto + acquisizione di visibilità.** Non è un'associazione automatica: è un processo a due passi che il gestionale deve orchestrare.

1. **Ricerca (`GET /`, riga 15-130).** Il filtro `identificativo_soggetto` (riga 34-51) restituisce *tutti* i FIR digitali in cui quel CF compare come uno qualunque dei soggetti indicati (produttore, trasportatore, destinatario, intermediario), **indipendentemente dal fatto che l'utenza chiamante abbia già acquisito la visibilità del FIR in una propria unità locale** (riga 43: "indipendentemente dall'aver acquisito la visibilità del FIR digitale in una specifica unità locale"). Il contratto impone che sia valorizzato `num_iscr_sito` **oppure** `identificativo_soggetto`, mai nessuno dei due (righe 29,45). Il risultato (`FormularioItemResult`, riga 9686) include il flag `visibilita_sito_acquisita` (riga 9794): "Indica se il formulario è stato acquisito in visibilità da almeno un'unità locale [...] riconducibile al soggetto per cui viene fatta la richiesta" — questo è il segnale con cui il gestionale sa se un FIR trovato è già "posseduto" o va acquisito.
2. **Lettura diretta per numero (`GET /{numero_fir}`, riga 283).** Se il numero FIR è già noto (es. comunicato fuori banda da un partner commerciale, o scritto su una copia cartacea), il dettaglio è recuperabile direttamente — soggetto agli stessi vincoli di visibilità/incarico.
3. **Acquisizione di visibilità (`POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}`, riga 657).** "Acquisisce la visibilità in ricerca sull'unità locale specificata di un FIR digitale **creato da terzi**" (riga 663). Condizione: l'utenza deve avere incarichi per (o coincidere con) almeno uno dei soggetti coinvolti nel FIR, e il `num_iscr_sito` indicato deve essere riferibile a quell'utenza (riga 666-668). Dopo questa chiamata il FIR compare nelle liste dell'unità locale del chiamante (`GET /` con `num_iscr_sito`).
4. **Rilascio di visibilità (`POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}`, riga 2030)** — l'operazione inversa, per "abbandonare" un FIR precedentemente acquisito senza cancellarlo dall'ente.

**In pratica, per il nostro gestionale:** quando un cliente riceve un FIR creato da un trasportatore/produttore terzo (es. il nostro gestionale gestisce solo il destinatario), il flusso corretto è: cercare per `identificativo_soggetto` = CF del cliente → trovare `numero_fir` e verificare `visibilita_sito_acquisita` → se `false`, chiamare `acquisizione-visibilita` con il proprio `num_iscr_sito` → persistere `numero_fir` come chiave di collegamento nel nostro database. **Non esiste alcun meccanismo di "import" del contenuto del FIR nel nostro DB**: la sincronizzazione dei dati resta a carico nostro tramite `GET /{numero_fir}` (dettaglio completo, `DettaglioFormulario`, riga 9032) ogni volta che serve un refresh.

Le operazioni sotto `/trasmissioni/` (righe 4612-5981, con varianti `operatore`/`soggetto-delegato`) sono un canale **distinto**: servono a trasmettere/estrarre dati strutturati del FIR digitale tra operatore e RENTRI (o tra soggetto delegato e RENTRI) — non sono un meccanismo di aggancio tra due gestionali diversi, ma il canale con cui un unico operatore scambia dati con l'area virtuale di interscambio. Non risultano nel contratto endpoint per "collegare" due FIR di sistemi gestionali diversi al di fuori del meccanismo visibilità/CF descritto sopra.

---

## 4. Copia FIR cartaceo vs copia FIR digitale

Sono due meccanismi **diversi** e **non sostituibili l'uno con l'altro**, entrambi presenti nel contratto sotto tag dedicati:

**Copia FIR cartaceo** (tag "Copia FIR cartaceo", path `/copia-cartacea/*`, righe 2898-3628):
- `POST /copia-cartacea/caricamento/{num_iscr_sito}` (riga 3001): il trasportatore carica la **scansione** del FIR cartaceo firmato (PDF/JPG/PNG, max **5 MB**, riga 3011) per "renderla disponibile ai soggetti specificati" (riga 3007). Condizioni esplicite (riga 3010-3012): la vidimazione del FIR non deve essere annullata, e non deve già esistere una copia digitale con FIR accettato per intero.
- `GET/PUT /copia-cartacea/conferma/{identificativo_soggetto}` (riga 3357): gli altri soggetti (produttore, destinatario…) **confermano la presa visione** della copia caricata, per ruolo (`RuoloConfermaCopiaCartacea`).
- Questo è quindi un canale di **scambio documentale di un FIR nato cartaceo** (o trasformato in cartaceo) — non modifica lo stato del formulario digitale, serve a formalizzare la circolazione della copia fisica scansionata tra le parti attraverso RENTRI invece che a mano.

**Copia FIR digitale** (tag "Copia FIR digitale", path `/copia-digitale/*`, righe 3628-4450):
- `POST /copia-digitale/caricamento/{numero_fir}` (riga 3731): descritta esplicitamente come "chiusura del ciclo di vita del FIR mediante invio, da parte del destinatario del formulario, del file **xFIR** che ne contiene le informazioni" (righe 3737-3739). Vincoli: unità locale del destinatario iscritta con attività Recupero/Smaltimento/Centro di raccolta (riga 3745); il FIR deve essere nello stato `Accettato` o `RespintoAccettatoParzialmente` (riga 3750); niente doppio caricamento dello stesso xFIR (riga 3753); il file deve essere validabile dall'endpoint `/xfir/valida` (riga 3758); dimensione massima **3 MB** (riga 3761).
- `GET/PUT /copia-digitale/conferma/...` (righe 4156-4450): conferma di disponibilità/presa visione, analoga alla cartacea ma per il file xFIR firmato.

**Rilevanza per il 15/09/2026:** il contratto conferma che i due binari (cartaceo e digitale) coesistono come percorsi paralleli e distinti nell'API attuale — non c'è un flag univoco "modalità cartacea disattivata" nel contratto, solo il campo `trasformato_in_cartaceo` (booleano) sul FIR digitale (riga 9071-9074, 9785-9788) che indica se un FIR digitale ha subito la trasformazione verso cartaceo. Il contratto non dichiara **date di scadenza** del binario cartaceo: quella scadenza (15/09/2026, da `rifiuti-rentri-non-conforme` nella memoria di progetto) è un fatto normativo esterno, non presente in questi file YAML — va trattato come vincolo di prodotto, non verificabile dal contratto stesso.

---

## 5. Cosa serve per operare davvero

**Prerequisiti di iscrizione/identità** (da `anagrafiche.yaml`, incrociati con i parametri di `formulari.yaml`):
- **`num_iscr_sito`** per ogni unità locale operativa — pattern `^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$`, ottenibile solo dopo l'iscrizione RENTRI dell'unità locale, recuperabile via `anagrafiche.yaml` → `GET /operatore/{num_iscr}/siti` (riga 219) o `GET /soggetto-delegato/{num_iscr_ass}/siti` (riga 1200) per chi opera per conto terzi.
- **Ruoli/incarichi**: quasi ogni operazione di scrittura richiede esplicitamente che "l'utenza chiamante abbia incarichi per (o coincida con) almeno uno dei soggetti coinvolti nel formulario" (formulazione ricorrente, es. righe 666, 3742, 1748) — non basta l'autenticazione tecnica, serve un legame di incarico/delega registrato lato RENTRI tra l'operatore chiamante e il soggetto rappresentato.
- **Soggetto delegato**: esiste un intero albero parallelo `soggetto-delegato/*` sia in `anagrafiche.yaml` (righe 1058-1628) sia in `formulari.yaml` (`/trasmissioni/soggetto-delegato/*`, righe 5578-5981) per chi opera come consulente/delegato di più operatori — rilevante per un gestionale multi-tenant come il nostro.
- **Certificato/JWT (autenticazione "direct trust")**: `securitySchemes` dichiara solo `bearerFormat: JWT` (riga 10548); il contratto **non** descrive qui il formato del certificato x5c o l'algoritmo atteso — quei dettagli (RS256, catena verso CA RENTRI, claim ModI) sono noti solo dall'analisi comportamentale della fake (`FEDELTA.md` §3.4/6.1), non da questo OpenAPI, che si limita a `HTTP bearer`. Trattarli come "non risulta dal contratto formulari.yaml" e da verificare sulla documentazione ModI/RENTRI dedicata all'autenticazione.

**Vincoli operativi dichiarati nel contratto:**
- **Dimensioni massime file**: copia cartacea max **5 MB** (riga 3011); xFIR (sia per copia digitale che per validazione) max **3 MB** (riga 3761).
- **Formati ammessi**: copia cartacea `application/pdf`, `image/jpeg`, `image/png` (righe 6403-6407); xFIR è un formato proprio (ASiC-E/XAdES, validato da `/xfir/valida`).
- **Asincronia universale**: ogni operazione di scrittura sul FIR (creazione, modifica, quantità, trasporto, accettazione, annullamento, firma, copie) è marcata `[ASYNC]` nel summary e segue il pattern 202 (`TransazioneModel` + header `Location`) → poll `GET /{transazione_id}/status` (200 senza corpo se non pronto, **303 + `Location`** se pronto, riga 2847) → `GET /{transazione_id}/result` (**400** se non ancora elaborata, `EsitoFormularioModel` con `errore`/`validazione` se pronta, riga 2801). Nessuna operazione di scrittura è sincrona.
- **Callback opzionale**: header `X-ReplyTo` su ogni operazione asincrona per ricevere notifica push a fine elaborazione invece di fare polling (descrizione ricorrente, es. riga 450).
- **Rate limiting dichiarato**: **429** oltre 100 richieste/5 secondi con header `Retry-After`; **423** per troppe richieste concorrenti autenticate ma non valide, con ban a livello di chiamante (Issuer) — descrizione ricorrente su quasi ogni operazione (es. righe 503-513).
- **Paginazione su `GET /`**: header `Paging-Page`/`Paging-PageSize` (righe 112-129, default page=1/size=100, max size=1000).
- **Validazione formale del `numero_fir`**: pattern regex applicato su ogni path che lo referenzia; un valore fuori pattern deve produrre **400**, non un 404 "silenzioso" (nota: la fake in una prima versione lo confondeva, cfr. `FEDELTA.md` — qui è quanto **dichiara** il contratto, non quanto implementa la fake).

---

## Verdetto: cosa si può fare senza il portale, e cosa no

**Si può fare interamente via API (governo completo dal gestionale):**
- Creare, modificare, quantificare, trasportare, accettare/respingere (anche parzialmente), annullare, firmare (invio hash + dati firma), annotare, trasbordare (parziale/totale), gestire soste tecniche, cambiare destinatario, allegare documenti, stampare il PDF, interrogare stato e azioni disponibili di un FIR **digitale nativo**, dal primo all'ultimo passaggio del ciclo di vita, incluso l'annullamento con relative note.
- **Cercare** un FIR esistente su RENTRI creato da un terzo (per CF proprio o altrui nei limiti di visibilità) e **acquisirne la visibilità**, così da agganciarlo stabilmente al proprio gestionale tramite `numero_fir` — è un meccanismo reale e documentato, non un'ipotesi.
- Scambiare copie cartacee scansionate e copie digitali (xFIR) di chiusura tra le parti, incluse le rispettive conferme di presa visione.
- Validare autonomamente un file xFIR prima di caricarlo, tramite l'endpoint ufficiale di validazione.
- Operare come soggetto delegato per conto di più operatori (architettura multi-tenant supportata a livello di contratto).

**Richiede necessariamente il portale RENTRI (o comunque esce da questo contratto):**
- **La vidimazione/attribuzione iniziale del numero FIR per il cartaceo puro** e, più in generale, ogni operazione sui "registri" — non esposta in nessun path di `formulari.yaml`, né in altre varianti testate (`ACCERTAMENTI.md`).
- **L'iscrizione dell'operatore e delle unità locali** (ottenimento del `num_iscr_sito` stesso, incarichi, deleghe) — è un prerequisito amministrativo a monte, gestito da `anagrafiche.yaml`/RENTRI, non dall'API formulari.
- **La "quarta copia" come oggetto distinto** non esiste nel contratto: se il processo aziendale la richiede in una forma specifica diversa dalla stampa PDF generica, va verificata fuori da questi file.
- **Il valore legale della firma**: il contratto espone gli endpoint tecnici (hash, acquisizione firma, rollback) ma non la logica di conformità XAdES/ETSI, né l'ancoraggio a un certificato di firma qualificata — coerente con quanto già accertato in `rifiuti-firma-non-legale` (memoria di progetto): l'API dà i "ganci", non la conformità.
- I dettagli fini dell'autenticazione (certificato, CA, claim ModI) non sono descritti in `formulari.yaml` (solo `bearerFormat: JWT` generico): vanno cercati nella documentazione di interoperabilità RENTRI dedicata, non in questo contratto.
