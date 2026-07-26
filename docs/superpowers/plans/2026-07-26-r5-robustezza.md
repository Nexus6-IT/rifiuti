# R5 — Robustezza e osservabilità: non farsi bandire dall'ente

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** l'automazione RENTRI resta **sostenibile nel tempo**: non insiste mai abbastanza da farsi bandire (423), l'azienda può verificare da sola lo stato del proprio collegamento con l'ente senza che questo generi traffico verso l'ente, uno stato locale che diverge da quello dell'ente viene rilevato senza martellarlo, e qualcuno viene svegliato quando serve.

**Il criterio di valore, fissato dal design di programma:** «Un'automazione che si fa bandire dall'ente è peggio di nessuna automazione.» Il rischio non è tecnico nel senso comune — non è che una chiamata fallisca, è che **il pattern di chiamate** venga giudicato abusivo da un ente che non negozia: il 423 è irreversibile lato nostro (richiede intervento dell'ente per essere rimosso) e colpisce **il certificato del tenant**, cioè la sua unica via di accesso.

**Stack:** NestJS 10, Prisma, Redis 7 (`ioredis`), BullMQ, `@nestjs/schedule`, prom-client, Jest, Playwright.

## Vincoli globali

- **Italiano** in ogni testo utente. Identificatori di codice in inglese; termini di dominio RENTRI (`numero_fir`, `transazione_id`, `identificativo_soggetto`) identici alla specifica.
- **`data-testid` dal primo commit**, secondo `e2e/SELECTORS-DEBT.md`.
- **Prettier** sui file toccati prima di ogni commit.
- Suite da non far calare: **106 suite / 987 test** backend, **6 suite / 13 test** oracolo, **53 test** frontend.
- Le spec contro l'oracolo si chiamano `*.oracolo.spec.ts` e girano con `npm run test:oracolo`, **mai** nella suite unitaria.
- Commit in italiano, senza attribuzione ad AI.
- **Ogni frequenza/intervallo introdotto in questo piano è motivato con un numero**, non con «periodicamente» — è il vincolo esplicito del committente per questa fase.

## Stato di partenza

Tre strati esistono già e **non vanno duplicati**:

1. **`RENTRIApiClient` (`apps/backend/src/infrastructure/rentri/rentri-api.client.ts`)** — resilienza per singola chiamata HTTP: 403 mai ritentato; 429 rispetta `Retry-After` o backoff esponenziale (base 1s, tetto 30s); 423 e 5xx stesso backoff; **5 tentativi** massimi (`MAX_TENTATIVI_RESILIENZA`), poi solleva `RentriApiError` con `retryable` che distingue 403 (`false`) da 429/423/5xx (`true`).
2. **`RENTRISyncStatus` (`apps/backend/src/domain/fir/rentri-sync-status.vo.ts`)** — resilienza per l'intera operazione di dominio: backoff più prudente (`2^tentativo * 60s`, tetto 3600s, **5 tentativi** massimi), e un elenco chiuso di codici **non ritentabili** (`RENTRI_FORBIDDEN`, `RENTRI_VALIDATION_ERROR`) che fermano il ciclo indipendentemente dal conteggio tentativi — introdotto in R1 per non ripetere la stessa richiesta destinata a fallire.
3. **Assente**: un limite **preventivo** che impedisca di avvicinarsi alla soglia dichiarata dal contratto (>100 richieste/5s → 429; troppe richieste concorrenti non valide → 423) **prima** che l'ente debba intervenire. Questo è l'oggetto di R5, ed è un terzo strato distinto: i primi due reagiscono a un errore già ricevuto, questo previene l'errore.

**Cosa manca anche:** nessuna schermata mostra la salute del collegamento RENTRI (solo il certificato, `/rentri/certificato`, e la modalità di legame, R1); nessun processo verifica che lo stato locale corrisponda a quello dell'ente; nessuna metrica/allarme specifico per certificato in scadenza, tenant bandito o coda RENTRI ferma. `MetricsService` (`apps/backend/src/core/metrics/metrics.service.ts`) espone già `rentriApiErrors` (Counter, label `endpoint`/`error_type`) e `queueDepth` (Gauge, label `queue_name`/`status`), riusati in questo piano invece di introdurre un meccanismo nuovo. `monitoring/prometheus.yml` ha già il punto di aggancio per le regole di allarme (`rule_files: # - "alerts/*.yml"`, oggi commentato).

---

### Task 1: Il limitatore preventivo per tenant

Il pezzo che manca. Non un contatore globale — il ban colpisce **il certificato del chiamante**, e ogni tenant ha il proprio.

**Parametri proposti (motivare nel codice con lo stesso ragionamento):**

- **Soglia locale: 30 richieste ogni 5 secondi per tenant** — il 30% del limite dichiarato dal contratto (100/5s). Il margine (70%) non è prudenza generica: copre (a) l'allineamento della finestra, che è dell'ente e non è noto — la nostra finestra scorrevole non misura necessariamente la stessa finestra fisica che vede l'ente; (b) l'uso del portale RENTRI da parte di un operatore dell'azienda in parallelo alla nostra automazione, con lo stesso certificato, invisibile a noi; (c) il fatto che una singola operazione di dominio può già consumare fino a 5 richieste HTTP per via della resilienza del client (`MAX_TENTATIVI_RESILIENZA`) quando l'ente è degradato — in quel momento è precisamente quando NON bisogna aggiungere pressione.
- **Concorrenza: massimo 3 richieste in volo per tenant.** Il contratto lega esplicitamente il 423 a «un numero eccessivo di richieste **concorrenti**, autenticate ma non valide» — è un asse distinto dal volume, e nessuno dei due strati esistenti lo limita (il polling di `attendiEsito` è già sequenziale per una singola transazione, ma nulla impedisce a più job BullMQ dello stesso tenant di essere processati in parallelo da worker diversi). Tre è il numero minimo che non serializza inutilmente le operazioni legittime (dettaglio + polling stato + polling risultato possono sovrapporsi per FIR diversi) restando ben sotto qualunque soglia realistica di «troppe».
- **Comportamento quando il limite è raggiunto: attesa locale, non fallimento.** L'automazione (job in coda) aspetta che si liberi capacità — non genera un 429 vero facendolo poi ritentare dal client. L'azione manuale dell'utente («Trasmetti a RENTRI») ha un tetto di attesa breve (2 secondi) oltre il quale risponde con un messaggio leggibile («troppe richieste verso RENTRI in questo momento, riprova tra poco») invece di bloccare la richiesta HTTP dell'utente a tempo indeterminato.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-rate-limiter.service.ts` (nuovo)
- `apps/backend/src/infrastructure/rentri/rentri-rate-limiter.service.spec.ts` (nuovo)
- `apps/backend/src/infrastructure/rentri/rentri.module.ts` (provider + export)

- [ ] **Step 1: Scegliere e testare l'algoritmo**

Sliding window log su Redis (riusare `RedisConfig`/il client condiviso di `apps/backend/src/infrastructure/cache/redis.config.ts`, **non** `RedisService` di `auth/services/`, che è specifico ai token di sessione): chiave `rentri:ratelimit:{tenantId}`, timestamp in un sorted set, potatura di quelli più vecchi di 5s a ogni controllo. Scelto sorted-set e non `INCR`+`EXPIRE` perché la finestra deve scorrere, non azzerarsi a bordo fisso — un bordo fisso permetterebbe una raffica doppia a cavallo di due finestre consecutive.

Contatore di concorrenza: chiave separata `rentri:concurrency:{tenantId}` (intero con TTL di sicurezza — es. 60s — per non restare bloccato per sempre se un processo muore senza rilasciare).

- [ ] **Step 2: Test di dominio puro**

`acquisisci(tenantId)` → restituisce un permesso (con `rilascia()`) o `null`/attesa secondo la policy. Casi: sotto soglia → concesso subito; a soglia → attende fino a quando scorre la finestra; concorrenza a 3 → il quarto attende il rilascio di uno dei tre. Test con Redis reale (non mockato: è comportamento temporale, un mock nasconderebbe bug di race).

- [ ] **Step 3: Cablaggio nel modulo**

`RentriRateLimiterService` esportato da `RentriModule`. Non tocca `RENTRIApiClient` in questo task — l'aggancio è il Task 2.

- [ ] **Step 4: Commit**

---

### Task 2: Applicare il limitatore senza sovrapporlo alla resilienza esistente

Il punto delicato: il limitatore preventivo, la resilienza per-chiamata (client) e la resilienza per-operazione (dominio) devono restare **tre strati separati**, non fondersi.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`
- `apps/backend/src/infrastructure/rentri/rentri-api.client.spec.ts`
- `apps/backend/src/infrastructure/rentri/rentri-api.client.resilienza.oracolo.spec.ts`

- [ ] **Step 1: Decidere e motivare il punto di aggancio**

Il limitatore si applica **prima** di ogni tentativo HTTP effettivo (dentro `eseguiRichiestaConResilienza`/`interrogaStatoTransazione`/`leggiEsitoTransazione`, non attorno all'intera operazione di dominio): un'operazione che consuma 5 tentativi di resilienza deve consumare 5 unità del budget del limitatore, non 1 — altrimenti il limitatore non vede il traffico reale generato dai retry, che è esattamente il traffico che rischia di superare la soglia dell'ente.

- [ ] **Step 2: Test — nessuna sovrapposizione di responsabilità**

Un test esplicito che documenta la separazione: iniettando un 429 dall'oracolo, il client deve ancora rispettare `Retry-After` come già fa (comportamento R1/R2 invariato) — il limitatore preventivo non deve MAI impedire di onorare un `Retry-After` reale ricevuto dall'ente (sarebbe un secondo livello di attesa sopra uno già corretto). Verificare che il limitatore intervenga solo quando il traffico *nostro* si avvicina alla soglia, non quando l'ente ha già risposto.

- [ ] **Step 3: Metrica di attesa preventiva**

Nuovo campo su `MetricsService`: `rentriRateLimiterWaitSeconds` (Histogram, label `tenant_id`) — quanto tempo un'operazione ha atteso il limitatore prima di partire. Distinto da `rentriApiErrors`: qui non c'è stato nessun errore, è un'attesa voluta.

- [ ] **Step 4: Commit**

---

### Task 3: Diagnostica per l'utente — solo dati locali

**Il vincolo che decide questo task**: la diagnostica **non interroga RENTRI a ogni caricamento di pagina** — sarebbe essa stessa la causa del ban che deve prevenire. Tutto ciò che la pagina mostra viene da dati già raccolti da altri processi (trasmissioni, riconciliazione del Task 4, credenziale salvata), mai da una chiamata live scatenata dalla navigazione dell'utente.

**Files:**
- Backend: `apps/backend/src/api/rentri/rentri-diagnostica.controller.ts` (nuovo), query read-only su `RENTRISyncLog` + `RentriCredential` + FIR in stato che richiede attenzione
- Frontend: `apps/frontend/src/app/features/rentri/rentri-diagnostica.component.ts` (nuovo), montato in `/rentri/diagnostica`

- [ ] **Step 1: Cosa mostra**

- **Certificato**: valido/non valido, **scadenza** (va estratta dal certificato X.509 già salvato in `RentriCredentialService` — parsing locale della data `notAfter`, non una chiamata a RENTRI) con avviso a 30/15/7 giorni prima (coerente con gli intervalli già usati da `DeadlineCheckerService` per il MUD, stesso linguaggio del prodotto).
- **Ultime trasmissioni**: dalla tabella `RENTRISyncLog` già esistente (R0/R1), non da una nuova interrogazione dell'ente.
- **Formulari che richiedono intervento**: quelli `PERMANENTLY_FAILED` o in attesa di conferma legame (modalità IBRIDA) — query locale sui FIR del tenant.
- **Stato del limitatore** (Task 1): se il tenant sta attualmente attendendo per limite di velocità/concorrenza, dirlo («RENTRI sta ricevendo molte richieste in questo momento, l'automazione rallenta da sola») — non un dettaglio tecnico, è la spiegazione di un eventuale ritardo che l'utente altrimenti scambierebbe per un guasto.

- [ ] **Step 2: Autorizzazione**

Tenant-scoped, stesso principio di R1 Task 4 (404 non 403 su risorsa di altro tenant, nessuna fuga di esistenza). Solo ruoli con visibilità sull'area RENTRI (ADMIN/SUPER_ADMIN/OPERATOR, coerente con R1).

- [ ] **Step 3: `data-testid` e italiano**

`rentri-diagnostica-certificato-scadenza`, `rentri-diagnostica-trasmissioni-recenti`, `rentri-diagnostica-formulari-attenzione`, `rentri-diagnostica-limitatore-stato`.

- [ ] **Step 4: Test**

Backend: verificare che l'endpoint non generi **nessuna** chiamata a `RENTRIApiClient` (spy/mock che fallisce il test se invocato). Frontend: componente monta e mostra i dati senza polling automatico (nessun `interval`/`setInterval` verso l'endpoint — un refresh è un'azione esplicita dell'utente, un bottone, non un timer).

- [ ] **Step 5: Commit**

---

### Task 4: Riconciliazione periodica

**Perché serve**: uno stato locale (`RENTRISyncStatus`, `rentriNumeroFir`) può divergere da quello dell'ente — trasmissione persa, operazione fatta sul portale da un collega, formulario annullato altrove.

**Frequenza proposta: ogni 6 ore (4 esecuzioni al giorno), per tenant.** Motivazione: le divergenze rilevanti (operazione fatta sul portale, trasmissione persa) nascono da eventi umani o di manutenzione, non da un processo che cambia stato ogni minuto — un ritardo di poche ore prima di rilevarle è accettabile per un dato che oggi non viene riconciliato affatto. Un intervallo più corto (es. ogni 15 minuti, 96 volte/giorno) non cambierebbe l'esperienza utente in modo percepibile ma moltiplicherebbe per 24 il traffico verso l'ente per un beneficio che non esiste finché l'utente non è in una pagina che dipende da quel dato aggiornato — e quella pagina (Task 3) non aspetta comunque la riconciliazione, legge l'ultimo risultato noto.

**Ambito per esecuzione, per non martellare l'ente:** non l'intero archivio del tenant, solo i FIR in uno stato **ambiguo**:
- `SYNCING` da più del doppio del tempo massimo di polling atteso (`MAX_TENTATIVI_POLLING_DEFAULT * INTERVALLO_POLLING_DEFAULT_MS` = 60s → soglia 120s): la transazione locale potrebbe essere bloccata su un worker morto senza che l'errore sia mai stato scritto.
- `SYNCED` con `numero_fir` noto, **campionati** (max 20 per tenant per esecuzione, i meno recentemente verificati) — non tutti: un tenant con centinaia di formulari sincronizzati non giustifica centinaia di `GET /{numero_fir}` ogni 6 ore. A 20 formulari/6h per tenant, anche un tenant con 500 FIR sincronizzati viene ricontrollato per intero in 6,25 giorni: sufficiente per un controllo di igiene, non per un allineamento in tempo reale (che non è l'obiettivo).
- FIR in attesa di conferma legame (modalità IBRIDA) da più di 24 ore: potrebbero essere stati agganciati o annullati altrove nel frattempo.

Ogni FIR controllato costa **una** chiamata (`GET /{numero_fir}`), mai un'interrogazione con filtro ampio (`GET /` senza `numero_fir` specifico) che tornerebbe più dati di quanti servano.

**Cosa fa quando trova una divergenza — decisione e motivazione:**

- **Corregge da sola** quando la correzione è **quella che il nostro stesso sistema avrebbe scritto in caso di successo** — cioè riempie un buco, non sovrascrive un valore in cui il sistema ha già fiducia. Esempio: locale `SYNCING` bloccato, l'ente mostra il formulario creato con un `numero_fir` → si applica `markAsSynced(numeroFir)` esattamente come farebbe il flusso normale, con una nota nel log di sincronizzazione («riconciliato: la transazione risultava bloccata localmente ma l'ente aveva già completato l'elaborazione»).
- **Segnala, non corregge**, quando la divergenza implica **sovrascrivere un dato in cui il sistema locale ha già fiducia**, o quando la causa è ambigua: `numero_fir` locale diverso da quello letto dall'ente sullo stesso FIR interno; `stato_formulario` che indica un annullamento o un cambiamento non originato da WasteFlow; l'ente non trova affatto un FIR che localmente risulta sincronizzato. Questi casi finiscono nella lista «formulari che richiedono intervento» del Task 3 con il dettaglio della divergenza, mai applicati automaticamente: sono dati potenzialmente rilevanti in caso di contestazione (stesso principio di tracciabilità già adottato per l'aggancio manuale in R2), e un auto-fix sbagliato qui sarebbe peggiore del problema.

**Files:**
- `apps/backend/src/application/rentri/riconcilia-stato-rentri.use-case.ts` (nuovo)
- `apps/backend/src/application/rentri/riconcilia-stato-rentri.use-case.spec.ts` (nuovo)
- `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.ts` (nuovo, `@Cron` ogni 6 ore — pattern già in uso in `apps/backend/src/application/notifications/deadline-checker.service.ts`)
- `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.spec.ts` (nuovo)

- [ ] **Step 1: Selezione del lotto**

Query che produce i tre insiemi sopra, con i limiti numerici dichiarati. Test: un tenant con 500 FIR sincronizzati produce al massimo 20 controlli, non 500.

- [ ] **Step 2: Confronto e classificazione**

Per ogni FIR del lotto, `leggiFormulario` (passa dal limitatore del Task 1 e dalla resilienza del client — nessun bypass) e confronto con lo stato locale. Test per ciascuno dei casi «corregge» e «segnala» sopra descritti.

- [ ] **Step 3: Applicazione e log**

La correzione automatica passa dagli stessi metodi di dominio (`markAsSynced`) usati dal flusso di trasmissione — non un percorso di scrittura parallelo. Ogni esito (corretto, segnalato, nessuna divergenza) produce una riga in `RENTRISyncLog` con origine `RICONCILIAZIONE`, distinguibile da una trasmissione.

- [ ] **Step 4: Cron e isolamento per tenant**

Un tenant con errori (es. credenziale scaduta, già rilevato) non deve bloccare la riconciliazione degli altri: try/catch per tenant, non per l'intero job.

- [ ] **Step 5: Commit**

---

### Task 5: Allarmi — riuso di Prometheus/MetricsService

Nessun meccanismo nuovo: `MetricsService` (`apps/backend/src/core/metrics/metrics.service.ts`) e `monitoring/prometheus.yml` esistono già; qui si aggiungono le metriche mancanti e si accende il punto di aggancio delle regole (`rule_files`, oggi commentato).

**Cosa deve svegliare qualcuno, e perché:**

1. **Certificato in scadenza** — 30/15/7 giorni (stessi intervalli del Task 3 e di `DeadlineCheckerService`, per coerenza di prodotto: un allarme e un avviso in UI con soglie diverse confonderebbero).
2. **Tenant bandito (423 confermato, non isolato)** — un singolo 423 può essere transitorio (l'ente lo dichiara anche per condizioni temporanee); l'allarme scatta su **3 o più 423 nella stessa finestra di 1 ora per lo stesso tenant**, soglia che distingue un incidente isolato da un pattern persistente, senza aspettare che l'azienda scopra da sola di essere bloccata.
3. **Coda RENTRI che non smaltisce** — `queueDepth{queue_name="rentri-sync"}` sopra **50** per più di **15 minuti consecutivi**: 50 è già un multiplo della soglia di rate limiting per tenant (Task 1, 30 richieste/5s → un tenant smaltisce quell'ordine di grandezza in pochi secondi in condizioni normali); 15 minuti esclude un picco temporaneo (es. importazione massiva) da un blocco reale (worker fermo, credenziale rotta su più tenant).

**Files:**
- `apps/backend/src/core/metrics/metrics.service.ts` (nuove metriche)
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (emettere le nuove metriche nei punti già esistenti, non nuovi percorsi)
- `apps/backend/src/infrastructure/jobs/rentri-certificato-scadenza.job.ts` (nuovo, `@Cron` giornaliero — un controllo di scadenza più frequente di 1/giorno non ha senso: la scadenza si muove di giorni, non di minuti)
- `monitoring/alerts/rentri.yml` (nuovo)
- `monitoring/prometheus.yml` (decommentare `rule_files`)

- [ ] **Step 1: Nuove metriche**

- `rentriCertificateExpiryDays` (Gauge, label `tenant_id`) — aggiornata dal job giornaliero, calcolata dalla stessa data `notAfter` del Task 3 (stessa fonte, non una seconda logica di parsing).
- `rentriTenantLocked` (Gauge, label `tenant_id`, 0/1) — impostata a 1 quando il client riceve un 423 (in `gestisciRispostaNonPrevista`, dove il 423 è già riconosciuto), tornata a 0 alla prima risposta non-423 successiva dello stesso tenant.
- `rentriReconciliationDivergences` (Counter, label `tenant_id`, `esito` = `corretto`/`segnalato`) — incrementata dal Task 4.

- [ ] **Step 2: Test**

Un test per metrica: il job di scadenza imposta il gauge coerente con una data nota; il client imposta `rentriTenantLocked=1` su 423 (verificabile iniettando il guasto contro l'oracolo) e lo riporta a 0 al tentativo successivo riuscito.

- [ ] **Step 3: Regole di allarme**

`monitoring/alerts/rentri.yml`: le tre soglie sopra, come espressioni PromQL (`rentriCertificateExpiryDays < 30`, `increase(wasteflow_rentri_api_errors_total{error_type="LOCKED"}[1h]) >= 3` — verificare che il client tagghi il 423 con un `error_type` distinguibile, es. `LOCKED`, e non lo confonda con `HTTP` generico come oggi in `gestisciRispostaNonPrevista`, `wasteflow_queue_depth{queue_name="rentri-sync"} > 50` con `for: 15m`).

- [ ] **Step 4: Commit**

---

### Task 6: Verifica contro l'oracolo con guasti iniettati

L'oracolo (`tools/rentri-fake`) sa iniettare `POST /__controllo/guasto` con `{ stato, volte }`: è lo strumento con cui si verifica 429/423/5xx senza toccare l'ente reale.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-rate-limiter.oracolo.spec.ts` (nuovo)
- Estensioni a `apps/backend/src/infrastructure/rentri/rentri-api.client.resilienza.oracolo.spec.ts`
- `apps/backend/src/application/rentri/riconcilia-stato-rentri.oracolo.spec.ts` (nuovo)

- [ ] **Step 1: Limitatore sotto carico reale**

Lanciare più chiamate concorrenti verso l'oracolo per lo stesso tenant (senza guasti iniettati) e verificare che il limitatore le scagliona restando sotto le 30/5s e le 3 concorrenti — non un test del mock del limitatore, un test che misura le chiamate HTTP realmente arrivate all'oracolo nella finestra.

- [ ] **Step 2: 429 con `Retry-After` iniettato**

`POST /__controllo/guasto {stato: 429, volte: 2}` seguito da una chiamata del client: verificare che il tempo di attesa totale rispetti l'header e che il limitatore preventivo non l'abbia già consumato/alterato (Task 2, Step 2).

- [ ] **Step 3: 423 iniettato — verifica dell'allarme**

`POST /__controllo/guasto {stato: 423, volte: 3}` nella stessa finestra oraria: verificare che `rentriTenantLocked` passi a 1 e che la condizione dell'allarme (Task 5) sia soddisfatta dall'espressione PromQL su un `/metrics` reale (non solo sul valore del gauge in memoria).

- [ ] **Step 4: Riconciliazione contro un formulario popolato ad hoc**

Usare `POST /__controllo/formulario` (canale di controllo, v. `FEDELTA.md` §6.1 punto 7) per popolare un FIR con `numero_fir` noto sull'oracolo, impostare localmente uno stato `SYNCING` bloccato, eseguire il caso d'uso di riconciliazione e verificare la correzione automatica end-to-end. Ripetere con uno stato che deve **solo segnalare** (es. `numero_fir` locale diverso da quello letto) e verificare che NON venga scritto nulla di automatico sull'aggregate, solo la riga di log/segnalazione.

- [ ] **Step 5: Suite complete**

Backend, oracolo, frontend — nessuna cala rispetto alla baseline dichiarata.

- [ ] **Step 6: Commit**

---

## Criteri di completamento di R5

- [ ] Nessuna chiamata verso RENTRI, in nessun percorso di questo piano, ignora il limitatore per-tenant del Task 1.
- [ ] I tre strati di resilienza (limitatore preventivo, client, dominio) restano distinti e non si sovrappongono: verificato da un test esplicito.
- [ ] L'area `/rentri/diagnostica` mostra certificato+scadenza, trasmissioni recenti, formulari che richiedono attenzione — **senza generare una sola chiamata a RENTRI al caricamento**.
- [ ] La riconciliazione gira ogni 6 ore, per lotti limitati (≤20 FIR sincronizzati/tenant/esecuzione + stati ambigui), corregge solo ciò che il sistema avrebbe scritto da solo, segnala il resto.
- [ ] Gli allarmi su certificato in scadenza, tenant bandito e coda ferma sono regole Prometheus attive su metriche di `MetricsService`, non un meccanismo nuovo.
- [ ] Ogni parametro numerico introdotto (30/5s, 3 concorrenti, 6 ore, 20 FIR/lotto, 3×423/1h, 50 job/15min) è documentato nel codice con la motivazione, non solo il valore.
- [ ] `data-testid` presenti su tutto ciò che è nuovo.
- [ ] Le tre suite restano verdi, oracolo compreso con i guasti del Task 6.

## Ciò che R5 non fa

- Non implementa un ricorso o una procedura per uscire da un 423 reale (dipende dall'ente, fuori dal controllo applicativo): l'allarme serve a scoprirlo presto, non a risolverlo automaticamente.
- Non riconcilia in tempo reale: un utente che ha bisogno di sapere lo stato più recente di UN formulario specifico usa l'azione esplicita già prevista (dettaglio FIR, R1 Task 4), non aspetta il ciclo di 6 ore.
- Non introduce un limitatore globale cross-tenant: ogni tenant ha certificato e rischio di ban distinti, un limite condiviso penalizzerebbe tenant sani per il comportamento di altri.
- Non tocca la validazione dei modelli dati di scrittura né il valore legale della firma: riserve note (`FEDELTA.md`), fuori ambito di questa fase.
