# WasteFlow — Workflow di agenti per il raggiungimento del production ready

**Data:** 2026-07-25
**Baseline:** `develop` @ `2a93931`
**Stato:** design approvato, da trasformare in piano operativo

---

## 1. Obiettivo e definizione di "fatto"

Portare WasteFlow a **software completo e verificabile**, con le dipendenze esterne simulate ma sostituibili senza riscritture.

Concretamente: il codice è corretto e conforme alle specifiche ufficiali, validato end-to-end contro una fake API RENTRI fedele e provider di firma simulati dietro interfaccia. Quando arriveranno il certificato RENTRI e il contratto QTSP, si cambia configurazione — **non si cambia codice**.

**Fuori perimetro** (dipendenze non controllabili dal software): contratto con un QTSP per la firma qualificata, accreditamento e certificato RENTRI di produzione, credenziali dell'ambiente demo.

### Criteri di uscita

Il programma è concluso quando, **con evidenza allegata** per ciascun punto:

1. Tutti i difetti degli audit del 2026-07-25 sono chiusi, oppure esplicitamente rinviati con motivazione scritta.
2. Il client RENTRI supera il banco di prova contro la fake fedele, **inclusi i casi di rifiuto** (non basta che i casi felici passino).
3. La firma del ciclo di vita FIR è crittografica, persistita e verificabile dopo un reload della pagina.
4. La sessione singola per utente è attiva.
5. Il sottosistema RBAC granulare è in esercizio, oppure rimosso con ADR motivato.
6. La UAT autenticata gira davvero (non `skip`).
7. I due gate CI sono allineati fra loro e verdi.

---

## 2. Contesto di partenza

Fonti: `docs/audits/uat-2026-07-25/` e `docs/audits/rentri-conformita-2026-07-25/`.

| Area | Stato accertato |
|---|---|
| RENTRI | 2 funzionalità conformi su 35. L'autenticazione implementata (OAuth2 verso `/token`) **non esiste in RENTRI**: la prima chiamata reale prenderebbe 404 |
| Firma | Nessuna firma con valore legale. Il ciclo FIR "firma" con una costante mai persistita: le firme evaporano al reload |
| Sicurezza | 17 difetti già corretti su `develop` ma **attivi in produzione** (`master`), 3 critici |
| Autenticazione | Sessione singola non implementata: chiave Redis per token anziché per utente |
| RBAC granulare | Sottosistema `@RequirePermission`/`PermissionGuard` orfano per un bug di injection CQRS — codice morto |
| Qualità | Coverage ~35% contro soglia dichiarata 80%; gate CI divergenti |

**Scadenza normativa rilevante:** 15/09/2026 — fine del doppio binario cartaceo e decorrenza delle sanzioni sulla trasmissione dati FIR.

---

## 3. Principio architetturale

**Gli agenti non si parlano: scrivono e leggono artefatti di contratto versionati nel repo.**

Un implementatore non riceve istruzioni a voce da un altro agente — legge lo schema OpenAPI, lo schema xFIR, l'ADR. Se due agenti divergono, divergono da un documento, e la divergenza è visibile in un diff.

Il corollario operativo: **si costruisce prima l'oracolo, poi il codice che deve soddisfarlo.** L'esecuzione è autonoma, e un agente autonomo senza oracolo esterno valuta il proprio lavoro. Su materia normativa questo è esattamente il meccanismo che ha prodotto lo stato attuale — l'integrazione RENTRI è stata scritta contro un'API immaginata. La fake API fedele è l'oracolo che rende l'autonomia sicura anziché temeraria.

---

## 4. Organico degli agenti

### 4.1 Fase 0 — Il nucleo (blocca le pipeline di dominio)

| Agente | Specializzazione | Produce |
|---|---|---|
| Ricognitore normativo | OpenAPI ufficiali `demoapi.rentri.gov.it/docs/{api}/v1.0`, DM 59/2023, DD 143, AgID ID_AUTH_REST_02 / INTEGRITY_REST_01 | `docs/contracts/rentri/` — OpenAPI **scaricati, non parafrasati** |
| Costruttore fake RENTRI | Node/NestJS + crittografia applicata | `tools/rentri-fake/` |
| **Auditor di fedeltà** ⚔️ | Avversariale, **agente diverso dal costruttore** | Tabella di fedeltà endpoint per endpoint + divergenze |
| Costruttore banco di prova | Playwright + docker compose | Estensione di `e2e/` con ambiente RENTRI locale |

### 4.2 Custode dei contratti (trasversale)

Unico agente autorizzato a modificare `docs/contracts/`. Ogni pipeline che vuole cambiare un contratto passa da lui. Impedisce che quattro cantieri autonomi ridefiniscano ciascuno la propria versione di verità.

### 4.3 Pipeline di dominio

Ognuna a quattro stadi: **specialista di dominio → implementatore → verificatore avversariale → gate**.

| Pipeline | Ambito | Dipende da |
|---|---|---|
| **P1 Sicurezza e rilascio** | Promozione `develop`→`master`, difetti aperti, Swagger, header nginx, sessione singola, hardening auth | — |
| **P2 RENTRI** | Auth ID_AUTH_REST_02, path dagli OpenAPI, xFIR ASiC-E/XAdES-B, asincronia NONBLOCK_PULL, QR ISO 18004 | nucleo |
| **P3 Firma** | Flusso crittografico persistito, documento canonico completo, QES/TSA dietro interfaccia | P2 |
| **P4 RBAC granulare** | ADR "riparare o rimuovere", poi esecuzione della decisione | P1 |
| **P5 Qualità** | Coverage, allineamento gate CI, destino di Cypress, UAT autenticata | tutte |

### 4.4 Assegnazione dei modelli

- Specialisti e implementatori: **Sonnet**.
- Ogni **gate** di fine pipeline e ogni verifica avversariale su materia critica: **Opus 5**.
- Coordinamento e revisione finale: **Opus 5**.

Nessuna pipeline dichiara "fatto" da sola.

---

## 5. La fake API RENTRI

Servizio containerizzato in `tools/rentri-fake/`, **sostituisce** l'attuale segnaposto `rentri-mock` di `docker-compose.yml`.

**Ragione d'essere: rifiutare ciò che RENTRI rifiuterebbe.** Un mock che dice sempre sì non è un banco di prova.

### 5.1 Cosa verifica

1. **Autenticazione ID_AUTH_REST_02** — risponde **404 a `/token`** (dimostrazione vivente del difetto attuale). Sul canale corretto pretende `Authorization: Bearer <JWT self-issued>` e verifica: firma con la chiave pubblica estratta da `x5c`, `aud` esattamente `rentrigov.demo.api`, `iss`/`sub` coerenti col certificato, `iat`/`exp` in finestra. JWT malformato → 401 con il corpo d'errore degli OpenAPI ufficiali.
2. **Integrità INTEGRITY_REST_01** — ricalcola il digest RFC 3230 del corpo e la firma JWS del payload. Corpo alterato dopo la firma → 400.
3. **Validità dell'xFIR** — apre il container **ASiC-E**, verifica firme **XAdES Baseline-B detached** e applica la regola di copertura: *ogni firma deve referenziare tutti gli XML già presenti nel container*. Nessun altro strumento a nostra disposizione coglie questo errore.
4. **Asincronia NONBLOCK_PULL** — restituisce un identificativo di elaborazione e obbliga il client al polling, così il codice non può assumere che l'operazione sia sincrona.
5. **Iniezione deterministica di guasti** — canale di controllo per forzare 429, 503, timeout, elaborazione asincrona fallita.

### 5.2 Come si dimostra fedele

- Ricognitore e costruttore sono **agenti diversi**; il costruttore lavora solo sugli OpenAPI scaricati.
- L'**auditor di fedeltà** produce una tabella endpoint per endpoint (presente/assente, schema conforme/divergente, codici d'errore allineati) cercando dove la fake è **più permissiva** del vero.
- **Test di autoverifica**: per ogni regola, un caso che deve passare **e** un caso che deve essere respinto. Una fake che accetta tutto fallisce i propri test.

### 5.3 Aggancio all'applicazione

Il client punta a `RENTRI_BASE_URL` configurabile: fake in locale e in CI, `demoapi.rentri.gov.it` quando saranno disponibili le credenziali demo, produzione ad accreditamento avvenuto. **Nessun ramo condizionale nel codice applicativo**: il codice non deve sapere con chi sta parlando, altrimenti la validazione non prova nulla.

### 5.4 Limite dichiarato

La fake dimostra che **il client è conforme alle specifiche pubblicate**, non che l'ente si comporti come le pubblica. È il massimo ottenibile senza ambiente reale — molto più di oggi, ma non la stessa cosa.

---

## 6. Esecuzione

### 6.1 Isolamento

Ogni pipeline lavora su un **worktree git separato**, branch `feat/prod-ready/<pipeline>`.

Sopra l'isolamento fisico, una **proprietà esclusiva dichiarata**: ogni pipeline riceve l'elenco dei percorsi modificabili. I percorsi contesi — i controller FIR, toccati da P2, P3 e P4 — appartengono a **una sola pipeline per volta, in sequenza**. Un implementatore che tocca un file fuori dal proprio elenco fallisce il gate.

### 6.2 Il gate di fine pipeline

Gira su Opus 5 e pretende **evidenze, non affermazioni**:

- i test citati sono stati eseguiti e l'output è allegato;
- le modifiche stanno dentro i percorsi assegnati;
- le affermazioni di conformità sono ricontrollate contro il contratto, non contro il messaggio di commit;
- ciò che non è stato fatto è dichiarato come non fatto.

Un gate può respingere e rimandare indietro la pipeline con una lista di rilievi. È il meccanismo che sostituisce i checkpoint umani, che per scelta esplicita non ci sono.

### 6.3 Gestione degli errori degli agenti

| Modo di fallire | Risposta |
|---|---|
| Agente non completa (errore, timeout) | La pipeline riparte **da quello stadio** con il contesto già prodotto, non da capo |
| Risultato non riproducibile dal gate | **Scartato**, non declassato in silenzio |
| Due pipeline divergono su un contratto | Decide il **custode dei contratti** con ADR scritto; le pipeline si riallineano |

Al termine del programma gira un **critico di completezza**: unico compito, chiedersi cosa non è stato guardato — quale requisito normativo non ha un test, quale endpoint non è coperto, quale affermazione è rimasta senza evidenza. Ciò che trova diventa l'ultimo giro di lavoro.

### 6.4 Sequenza

```
Fase 0   nucleo: contratti ufficiali → fake RENTRI → auditor di fedeltà → banco di prova
Fase 1   P1 sicurezza e rilascio        (in parallelo al nucleo: non dipende da RENTRI)
Fase 2   P2 RENTRI                      (valida contro la fake)
Fase 3   P3 firma                       (l'xFIR definisce cosa si firma)
Fase 4   P4 RBAC granulare              (ADR → riparare o rimuovere)
Fase 5   P5 qualità                     (coverage, gate CI, UAT autenticata)
         critico di completezza → checklist di uscita → 🛑 GATE UMANO → deploy
```

P1 parte **in parallelo al nucleo**: è l'unica pipeline indipendente da RENTRI e contiene i tre difetti critici oggi attivi in produzione. Far attendere la chiusura di una falla di sicurezza al completamento di un contratto OpenAPI non avrebbe senso.

### 6.5 Punti di fermata umana

L'esecuzione è autonoma, con **due sole eccezioni**:

1. **Il deploy in produzione** — unica azione irreversibile che tocca utenti reali.
2. **La decisione sulla sessione singola** — cambia il comportamento di login per gli utenti già attivi.

---

## 7. Voci puntuali da non perdere

Difetti minori accertati che non hanno una pipeline propria e rischiano di cadere fra le maglie:

- **Tipo che mente su `signature.service.ts`** (frontend, righe 227-228 e 250-251): dichiara `signerFiscalCode` e `signerName` come non opzionali, mentre dopo il fix GDPR l'endpoint pubblico `GET /fir/:id/verify` non li restituisce più. I due soli consumatori (`features/verify/verify-signatures/` e `features/fir/signature-status/`) sono **entrambi componenti orfani**, quindi non c'è regressione in atto — ma chi li monterà in futuro troverà un tipo falso. Rendere i campi opzionali e gestire l'assenza nei template. → **P3**
- **Componenti orfani**: `verify-signatures` e `signature-status` non sono instradati né importati. Decidere se collegarli o rimuoverli. → **P3**
- **12 controller orfani su 36**, oltre al sottosistema permessi. Inventario in `docs/audits/uat-2026-07-25/01-api-surface.md`. → **P4**
- **Swagger pubblico in produzione** (`/api/docs-json`, 52 KB). → **P1**
- **Due test E2E in `fixme`** (`e2e/tests/public/security-headers.spec.ts`, `swagger-exposure.spec.ts`): esprimono il requisito corretto e vanno riattivati quando i rispettivi fix sono in produzione. → **P1**
- **`data-testid` in 6 componenti su 64**: debito elencato in `e2e/SELECTORS-DEBT.md`, da colmare per rendere stabile la UAT autenticata. → **P5**
- **Credenziali UAT**: senza di esse la parte autenticata della suite resta in `skip`. Dipendenza esterna da sollecitare. → **P5**

---

## 8. Rischi

| Rischio | Contromisura |
|---|---|
| La fake API è più permissiva del vero → valida errori con sicurezza | Auditor di fedeltà separato dal costruttore; test di autoverifica con casi di rifiuto obbligatori |
| Tre pipeline toccano gli stessi controller FIR | Worktree separati + proprietà esclusiva dei percorsi, sequenziale sui file contesi |
| Esecuzione autonoma su materia normativa | Oracolo esterno (fake) + gate su Opus che ricontrolla contro il contratto, mai contro l'affermazione dell'agente |
| Deriva fra contratti e implementazioni | Custode dei contratti come unico scrittore di `docs/contracts/` |
| Scadenza 15/09/2026 | P1 parte subito e in parallelo; P2 è la pipeline più lunga e va avviata appena il nucleo è pronto |
| Il programma "finisce" senza che nessuno noti i buchi | Critico di completezza obbligatorio prima della checklist di uscita |
