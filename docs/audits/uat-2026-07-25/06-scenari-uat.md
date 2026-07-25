# Piano di test di accettazione utente (UAT) — WasteFlow

- **Data**: 2026-07-25
- **Prodotto**: WasteFlow (rifiuti) — SaaS gestione rifiuti multi-tenant (FIR, registro art. 190, MUD, RENTRI, CER, giacenze, contratti, ESG)
- **Basato su**: `01-api-surface.md`, `02-frontend-flows.md`, `05-test-coverage-ci.md`, `04-gap-prod-develop.md` (stessa cartella audit)
- **Uso previsto**: validazione manuale con cliente/PO prima di ogni rilascio maggiore; base per l'automazione Playwright/Cypress (agente parallelo)

## Come leggere questo documento

- Ogni scenario ha un ID univoco `UAT-<AREA>-<NN>`, priorità **P0** (blocco rilascio se fallisce) → **P2** (da coprire ma non bloccante), e un marcatore ambiente:
  - **[SICURO IN PRODUZIONE]** — eseguibile su `https://rifiuti.ignicraft.com` senza rischio, o con effetti reversibili/isolati a dati di test dedicati.
  - **[SOLO AMBIENTE DI TEST]** — da eseguire **solo** su staging/locale con dati seed, mai su produzione: include backup create/restore/cleanup, cancellazioni di anagrafiche esistenti, cambio stato tenant (sospensione), reseed reference data, annullamento FIR, cancellazione credenziali RENTRI, invii reali verso RENTRI, email verso indirizzi reali.
- I "Passi" sono azioni utente osservabili in UI (click, digitazione, navigazione), non chiamate API dirette — dove serve verificare un comportamento di rete (es. header `X-Tenant-ID`), il passo lo segnala esplicitamente come verifica strumentale (DevTools/Playwright), ma resta descritto dal punto di vista dell'utente che compie l'azione.
- Riferimenti a difetti noti (`04-gap-prod-develop.md`) sono citati esplicitamente negli scenari di regressione: su **produzione (master)** ci si aspetta di *osservare* il difetto (se non ancora promosso `develop`→`master`); su **ambiente di test (develop/staging)** ci si aspetta il comportamento *corretto*. Ogni scenario di regressione dichiara quale esito è atteso in quale ambiente.
- Priorità area per area segue la matrice di rischio di `05-test-coverage-ci.md` (§5).

## Indice aree (ordine di priorità)

| # | Area | Priorità area | Scenari |
|---|------|---------------|---------|
| 1 | Autenticazione (SPID/Keycloak) | P0 | UAT-AUTH-01 … 08 |
| 2 | RBAC per ruolo e navigazione diretta | P0 | UAT-RBAC-01 … 11 |
| 3 | Isolamento multi-tenant e tenant switch | P0 | UAT-TEN-01 … 07 |
| 4 | FIR — ciclo di vita completo | P0 | UAT-FIR-01 … 15 |
| 5 | RENTRI (firma, sync, credenziali) | P0 | UAT-RENTRI-01 … 06 |
| 6 | Amministrazione tenant/utenti (SUPER_ADMIN) | P0 | UAT-ADMIN-01 … 09 |
| 7 | Registro cronologico art. 190 | P1 | UAT-REG-01 … 05 |
| 8 | Anagrafiche (produttori/trasportatori/destinatari) | P1 | UAT-ANA-01 … 07 |
| 9 | MUD | P1 | UAT-MUD-01 … 05 |
| 10 | CER | P1 | UAT-CER-01 … 04 |
| 11 | Notifiche | P1 | UAT-NOTIF-01 … 04 |
| 12 | Backup e ripristino | P1 | UAT-BACKUP-01 … 04 |
| 13 | Dashboard | P1 | UAT-DASH-01 … 02 |
| 14 | Giacenze | P2 | UAT-GIAC-01 … 03 |
| 15 | Contratti | P2 | UAT-CONTR-01 … 04 |
| 16 | ESG / CO2 | P2 | UAT-ESG-01 … 02 |
| 17 | Anomalie | P2 | UAT-ANOM-01 … 02 |
| 18 | Billing / Abbonamento | P2 | UAT-BILL-01 … 04 |

Totale: **86 scenari**.

---

## 1. Autenticazione (SPID/Keycloak) — P0

### UAT-AUTH-01 — Login SPID completo (percorso felice)
- **Attore/Ruolo**: qualsiasi utente registrato (es. OPERATOR)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente con credenziali SPID/CIE valide su Keycloak, nessuna sessione attiva (browser in incognito o logout preventivo)
- **Passi**:
  1. Aprire `https://rifiuti.ignicraft.com/login`.
  2. Cliccare sul bottone "Accedi".
  3. Completare l'autenticazione sull'IdP esterno (Keycloak/SPID).
  4. Attendere il rientro automatico nell'applicazione.
- **Risultato atteso**: l'utente atterra su `/dashboard` autenticato, con nome/ruolo visibili nel menu utente; l'URL non contiene più i token (fragment ripulito).
- **Criteri di accettazione**: nessun token visibile in URL dopo il redirect; dashboard mostra dati coerenti col proprio tenant; refresh della pagina mantiene la sessione.
- **Note/rischi**: verificare che l'IdP di test sia raggiungibile; se il login fallisce, controllare prima la configurazione Keycloak prima di aprire un difetto applicativo.

### UAT-AUTH-02 — Deep-link su rotta protetta senza sessione → redirect a login → ritorno alla rotta originale
- **Attore/Ruolo**: utente non autenticato
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna sessione attiva
- **Passi**:
  1. Con browser senza sessione, navigare direttamente a `https://rifiuti.ignicraft.com/fir` (URL diretto, non tramite menu).
  2. Osservare il redirect a `/login?returnUrl=/fir`.
  3. Completare il login SPID.
- **Risultato atteso**: dopo il login, l'utente dovrebbe tornare a `/fir` (la pagina richiesta originariamente).
- **Criteri di accettazione**: l'utente atterra su `/fir`, non su `/dashboard`.
- **Note/rischi**: **scenario di regressione noto** (`02-frontend-flows.md` §5.9) — `AuthCallbackComponent` naviga sempre e comunque a `/dashboard`, ignorando `returnUrl`, perché il flusso SPID reale passa dal callback e non dal componente login legacy che legge `returnUrl`. Ci si attende che questo test **fallisca** oggi (atterraggio su `/dashboard`); segnalarlo come bug UX di priorità media da correggere, non bloccante per il rilascio ma da tracciare.

### UAT-AUTH-03 — Sessione persistente al refresh di pagina
- **Attore/Ruolo**: qualsiasi utente autenticato
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: sessione attiva su `/dashboard`
- **Passi**:
  1. Da una pagina qualsiasi (es. `/fir`), premere F5 (ricarica browser completa).
- **Risultato atteso**: l'utente resta autenticato sulla stessa pagina, nessun redirect a `/login`.
- **Criteri di accettazione**: dati della pagina ricaricati correttamente, nessuna richiesta di nuovo login.
- **Note/rischi**: nessuno, comportamento atteso da `initializeAuth()`.

### UAT-AUTH-04 — Refresh automatico del token su scadenza
- **Attore/Ruolo**: qualsiasi utente autenticato
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] (richiede manipolare/attendere scadenza token, non ripetibile in modo sicuro su produzione)
- **Precondizioni**: sessione attiva; possibilità di attendere/forzare la scadenza dell'access token (config JWT con TTL breve su staging)
- **Passi**:
  1. Restare loggati oltre la scadenza dell'access token (o forzarla via config di test).
  2. Eseguire un'azione che richiede una chiamata API (es. aprire la lista FIR).
- **Risultato atteso**: la richiesta fallisce con 401, l'interceptor esegue un refresh silenzioso e ripete la richiesta originale con successo, senza che l'utente se ne accorga.
- **Criteri di accettazione**: nessun redirect a login; i dati vengono comunque mostrati; una singola chiamata di refresh anche con più richieste concorrenti (verifica con DevTools Network che non ci siano refresh multipli in parallelo).
- **Note/rischi**: se il refresh fallisce, ci si attende logout pulito e redirect a `/login?returnUrl=...`.

### UAT-AUTH-05 — Logout esplicito
- **Attore/Ruolo**: qualsiasi utente autenticato
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: sessione attiva
- **Passi**:
  1. Aprire il menu utente in alto a destra.
  2. Cliccare "Esci"/"Logout".
- **Risultato atteso**: redirect a `/login`; token rimossi da `localStorage` (verificabile da DevTools > Application > Local Storage: chiavi `accessToken`/`refreshToken` assenti).
- **Criteri di accettazione**: navigare indietro col browser o riaprire una rotta protetta richiede nuovo login.
- **Note/rischi**: verificare che siano rimosse anche le 4 chiavi di impersonificazione se presenti (`wf_impersonator_*`, `wf_admin_tenant`), anche se non si era in modalità impersonificazione (non devono esserci residui).

### UAT-AUTH-06 — Sessione singola per utente (login concorrente invalida la precedente)
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: stesso utente con due browser/dispositivi distinti (regola globale cross-progetto: una sola sessione attiva per utente)
- **Passi**:
  1. Login con l'utente A sul browser 1.
  2. Login con lo stesso utente A sul browser 2.
  3. Tornare al browser 1 ed eseguire un'azione che richiede una chiamata API.
- **Risultato atteso**: la sessione sul browser 1 viene invalidata dal nuovo login sul browser 2 (comportamento mandatorio cross-progetto: single active session per utente).
- **Criteri di accettazione**: browser 1 riceve 401 e viene reindirizzato al login; browser 2 resta operativo.
- **Note/rischi**: **verificare se questo comportamento è realmente implementato** — non risulta esplicitamente documentato negli audit tecnici forniti (01/02/05); se non implementato, aprire un difetto di conformità alla policy di sicurezza obbligatoria del progetto (priorità alta, non solo UX).

### UAT-AUTH-07 — Endpoint `POST /auth/dev/login` non raggiungibile in produzione
- **Attore/Ruolo**: nessuno (verifica tecnica di sicurezza, eseguibile anche da non autenticato)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] (sola lettura/verifica, nessuna azione distruttiva)
- **Precondizioni**: accesso a un client HTTP (browser DevTools o Postman) verso `https://rifiuti.ignicraft.com`
- **Passi**:
  1. Inviare una richiesta `POST` a `https://rifiuti.ignicraft.com/api/v1/auth/dev/login` con un body qualsiasi.
- **Risultato atteso**: risposta di errore (l'endpoint deve rifiutarsi di funzionare quando `NODE_ENV=production`).
- **Criteri di accettazione**: nessun token JWT valido viene restituito; risposta 4xx/5xx esplicita di blocco ambiente.
- **Note/rischi**: **CRITICO da verificare ad ogni rilascio** — la protezione è solo un controllo runtime (`if NODE_ENV==='production' throw`), non un guard/build flag né un'esclusione di route (`01-api-surface.md` riga 141). Se `NODE_ENV` non fosse impostato correttamente in produzione, questo endpoint sarebbe un bypass completo di autenticazione: eseguire questo test ad ogni deploy in produzione come smoke test di sicurezza.

### UAT-AUTH-08 — Login fallito (credenziali/IdP rifiuta) mostra errore chiaro
- **Attore/Ruolo**: utente con credenziali non valide o annullamento del login sull'IdP
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna sessione attiva
- **Passi**:
  1. Avviare il login da `/login`.
  2. Sull'IdP, annullare l'operazione o inserire credenziali errate.
- **Risultato atteso**: l'utente torna su `/login` con un messaggio di errore comprensibile in italiano, non una pagina bianca o uno stack trace.
- **Criteri di accettazione**: nessun redirect a `/dashboard`; nessun token salvato in `localStorage`.
- **Note/rischi**: verificare gestione errore quando il fragment con i token è assente in `AuthCallbackComponent`.

---

## 2. RBAC per ruolo e navigazione diretta — P0

**Nota preliminare rilevante per l'intera area**: il frontend non ha **nessun** `canActivate` di ruolo/permesso su `app.routes.ts` (`02-frontend-flows.md` §3) — l'unico gating è cosmetico (voci di menu nascoste). L'autorizzazione reale è delegata al backend. Va quindi sempre verificato **sia** il comportamento del menu **sia** l'accesso via URL diretto, che deve produrre un 403 gestito in modo pulito lato UI (non una pagina bianca, non un crash).

### UAT-RBAC-01 — Matrice ruoli: cosa vede il menu per ciascun ruolo
- **Attore/Ruolo**: SUPER_ADMIN, ADMIN, OPERATOR, VIEWER (4 sotto-casi)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: un utente di test per ciascun ruolo, stesso tenant
- **Passi**:
  1. Login come SUPER_ADMIN → osservare il menu laterale completo, incluso "Amministrazione" (Tenants/Utenti) e tenant switcher con dropdown di tutti i tenant.
  2. Login come ADMIN → osservare "Amministrazione" visibile ma limitato a "le mie aziende"; nessun tenant switcher globale.
  3. Login come OPERATOR → osservare menu funzionale (FIR, Registro, Anagrafiche, ecc.) SENZA sezione "Amministrazione" né "Certificato RENTRI".
  4. Login come VIEWER → osservare stesso menu funzionale di OPERATOR ma senza bottoni di scrittura all'interno delle pagine.
- **Risultato atteso**: ogni ruolo vede esattamente le voci di menu previste (vedi tabella di copertura in fondo al documento).
- **Criteri di accettazione**: nessuna voce "Amministrazione"/"Certificato RENTRI" visibile per OPERATOR/VIEWER.
- **Note/rischi**: il gating di menu è puramente cosmetico — questo scenario NON sostituisce UAT-RBAC-02..05 (accesso diretto via URL).

### UAT-RBAC-02 — VIEWER: navigazione diretta a `/admin/tenants` via URL
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come VIEWER
- **Passi**:
  1. Con sessione VIEWER attiva, digitare manualmente nella barra indirizzi `https://rifiuti.ignicraft.com/admin/tenants` e premere Invio.
- **Risultato atteso**: la richiesta al backend (`GET /admin/tenants`) riceve 403; il frontend gestisce l'errore mostrando un messaggio/pagina comprensibile (idealmente redirect a `/permissions/denied`), MAI una tabella vuota che sembra "nessun dato" o un crash JS silenzioso.
- **Criteri di accettazione**: nessun dato di tenant visualizzato; comportamento UI coerente e non ambiguo.
- **Note/rischi**: comportamento esatto "da osservare empiricamente" per esplicita annotazione dell'audit frontend (`02-frontend-flows.md` §3) — non deducibile dal solo codice. Priorità massima perché è l'unico argine reale oltre al backend.

### UAT-RBAC-03 — OPERATOR: navigazione diretta a `/admin/utenti` e `/rentri/certificato`
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come OPERATOR
- **Passi**:
  1. Navigare a `/admin/utenti`.
  2. Navigare a `/rentri/certificato`.
- **Risultato atteso**: entrambe le pagine rifiutano l'accesso (403 dal backend), UI mostra errore/gestione pulita.
- **Criteri di accettazione**: nessuna lista utenti o credenziale RENTRI visibile a OPERATOR.
- **Note/rischi**: stesso pattern di UAT-RBAC-02.

### UAT-RBAC-04 — VIEWER: navigazione diretta a `/permissions/roles/create`
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come VIEWER
- **Passi**:
  1. Navigare a `/permissions/roles/create`.
- **Risultato atteso**: pagina non operativa per VIEWER (403 o form disabilitato).
- **Criteri di accettazione**: nessuna possibilità di creare/salvare un ruolo custom.
- **Note/rischi**: nota tecnica — il sotto-sistema `PermissionsModule`/ruoli granulari **non è cablato lato backend** (controller orfani, `01-api-surface.md` righe 162-181): è probabile che questa pagina fallisca semplicemente perché l'endpoint non esiste (404), non per un 403 di autorizzazione. Documentare l'esito reale: è comunque un "non può creare ruoli", ma per un motivo diverso da quello atteso — utile per distinguere "funzionalità non ancora esposta" da "bug di sicurezza".

### UAT-RBAC-05 — VIEWER: bottoni di scrittura disabilitati/nascosti in FIR, Registro, Anagrafiche, Contratti
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come VIEWER, tenant con almeno un FIR/anagrafica/contratto esistente
- **Passi**:
  1. Aprire `/fir` → verificare che "Nuovo FIR" e le azioni (emetti/consegna/annulla) sui singoli FIR siano disabilitate o assenti.
  2. Aprire `/produttori` (e trasportatori/destinatari) → verificare che "Nuovo"/"Modifica"/"Elimina" siano disabilitati o assenti.
  3. Aprire `/registro` → verificare che il form di inserimento movimento sia disabilitato o assente.
  4. Aprire `/contratti` → verificare che "Nuovo contratto" e cambio stato siano disabilitati o assenti.
- **Risultato atteso**: VIEWER può consultare tutte le liste/dettagli ma non può eseguire alcuna azione di scrittura.
- **Criteri di accettazione**: nessun bottone di scrittura cliccabile con effetto reale; se un bottone è visibile ma disabilitato, deve essere chiaro visivamente (non solo lato tooltip).
- **Note/rischi**: da ri-verificare esplicitamente dal lato UI puro anche se l'audit RBAC backend (commit `09d8fd5`) ha già chiuso il gap lato API — un frontend che mostra bottoni attivi che poi falliscono con 403 è comunque una UX scadente da segnalare anche se non è un buco di sicurezza.

### UAT-RBAC-06 — Tentativo di scrittura VIEWER via chiamata diretta (bypass UI)
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come VIEWER, token JWT valido
- **Passi**:
  1. Con gli strumenti sviluppatore del browser (o Postman) usando il token dell'utente VIEWER, inviare `POST /api/v1/fir` con un payload FIR valido.
  2. Ripetere con `POST /api/v1/registro`, `POST /api/v1/registry/produttori`, `POST /api/v1/contracts`, `POST /api/v1/backup/create`.
- **Risultato atteso**: tutte le richieste ricevono 403 Forbidden.
- **Criteri di accettazione**: nessuna delle risorse viene creata (verificare assenza in lista dopo il tentativo).
- **Note/rischi**: questo è il test di **verifica reale** della correzione RBAC del commit `09d8fd5` — su produzione (`master`), se non ancora promosso, ci si attende che questo test **fallisca** (le scritture riescono, vedi `04-gap-prod-develop.md` #3,#4,#6,#8,#10): eseguire su ambiente di test per confermare il fix, e su produzione come verifica dell'esposizione corrente.

### UAT-RBAC-07 — ADMIN: gestione limitata alle "proprie" aziende in `/admin/tenants`
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente ADMIN associato solo ad alcuni tenant, non a tutti
- **Passi**:
  1. Login come ADMIN, navigare a `/admin/tenants`.
- **Risultato atteso**: la lista mostra solo i tenant di competenza dell'ADMIN ("Le mie aziende"), non l'intera piattaforma.
- **Criteri di accettazione**: nessun tenant di altri clienti visibile.
- **Note/rischi**: verificare `GET /admin/tenants` per ADMIN filtri correttamente lato backend, non solo lato label UI.

### UAT-RBAC-08 — SUPER_ADMIN: accesso completo a tutte le pagine amministrative
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login SUPER_ADMIN
- **Passi**:
  1. Navigare in sequenza a `/admin/tenants`, `/admin/utenti`, `/rentri/certificato`.
- **Risultato atteso**: tutte le pagine sono pienamente operative, dati di tutti i tenant visibili dove previsto.
- **Criteri di accettazione**: nessun 403 inatteso per SUPER_ADMIN.
- **Note/rischi**: nessuno.

### UAT-RBAC-09 — Endpoint `/me/switch-tenant` senza controllo di ruolo: VIEWER non deve poter passare a tenant non propri
- **Attore/Ruolo**: VIEWER
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: VIEWER membro di un solo tenant; conoscere l'ID di un tenant a cui NON appartiene
- **Passi**:
  1. Con token VIEWER, inviare `POST /api/v1/me/switch-tenant` con l'ID di un tenant a cui l'utente non appartiene.
- **Risultato atteso**: la richiesta viene rifiutata (il servizio deve validare la membership anche se il controller non ha `@Roles`, come annotato in `01-api-surface.md` riga 128).
- **Criteri di accettazione**: nessun cambio di contesto tenant avvenuto; nessun accesso successivo ai dati del tenant estraneo.
- **Note/rischi**: gap RBAC "severità bassa" ma da confermare con test reale, non solo per lettura del codice.

### UAT-RBAC-10 — Notifiche: un utente non può leggere/cancellare notifiche altrui
- **Attore/Ruolo**: due utenti A e B dello stesso tenant
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: notifica esistente per l'utente A, ID noto
- **Passi**:
  1. Login come B, tentare `PATCH /api/v1/notifications/<id-notifica-di-A>/mark-read` e `DELETE /api/v1/notifications/<id-notifica-di-A>`.
- **Risultato atteso**: l'operazione non ha effetto sulla notifica di A (nessun 200 con modifica reale, o comunque nessuna cancellazione/lettura della notifica altrui).
- **Criteri di accettazione**: la notifica di A resta invariata dopo l'azione di B.
- **Note/rischi**: gap annotato in `01-api-surface.md` righe 129-131, da confermare con verifica empirica del service, non solo dal controller.

### UAT-RBAC-11 — Consultente (CONSULTANT): accesso a dashboard multi-tenant e restrizioni
- **Attore/Ruolo**: CONSULTANT (se il ruolo è provisioning-abile) / in alternativa: skip con nota
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente con ruolo CONSULTANT associato a più tenant
- **Passi**:
  1. Login come CONSULTANT, navigare a `/permissions/consultant-dashboard`.
  2. Verificare la lista tenant associati e provare a cambiare tenant.
- **Risultato atteso**: la dashboard mostra solo i tenant associati al consulente; azioni limitate a quelle previste per il ruolo.
- **Criteri di accettazione**: nessun accesso a tenant non associati.
- **Note/rischi**: **attenzione** — `consultant-dashboard.component.ts` e `tenant-selector.component.ts` chiamano endpoint con path assoluto hardcoded `/api/v1/consultant/...` invece di passare per `environment.apiUrl` (`02-frontend-flows.md` righe 236-239): l'header `X-Tenant-ID` iniettato da `tenantInterceptor` potrebbe NON raggiungere queste chiamate. Verificare esplicitamente con DevTools Network che l'header sia presente anche su queste richieste; se assente, è un difetto di isolamento tenant potenzialmente serio da riclassificare P0 se confermato. Se il ruolo CONSULTANT non è provisioning-abile nell'ambiente di test, marcare lo scenario come "non eseguibile" e segnalarlo esplicitamente al PO.

---

## 3. Isolamento multi-tenant e tenant switch — P0

### UAT-TEN-01 — Un utente non vede mai dati di un'altra azienda (FIR)
- **Attore/Ruolo**: due utenti OPERATOR di due tenant diversi (A e B)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: tenant A con almeno un FIR creato; tenant B senza accesso al tenant A
- **Passi**:
  1. Login come utente del tenant A, annotare l'ID di un FIR esistente.
  2. Logout, login come utente del tenant B.
  3. Navigare a `/fir` e verificare l'elenco.
  4. Tentare di aprire direttamente `GET /api/v1/fir/<id-del-FIR-di-A>` con il token dell'utente B (URL diretto o DevTools).
- **Risultato atteso**: l'elenco FIR di B non contiene il FIR di A; l'accesso diretto per ID al FIR di A restituisce 403/404, mai i dati.
- **Criteri di accettazione**: zero righe/campi del tenant A visibili all'utente B in nessuna forma.
- **Note/rischi**: **collegato al difetto #2 di `04-gap-prod-develop.md`**: su produzione (`master`, se non ancora promosso), `GetFIRByIdQueryHandler` confronta il `tenantId` con gli ID di produttore/trasportatore/destinatario invece che con il tenant del FIR — comportamento indefinito, va testato con attenzione: potrebbe erroneamente **bloccare** l'accesso legittimo di A al proprio FIR, oppure (meno probabile ma possibile) concedere accesso a B per coincidenza di ID. Su ambiente di test (fix applicato) ci si attende isolamento corretto per tenant.

### UAT-TEN-02 — Isolamento anagrafiche (produttori/trasportatori/destinatari) tra tenant
- **Attore/Ruolo**: utenti di tenant A e B
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: anagrafica produttore creata nel tenant A
- **Passi**:
  1. Login come utente tenant B, aprire `/produttori`, cercare (per nome/CF/P.IVA) l'anagrafica creata nel tenant A.
- **Risultato atteso**: nessun risultato: l'anagrafica del tenant A non è visibile né tramite lista né tramite ricerca dal tenant B.
- **Criteri di accettazione**: zero risultati per query che matcherebbero l'anagrafica di A.
- **Note/rischi**: verificare anche l'autocomplete comuni/ATECO (dato condiviso tra tenant per design — NON deve essere trattato come leak: solo i dati "di dominio azienda-specifici" vanno isolati).

### UAT-TEN-03 — Isolamento MUD/PDF tra tenant
- **Attore/Ruolo**: utente tenant A
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: dati MUD generabili per il tenant A dell'utente
- **Passi**:
  1. Login come utente tenant A, navigare a `/mud`, generare/scaricare il PDF MUD per un anno con dati.
  2. Aprire il PDF scaricato e verificare la ragione sociale/dati anagrafici riportati.
- **Risultato atteso**: il PDF contiene i dati del tenant A dell'utente loggato, non di un altro tenant.
- **Criteri di accettazione**: ragione sociale, CF/P.IVA nel PDF coincidono con quelli del tenant A.
- **Note/rischi**: **collegato al difetto CRITICO #1 di `04-gap-prod-develop.md`** — `PdfController.downloadMUD` su produzione (`master`, se non ancora promosso) usa un tenant hard-coded (`'tenant-id-placeholder'`), non quello dell'utente autenticato: data leak cross-tenant concreto e verificabile. **Eseguire questo test ad ogni rilascio come gate di sicurezza**, non solo come UAT generico: se il PDF mostra dati non corrispondenti al tenant dell'utente, bloccare il rilascio.

### UAT-TEN-04 — Tenant switch (SUPER_ADMIN): cambio contesto e ricalcolo feature flag
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: SUPER_ADMIN, almeno 2 tenant con feature flag diversi abilitati (es. tenant X con "ESG" attivo, tenant Y senza)
- **Passi**:
  1. Login come SUPER_ADMIN, aprire il tenant switcher, selezionare il tenant X.
  2. Osservare il menu (deve mostrare "ESG/CO2").
  3. Cambiare al tenant Y dal tenant switcher.
- **Risultato atteso**: la pagina si ricarica (`window.location.reload()`), il menu si aggiorna secondo le feature flag del tenant Y (voce "ESG/CO2" sparisce se non abilitata).
- **Criteri di accettazione**: dashboard e liste mostrano solo dati del tenant correntemente selezionato dopo lo switch.
- **Note/rischi**: verificare anche che i dati già visualizzati prima dello switch non restino "in cache" visibili dopo il reload.

### UAT-TEN-05 — Header `X-Tenant-ID` raggiunge tutte le chiamate durante tenant switch
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: SUPER_ADMIN con tenant switch attivo su un tenant diverso da quello di default
- **Passi**:
  1. Cambiare tenant dal dropdown.
  2. Aprire DevTools > Network, navigare in sequenza su `/fir`, `/produttori`, `/permissions/consultant-dashboard`.
  3. Ispezionare gli header delle richieste XHR verso il backend.
- **Risultato atteso**: **tutte** le richieste, incluse quelle verso `consultant-dashboard`/`tenant-selector` (path assoluto hardcoded `/api/v1/...`), portano l'header `X-Tenant-ID` corretto.
- **Criteri di accettazione**: nessuna richiesta priva dell'header quando un tenant non-default è selezionato.
- **Note/rischi**: **sospetta incoerenza segnalata in `02-frontend-flows.md` §5.7** — le chiamate con path assoluto hardcoded potrebbero bypassare `tenantInterceptor` (che agisce solo su richieste verso `environment.apiUrl`). Se confermato, il consultant-dashboard potrebbe mostrare/agire sul tenant sbagliato: da riclassificare come difetto di isolamento tenant se riprodotto.

### UAT-TEN-06 — Utente multi-azienda (non SUPER_ADMIN): switch tra le proprie aziende
- **Attore/Ruolo**: ADMIN o OPERATOR associato a più di un tenant
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente con membership su 2+ tenant (`GET /me/tenants` restituisce più di un elemento)
- **Passi**:
  1. Login, aprire il selettore azienda, cambiare tenant.
- **Risultato atteso**: analogo a UAT-TEN-04 ma per un utente non SUPER_ADMIN — il selettore deve mostrare solo le aziende di cui l'utente è effettivamente membro.
- **Criteri di accettazione**: nessuna azienda esterna alla membership dell'utente nel dropdown.
- **Note/rischi**: nessuno oltre a quanto già coperto sopra.

### UAT-TEN-07 — Tentativo di switch verso un tenant non associato (bypass UI)
- **Attore/Ruolo**: OPERATOR membro di un solo tenant
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: conoscere l'ID di un tenant a cui l'utente NON appartiene
- **Passi**:
  1. Con token dell'utente, inviare `POST /api/v1/me/switch-tenant` con l'ID del tenant estraneo (bypassando la UI, es. da DevTools).
- **Risultato atteso**: rifiutato (stesso test di UAT-RBAC-09, qui focalizzato sull'isolamento tenant più che sul ruolo).
- **Criteri di accettazione**: nessun accesso successivo ai dati del tenant estraneo tramite la sessione così alterata.
- **Note/rischi**: duplicato intenzionale con UAT-RBAC-09 per completezza della matrice tenant — se già eseguito lì, marcare come "verificato altrove".

---

## 4. FIR — ciclo di vita completo — P0

### UAT-FIR-01 — Creazione FIR con anagrafiche esistenti (percorso felice)
- **Attore/Ruolo**: OPERATOR (o ADMIN/SUPER_ADMIN)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: produttore, trasportatore, destinatario e codice CER già censiti nel tenant
- **Passi**:
  1. Aprire `/fir`, cliccare "Nuovo FIR".
  2. Selezionare produttore, trasportatore, destinatario esistenti dal form.
  3. Compilare CER, quantità, data, altri campi obbligatori.
  4. Salvare.
- **Risultato atteso**: il FIR appare in lista con stato **BOZZA**.
- **Criteri di accettazione**: tutti i campi inseriti sono corretti nel dettaglio del FIR; nessun errore in console.
- **Note/rischi**: nessuno noto.

### UAT-FIR-02 — Creazione FIR con anagrafica al volo (sub-dialog)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: un nuovo produttore non ancora censito
- **Passi**:
  1. Aprire "Nuovo FIR", nel campo produttore cliccare "Crea nuovo".
  2. Compilare il sub-dialog anagrafica produttore e salvare.
  3. Verificare che il produttore appena creato sia selezionato automaticamente nel form FIR.
  4. Completare e salvare il FIR.
- **Risultato atteso**: FIR creato con il nuovo produttore correttamente associato; il produttore compare anche in `/produttori`.
- **Criteri di accettazione**: nessuna duplicazione di anagrafica; dati coerenti tra le due viste.
- **Note/rischi**: nessuno noto.

### UAT-FIR-03 — Transizione BOZZA → EMESSO
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR in stato BOZZA
- **Passi**:
  1. Aprire il FIR in BOZZA, cliccare "Emetti".
  2. Confermare l'azione se richiesto un dialog.
- **Risultato atteso**: stato passa a **EMESSO**; azione visibile in lista/badge di stato.
- **Criteri di accettazione**: i campi del FIR non sono più modificabili liberamente dopo l'emissione (regola di dominio).
- **Note/rischi**: nessuno noto.

### UAT-FIR-04 — Transizione EMESSO → IN_TRANSITO (presa in carico)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR in stato EMESSO
- **Passi**:
  1. Aprire il FIR emesso, cliccare "Presa in carico".
- **Risultato atteso**: stato passa a **IN_TRANSITO**.
- **Criteri di accettazione**: data/ora presa in carico registrata e visibile nel dettaglio.
- **Note/rischi**: nessuno noto.

### UAT-FIR-05 — Transizione IN_TRANSITO → CONSEGNATO (conferma consegna)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR in stato IN_TRANSITO
- **Passi**:
  1. Aprire il FIR, cliccare "Conferma consegna".
- **Risultato atteso**: stato passa a **CONSEGNATO** (stato finale positivo del ciclo).
- **Criteri di accettazione**: il FIR consegnato risulta correttamente incluso nei conteggi/report (registro, MUD).
- **Note/rischi**: nessuno noto.

### UAT-FIR-06 — Transizioni di stato illegali sono bloccate
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: un FIR per ciascuno stato (BOZZA, EMESSO, IN_TRANSITO, CONSEGNATO)
- **Passi**:
  1. Su un FIR in BOZZA, tentare "Conferma consegna" (saltando emissione e presa in carico) — via UI se disponibile, altrimenti chiamata diretta all'endpoint.
  2. Su un FIR CONSEGNATO, tentare "Emetti" o "Presa in carico" di nuovo.
  3. Su un FIR EMESSO, tentare "Conferma consegna" saltando la presa in carico.
- **Risultato atteso**: ogni transizione illegale viene rifiutata con un errore chiaro (400/409), lo stato del FIR non cambia.
- **Criteri di accettazione**: nessuno stato FIR risulta alterato da una transizione non consentita.
- **Note/rischi**: verificare in particolare che il backend (non solo la UI, che potrebbe semplicemente nascondere il bottone) rifiuti esplicitamente la richiesta — la UI da sola non è sufficiente come garanzia.

### UAT-FIR-07 — Annullamento FIR (irreversibile)
- **Attore/Ruolo**: ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] — azione distruttiva, stato terminale ANNULLATO irreversibile
- **Precondizioni**: FIR di test dedicato, non riferito a scadenze normative reali
- **Passi**:
  1. Aprire un FIR in BOZZA o EMESSO, cliccare "Annulla".
  2. Inserire una motivazione nel campo dedicato.
  3. Confermare.
- **Risultato atteso**: stato passa a **ANNULLATO** (terminale), motivazione salvata e visibile nell'audit/dettaglio.
- **Criteri di accettazione**: nessuna ulteriore azione (emetti/consegna/firma) possibile sul FIR annullato.
- **Note/rischi**: **collegato al difetto #5 di `04-gap-prod-develop.md`** — su produzione (`master`, se non promosso) il campo motivo è opzionale con fallback stringa vuota: verificare se è possibile annullare senza motivazione (gap di tracciabilità normativa). Su ambiente di test (fix applicato) il campo deve essere obbligatorio (submit senza motivo → errore di validazione, vedi UAT-FIR-08).

### UAT-FIR-08 — Annullamento FIR senza motivazione: deve essere rifiutato (dopo fix)
- **Attore/Ruolo**: ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST]
- **Precondizioni**: FIR di test in stato BOZZA/EMESSO; ambiente con la correzione del commit `09d8fd5` applicata (`develop`/staging)
- **Passi**:
  1. Aprire il dialog di annullamento FIR, lasciare vuoto il campo motivazione, tentare di confermare.
- **Risultato atteso**: submit bloccato con errore di validazione ("motivazione obbligatoria").
- **Criteri di accettazione**: il FIR resta nello stato precedente, nessun annullamento avvenuto.
- **Note/rischi**: su produzione non ancora promossa, questo test **fallisce** (annullamento accettato anche senza motivo) — non eseguire su produzione essendo comunque un'azione distruttiva; usare solo staging.

### UAT-FIR-09 — Firma digitale del FIR
- **Attore/Ruolo**: OPERATOR con livello SPID adeguato
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] (se la firma di test non ha valore legale reale) — **verificare con il PO se l'ambiente di firma è sandbox**; altrimenti [SOLO AMBIENTE DI TEST]
- **Precondizioni**: FIR emesso, utente con livello SPID richiesto per firmare
- **Passi**:
  1. Aprire il FIR, cliccare "Firma digitale".
  2. Completare il flusso di firma (eventuale re-autenticazione SPID di livello superiore).
- **Risultato atteso**: firma applicata, stato/badge di firma visibile nel dettaglio FIR.
- **Criteri di accettazione**: il documento firmato è verificabile (vedi UAT-FIR-10).
- **Note/rischi**: **collegato al difetto CRITICO #12 di `04-gap-prod-develop.md`** — su produzione (`master`, se non promosso): (a) nessun `@Roles` su `POST /fir/:firId/sign` — un VIEWER potrebbe firmare; (b) qualunque violazione di dominio (FIR non trovato, firma fuori ordine, firma duplicata, livello SPID insufficiente) degenera in **HTTP 500** invece di un errore gestito, con il rischio concreto che **ogni firma con una precondizione non rispettata fallisca in modo opaco**. Testare esplicitamente anche il caso negativo (UAT-FIR-11).

### UAT-FIR-10 — Verifica firma FIR tramite QR code (pubblico, senza login)
- **Attore/Ruolo**: terzo senza account (es. ente di controllo)
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR firmato digitalmente
- **Passi**:
  1. In un browser senza sessione, aprire l'URL di verifica generato dal QR code del FIR (`GET /fir/:firId/verify` o `/verify-url`).
- **Risultato atteso**: la pagina mostra l'esito della verifica firma (valida/non valida) senza richiedere login.
- **Criteri di accettazione**: nessun dato sensibile oltre a quanto necessario per la verifica viene esposto pubblicamente.
- **Note/rischi**: pubblico by design — verificare che non esponga più dati del necessario (es. intero contenuto del FIR vs solo esito verifica).

### UAT-FIR-11 — Tentativo di firma con precondizione violata (firma duplicata/fuori ordine)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] (sola osservazione dell'errore, nessuna azione distruttiva)
- **Precondizioni**: FIR già firmato, oppure FIR non ancora emesso
- **Passi**:
  1. Tentare di firmare nuovamente un FIR già firmato.
  2. Tentare di firmare un FIR ancora in BOZZA (non emesso).
- **Risultato atteso**: errore di dominio gestito (400/409) con messaggio comprensibile ("FIR già firmato", "FIR non ancora emesso").
- **Criteri di accettazione**: nessun HTTP 500 con stack trace esposto all'utente.
- **Note/rischi**: **collegato al difetto CRITICO #12** — su produzione non ancora promossa ci si attende un **500 generico**, non un messaggio di dominio pulito. Da segnalare come blocco rilascio se riprodotto: un flusso core (firma FIR) che fallisce in modo opaco su ogni violazione è un rischio operativo alto.

### UAT-FIR-12 — Sync RENTRI di un singolo FIR
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] se punta a un endpoint RENTRI reale/sandbox non di produzione; verificare con PO l'ambiente RENTRI configurato prima di eseguire
- **Precondizioni**: credenziale RENTRI valida configurata per il tenant; FIR pronto per la sincronizzazione
- **Passi**:
  1. Sul dettaglio FIR, cliccare l'azione di sincronizzazione RENTRI (badge `rentri-sync-badge`).
  2. Attendere l'esito.
- **Risultato atteso**: badge di stato sync aggiornato (in corso → completato/errore); log di sync consultabili.
- **Criteri di accettazione**: nessun invio duplicato allo stesso FIR in caso di doppio click.
- **Note/rischi**: `RENTRISyncController` risulta **non cablato in nessun modulo** (`01-api-surface.md` riga 179) — verificare empiricamente se la funzione è davvero raggiungibile via HTTP nell'ambiente sotto test o se il pulsante fallisce sistematicamente (404). Segnalare al PO se si tratta di funzionalità non ancora esposta.

### UAT-FIR-13 — Paginazione e filtro della lista FIR
- **Attore/Ruolo**: qualsiasi ruolo con accesso a `/fir`
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: tenant con più di una pagina di FIR (es. >20 record)
- **Passi**:
  1. Aprire `/fir`, scorrere le pagine.
  2. Applicare un filtro per stato (es. solo EMESSO) e per intervallo date.
- **Risultato atteso**: paginazione corretta, nessun FIR duplicato/mancante tra pagine; filtro applicato correttamente.
- **Criteri di accettazione**: conteggio totale coerente tra intestazione risultati e dati effettivi.
- **Note/rischi**: nessuno noto.

### UAT-FIR-14 — Dettaglio FIR: proprietario legittimo accede correttamente al proprio documento
- **Attore/Ruolo**: OPERATOR proprietario del tenant del FIR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR esistente nel proprio tenant
- **Passi**:
  1. Dalla lista FIR, cliccare su un FIR per aprirne il dettaglio.
- **Risultato atteso**: dettaglio visualizzato correttamente con tutti i dati.
- **Criteri di accettazione**: nessun 403 per l'utente legittimo proprietario del dato.
- **Note/rischi**: **collegato al difetto #2** — su produzione non promossa, la logica di autorizzazione basata su ID parte anziché tenant può bloccare l'accesso legittimo: se questo test fallisce (403 inatteso) su produzione, è la conferma diretta del difetto, priorità massima di comunicazione al PO.

### UAT-FIR-15 — Creazione FIR con dati CER/date non validi è rifiutata con messaggio chiaro
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: form "Nuovo FIR" aperto
- **Passi**:
  1. Inserire un codice CER inesistente/malformato.
  2. Inserire una data di trasporto palesemente incoerente (es. antecedente alla data di produzione).
  3. Tentare il salvataggio.
- **Risultato atteso**: errore di validazione chiaro, nessun FIR creato con dati incoerenti.
- **Criteri di accettazione**: messaggio in italiano comprensibile, non un errore tecnico grezzo.
- **Note/rischi**: verificare se la validazione avviene lato frontend, backend, o entrambi.

---

## 5. RENTRI (firma, sync, credenziali) — P0

### UAT-RENTRI-01 — Caricamento credenziale RENTRI (certificato)
- **Attore/Ruolo**: ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] — usare un certificato di test, mai una credenziale RENTRI reale/produttiva se non a scopo di validazione formale concordata col PO
- **Precondizioni**: certificato RENTRI di test (PKCS12) disponibile
- **Passi**:
  1. Navigare a `/rentri/certificato`.
  2. Caricare il certificato e la password associata.
  3. Salvare.
- **Risultato atteso**: credenziale salvata, stato "attiva" visibile in pagina.
- **Criteri di accettazione**: nessun dato sensibile del certificato (password/chiave privata) visibile in chiaro dopo il salvataggio.
- **Note/rischi**: nessuno noto oltre alla sensibilità del dato.

### UAT-RENTRI-02 — Visualizzazione stato credenziale RENTRI
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: credenziale già caricata
- **Passi**:
  1. Aprire `/rentri/certificato`.
- **Risultato atteso**: stato (validità, scadenza) mostrato correttamente.
- **Criteri di accettazione**: dati coerenti col certificato realmente caricato.
- **Note/rischi**: nessuno noto.

### UAT-RENTRI-03 — Cancellazione credenziale RENTRI
- **Attore/Ruolo**: ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] — interrompe la sincronizzazione RENTRI finché non ricaricata, azione distruttiva elencata in blacklist produzione
- **Precondizioni**: credenziale di test caricata
- **Passi**:
  1. Su `/rentri/certificato`, cliccare "Elimina credenziale".
  2. Confermare.
- **Risultato atteso**: credenziale rimossa, stato torna a "non configurata".
- **Criteri di accettazione**: eventuali sync RENTRI successivi falliscono in modo controllato finché non si ricarica una nuova credenziale.
- **Note/rischi**: mai eseguire su produzione — è in blacklist esplicita (`01-api-surface.md` riga 160).

### UAT-RENTRI-04 — VIEWER/OPERATOR non può gestire la credenziale RENTRI
- **Attore/Ruolo**: VIEWER e OPERATOR
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login come VIEWER, poi come OPERATOR
- **Passi**:
  1. Navigare a `/rentri/certificato` con ciascun ruolo.
  2. Tentare `GET/PUT/DELETE /api/v1/rentri/credential` via chiamata diretta.
- **Risultato atteso**: 403 per entrambi i ruoli su tutte le operazioni.
- **Criteri di accettazione**: nessuna lettura/modifica possibile per ruoli non ADMIN/SUPER_ADMIN.
- **Note/rischi**: coerente con `@Roles SUPER_ADMIN, ADMIN` documentato in `01-api-surface.md` righe 120-122 — verificare comunque empiricamente.

### UAT-RENTRI-05 — Sync batch RENTRI (se esposta)
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST]
- **Precondizioni**: più FIR pronti per sync, credenziale valida
- **Passi**:
  1. Se disponibile in UI, avviare una sincronizzazione batch di più FIR verso RENTRI.
- **Risultato atteso**: job avviato, stato monitorabile, log consultabili.
- **Criteri di accettazione**: nessun invio duplicato per lo stesso FIR.
- **Note/rischi**: `RENTRISyncController` risulta non cablato in produzione (`01-api-surface.md` riga 179) — se la funzione non è raggiungibile via UI/API nell'ambiente sotto test, segnalarlo come "non testabile, funzionalità non esposta" piuttosto che aprire un bug applicativo.

### UAT-RENTRI-06 — Log di sincronizzazione RENTRI consultabili
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: almeno un tentativo di sync RENTRI storico
- **Passi**:
  1. Aprire la sezione log di sync (badge/componente `rentri-sync-logs`).
- **Risultato atteso**: elenco cronologico di tentativi con esito (successo/errore) e timestamp.
- **Criteri di accettazione**: dati scoperti per tenant (nessun log di altro tenant visibile).
- **Note/rischi**: nessuno noto oltre isolamento tenant (già coperto in UAT-TEN).

---

## 6. Amministrazione tenant/utenti (SUPER_ADMIN) — P0

### UAT-ADMIN-01 — Creazione di un nuovo tenant
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] (se si usa un nome tenant di test chiaramente identificabile) — preferibile [SOLO AMBIENTE DI TEST]
- **Precondizioni**: login SUPER_ADMIN
- **Passi**:
  1. Navigare a `/admin/tenants`, cliccare "Nuovo tenant".
  2. Compilare ragione sociale, P.IVA, altri dati richiesti.
  3. Salvare.
- **Risultato atteso**: tenant creato, visibile in lista, stato iniziale corretto (es. ATTIVO o TRIAL).
- **Criteri di accettazione**: nessun duplicato con la stessa P.IVA accettato.
- **Note/rischi**: nessuno noto.

### UAT-ADMIN-02 — Creazione utente e assegnazione a un tenant
- **Attore/Ruolo**: SUPER_ADMIN o ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] con utente di test chiaramente identificabile
- **Precondizioni**: tenant di destinazione esistente
- **Passi**:
  1. Navigare a `/admin/utenti`, cliccare "Nuovo utente".
  2. Compilare email, nome, ruolo (es. OPERATOR), tenant.
  3. Salvare.
- **Risultato atteso**: utente creato, visibile in lista, ruolo e tenant corretti.
- **Criteri di accettazione**: l'utente può effettivamente autenticarsi (verificare, se possibile, con provisioning SSO/Keycloak collegato).
- **Note/rischi**: verificare l'integrazione con Keycloak per il provisioning reale dell'account SSO.

### UAT-ADMIN-03 — Modifica ruolo di un utente
- **Attore/Ruolo**: SUPER_ADMIN/ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente di test esistente con ruolo OPERATOR
- **Passi**:
  1. Da `/admin/utenti`, modificare il ruolo dell'utente a VIEWER.
  2. Salvare.
  3. (Se possibile) far rieseguire login all'utente modificato e verificare che il nuovo ruolo sia effettivo.
- **Risultato atteso**: ruolo aggiornato, effettivo alla prossima emissione di token/sessione.
- **Criteri di accettazione**: i permessi dell'utente riflettono il nuovo ruolo (bottoni di scrittura disabilitati se ora VIEWER).
- **Note/rischi**: verificare se il cambio ruolo richiede un nuovo login o è immediato (dipende da dove sono contenuti i claim di ruolo nel JWT).

### UAT-ADMIN-04 — Sospensione e riattivazione di un utente
- **Attore/Ruolo**: SUPER_ADMIN/ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] con utente di test dedicato
- **Precondizioni**: utente di test attivo
- **Passi**:
  1. Da `/admin/utenti`, sospendere l'utente (`PATCH .../status`).
  2. Tentare login con quell'utente.
  3. Riattivare l'utente e ritentare il login.
- **Risultato atteso**: login rifiutato durante la sospensione; login riuscito dopo la riattivazione.
- **Criteri di accettazione**: nessuna sessione preesistente dell'utente sospeso resta valida (idealmente invalidazione immediata).
- **Note/rischi**: verificare se una sessione già attiva al momento della sospensione viene interrotta o resta valida fino a scadenza token (gap potenziale).

### UAT-ADMIN-05 — Sospensione di un intero tenant (azione distruttiva ad alto impatto)
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SOLO AMBIENTE DI TEST] — blocca l'accesso a TUTTI gli utenti del tenant, elencata esplicitamente in blacklist produzione
- **Precondizioni**: tenant di test dedicato con almeno un utente
- **Passi**:
  1. Da `/admin/tenants`, cambiare stato del tenant di test a SOSPESO.
  2. Tentare login con un utente di quel tenant.
  3. Riportare lo stato a ATTIVO.
- **Risultato atteso**: durante la sospensione, nessun utente del tenant può accedere/operare; dopo la riattivazione, accesso ripristinato.
- **Criteri di accettazione**: messaggio di errore chiaro all'utente sospeso ("account/azienda sospesa"), non un errore generico.
- **Note/rischi**: **mai eseguire su un tenant reale in produzione** — comporta blocco totale degli utenti, elencato esplicitamente in blacklist (`01-api-surface.md` riga 154).

### UAT-ADMIN-06 — Impersonificazione utente: avvio, banner, azioni, uscita
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P0
- **Ambiente**: [SICURO IN PRODUZIONE] con utente di test come bersaglio dell'impersonificazione
- **Precondizioni**: SUPER_ADMIN loggato, utente di test da impersonare
- **Passi**:
  1. Da `/admin/utenti`, cliccare "Impersona" sull'utente di test.
  2. Verificare comparsa del banner globale di impersonificazione, visibile su ogni pagina.
  3. Eseguire un'azione come utente impersonato (es. consultare `/fir`).
  4. Cliccare "Torna al tuo account" nel banner.
- **Risultato atteso**: durante l'impersonificazione, l'utente opera con i permessi dell'utente target; al termine, il SUPER_ADMIN torna al proprio account **senza dover rifare login**.
- **Criteri di accettazione**: banner sempre visibile durante l'impersonificazione; token originali ripristinati correttamente all'uscita (verificare `localStorage`: chiavi `wf_impersonator_*` rimosse dopo l'uscita).
- **Note/rischi**: **flusso critico segnalato in `02-frontend-flows.md` §5.4** — verificare attentamente che l'uscita non lasci residui di token nell'una o nell'altra direzione (rischio di restare "bloccati" nell'identità impersonata, o di conservare un token scaduto).

### UAT-ADMIN-07 — Impersonificazione: azioni eseguite sono attribuite correttamente nell'audit
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: sessione di impersonificazione attiva (da UAT-ADMIN-06)
- **Passi**:
  1. Durante l'impersonificazione, eseguire un'azione tracciabile (es. creare un FIR).
  2. Verificare nell'audit trail/log chi ha effettivamente eseguito l'azione.
- **Risultato atteso**: l'azione è tracciata in modo da distinguere "eseguita dal SUPER_ADMIN X mentre impersonava l'utente Y" — non attribuita in modo ambiguo solo a Y.
- **Criteri di accettazione**: audit trail (se disponibile in UI, `/permissions/audit`) mostra la doppia identità.
- **Note/rischi**: il sottosistema di audit granulare risulta parzialmente non cablato (`01-api-surface.md` righe 168, 174) — verificare se l'informazione è disponibile in qualche forma (log applicativi) anche se non in UI.

### UAT-ADMIN-08 — Limite numero aziende per utente ADMIN
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: utente ADMIN di test
- **Passi**:
  1. Da `/admin/utenti`, modificare il "company-limit" dell'utente ADMIN a un valore basso (es. 1).
  2. Tentare di associare l'utente a un secondo tenant oltre il limite.
- **Risultato atteso**: l'associazione oltre il limite viene rifiutata con messaggio chiaro.
- **Criteri di accettazione**: il conteggio delle aziende associate non supera il limite impostato.
- **Note/rischi**: verificare comportamento se il limite viene abbassato sotto il numero di aziende già associate (caso limite non ovvio).

### UAT-ADMIN-09 — Richiesta di accesso pubblica (lead capture) e relativa gestione admin
- **Attore/Ruolo**: visitatore non autenticato (richiesta) + SUPER_ADMIN (gestione)
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna
- **Passi**:
  1. Da `/richiedi-accesso` (pubblica), compilare e inviare il form di richiesta accesso.
  2. Login come SUPER_ADMIN, navigare a `GET /admin/access-requests`, individuare la richiesta appena creata.
  3. Approvare o rifiutare la richiesta (`PATCH /admin/access-requests/:id`).
- **Risultato atteso**: richiesta visibile in lista admin con stato "in attesa"; dopo l'azione, stato aggiornato coerentemente.
- **Criteri di accettazione**: il richiedente non ha accesso automatico finché non approvato esplicitamente.
- **Note/rischi**: endpoint rate-limited 5/min (verificare che il rate limit non blocchi test ripetuti ravvicinati).

---

## 7. Registro cronologico art. 190 — P1

### UAT-REG-01 — Inserimento movimento di carico/scarico (percorso felice)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: CER e FIR di riferimento validi esistenti nel tenant
- **Passi**:
  1. Aprire `/registro`, compilare il form movimento (CER, quantità, data, FIR collegato).
  2. Salvare.
- **Risultato atteso**: movimento visibile nell'elenco cronologico, correttamente ordinato per data.
- **Criteri di accettazione**: i dati del movimento sono coerenti con quanto inserito, nessun arrotondamento/troncamento inatteso sulla quantità.
- **Note/rischi**: nessuno noto.

### UAT-REG-02 — Rifiuto di un movimento con CER inesistente
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: form movimento aperto
- **Passi**:
  1. Inserire un codice CER palesemente inesistente (es. "99999999").
  2. Tentare il salvataggio.
- **Risultato atteso**: errore di validazione, movimento non salvato.
- **Criteri di accettazione**: messaggio comprensibile in italiano.
- **Note/rischi**: **collegato al difetto #7 di `04-gap-prod-develop.md`** — su produzione non promossa, il DTO `RegistraMovimentoDto` non valida CER/firId/date: ci si attende che questo test **fallisca** su produzione (il movimento incoerente viene accettato), e **passi** su ambiente di test con il fix applicato.

### UAT-REG-03 — Rifiuto di un movimento con FIR inesistente collegato
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: form movimento aperto
- **Passi**:
  1. Inserire un ID FIR inesistente nel campo di collegamento (se disponibile input libero o bypass UI diretto all'API).
  2. Tentare il salvataggio.
- **Risultato atteso**: errore di validazione.
- **Criteri di accettazione**: nessun movimento orfano (riferito a FIR inesistente) persistito.
- **Note/rischi**: stesso difetto #7 — atteso fallire su produzione non promossa.

### UAT-REG-04 — VIEWER non può registrare movimenti
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0 (RBAC — collegato a difetto ALTA)
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login VIEWER
- **Passi**:
  1. Aprire `/registro`, verificare che il form di inserimento sia disabilitato/assente.
  2. Tentare `POST /api/v1/registro` via chiamata diretta con token VIEWER.
- **Risultato atteso**: 403.
- **Criteri di accettazione**: nessun movimento creato da VIEWER.
- **Note/rischi**: **collegato al difetto #6 di `04-gap-prod-develop.md`** — su produzione non promossa ci si attende che questo test **fallisca** (VIEWER può scrivere); su ambiente di test (fix applicato) deve passare.

### UAT-REG-05 — Filtro ed export del registro per periodo
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: movimenti storici su più mesi
- **Passi**:
  1. Applicare un filtro per intervallo date su `/registro`.
- **Risultato atteso**: solo i movimenti nell'intervallo selezionato sono mostrati.
- **Criteri di accettazione**: conteggio coerente con i dati filtrati.
- **Note/rischi**: nessuno noto.

---

## 8. Anagrafiche (produttori/trasportatori/destinatari) — P1

### UAT-ANA-01 — Creazione anagrafica produttore (percorso felice)
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna
- **Passi**:
  1. Aprire `/produttori`, cliccare "Nuovo".
  2. Compilare ragione sociale, CF/P.IVA, indirizzo, comune (autocomplete).
  3. Salvare.
- **Risultato atteso**: anagrafica creata, visibile in lista e ricercabile.
- **Criteri di accettazione**: nessun duplicato con stessa P.IVA accettato senza avviso.
- **Note/rischi**: nessuno noto.

### UAT-ANA-02 — Modifica anagrafica esistente
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: anagrafica esistente
- **Passi**:
  1. Aprire l'anagrafica, modificare l'indirizzo.
  2. Salvare.
- **Risultato atteso**: modifica applicata e visibile.
- **Criteri di accettazione**: FIR storici che referenziano l'anagrafica mantengono lo snapshot immutabile dei dati al momento della loro emissione (vedi decisione PO 2026-06-09, `FIR data model` in memoria progetto) — verificare che la modifica dell'anagrafica NON alteri retroattivamente i FIR già emessi.
- **Note/rischi**: comportamento chiave da verificare esplicitamente: FIR = snapshot immutabile, non riferimento live all'anagrafica.

### UAT-ANA-03 — Tentativo di modifica anagrafica inesistente restituisce errore coerente
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: ID anagrafica inesistente noto
- **Passi**:
  1. Inviare `PUT /api/v1/registry/produttori/<id-inesistente>` con un payload valido.
- **Risultato atteso**: errore "risorsa non trovata".
- **Criteri di accettazione**: codice di stato HTTP 404.
- **Note/rischi**: **collegato al difetto BASSO #9 di `04-gap-prod-develop.md`** — su produzione non promossa risponde 400 (BadRequest) invece di 404: comportamento incoerente con GET/DELETE. Su ambiente di test verificare se corretto a 404; se non ancora corretto, documentare la discrepanza come nota, non come blocco.

### UAT-ANA-04 — Cancellazione anagrafica non referenziata da FIR
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST] — cancellazione dati, azione distruttiva elencata in blacklist produzione
- **Precondizioni**: anagrafica di test creata appositamente, senza FIR collegati
- **Passi**:
  1. Da `/produttori` (o trasportatori/destinatari), eliminare l'anagrafica di test.
- **Risultato atteso**: anagrafica rimossa dalla lista.
- **Criteri di accettazione**: nessun errore residuo, nessun riferimento pendente.
- **Note/rischi**: mai eseguire su anagrafiche reali in produzione.

### UAT-ANA-05 — Cancellazione anagrafica referenziata da un FIR esistente
- **Attore/Ruolo**: ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST]
- **Precondizioni**: anagrafica di test referenziata da almeno un FIR
- **Passi**:
  1. Tentare di eliminare l'anagrafica referenziata.
- **Risultato atteso**: **atteso**: l'operazione dovrebbe essere impedita o gestita con un avviso esplicito (l'anagrafica è master data referenziata) — verificare comportamento reale, dato che l'audit segnala questo come rischio esplicito (`01-api-surface.md` righe 111, 115, 119: "elimina anagrafica, potenzialmente referenziata da FIR").
- **Criteri di accettazione**: se la cancellazione viene comunque permessa, verificare che i FIR storici mantengano comunque lo snapshot dei dati (in base al modello "snapshot immutabile") e non risultino corrotti/con riferimenti rotti.
- **Note/rischi**: **scenario ad alto rischio** — se il backend permette la cancellazione senza controllo di referenziazione, un FIR storico potrebbe perdere l'accesso ai dati anagrafici collegati (se il modello non è realmente uno snapshot ma un riferimento live). Verificare con attenzione e riportare al PO indipendentemente dall'esito.

### UAT-ANA-06 — VIEWER non può creare/modificare/eliminare anagrafiche
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0 (RBAC)
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login VIEWER
- **Passi**:
  1. Verificare assenza/disabilitazione dei bottoni di scrittura su `/produttori`, `/trasportatori`, `/destinatari`.
  2. Tentare `POST/PUT/DELETE` diretti con token VIEWER.
- **Risultato atteso**: 403 su tutte le operazioni di scrittura.
- **Criteri di accettazione**: nessuna anagrafica creata/modificata/eliminata da VIEWER.
- **Note/rischi**: **collegato al difetto #8 di `04-gap-prod-develop.md`** — atteso fallire su produzione non promossa (VIEWER può scrivere), passare su ambiente di test.

### UAT-ANA-07 — Ricerca anagrafica per CF/P.IVA/ragione sociale
- **Attore/Ruolo**: qualsiasi ruolo
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: più anagrafiche censite
- **Passi**:
  1. Usare la ricerca su `/produttori` con termini parziali (nome, CF).
- **Risultato atteso**: risultati filtrati correttamente, case-insensitive.
- **Criteri di accettazione**: nessun falso positivo/negativo evidente.
- **Note/rischi**: nessuno noto.

---

## 9. MUD — P1

### UAT-MUD-01 — Generazione MUD per un anno con dati completi
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR/movimenti registrati per l'anno selezionato
- **Passi**:
  1. Aprire `/mud`, selezionare l'anno.
  2. Cliccare "Genera".
- **Risultato atteso**: generazione completata, dati coerenti coi movimenti dell'anno.
- **Criteri di accettazione**: nessun errore per anno con dati validi.
- **Note/rischi**: nessuno noto.

### UAT-MUD-02 — Download PDF MUD e verifica tenant corretto
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P0 (collegato a data leak critico)
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: MUD generabile per il proprio tenant
- **Passi**:
  1. Da `/mud`, scaricare il PDF per l'anno selezionato.
  2. Aprire il PDF e verificare ragione sociale/P.IVA riportate.
- **Risultato atteso**: dati del PDF corrispondono al tenant dell'utente loggato.
- **Criteri di accettazione**: nessuna discrepanza tra tenant atteso e dati nel PDF.
- **Note/rischi**: **duplicato intenzionale di UAT-TEN-03** per enfasi — è il test più critico dell'intero piano secondo `04-gap-prod-develop.md` (#1, CRITICA): eseguire ad ogni rilascio.

### UAT-MUD-03 — Richiesta MUD con anno mancante o non numerico
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna
- **Passi**:
  1. Inviare `GET /api/v1/mud/generate` senza il parametro `year`, oppure con `year=abc`.
- **Risultato atteso**: errore 400 esplicito ("anno mancante o non valido").
- **Criteri di accettazione**: nessun comportamento indefinito (NaN propagato) visibile all'utente.
- **Note/rischi**: **collegato al difetto #16 di `04-gap-prod-develop.md`** — atteso fallire (comportamento indefinito/500) su produzione non promossa, atteso passare su ambiente di test con validazione.

### UAT-MUD-04 — Elenco versioni export MUD disponibili
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: più export storici disponibili (es. V6.04/24)
- **Passi**:
  1. Aprire `/mud`, consultare l'elenco versioni disponibili.
- **Risultato atteso**: versioni elencate correttamente con riferimento all'anno normativo.
- **Criteri di accettazione**: nessuna versione mancante rispetto a quanto configurato.
- **Note/rischi**: nessuno noto.

### UAT-MUD-05 — VIEWER può consultare ma non generare/esportare MUD con effetti collaterali non voluti
- **Attore/Ruolo**: VIEWER
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: login VIEWER
- **Passi**:
  1. Aprire `/mud`, verificare cosa è permesso (endpoint MUD non richiedono ruolo specifico, solo `JwtAuthGuard` secondo `01-api-surface.md` righe 85-88).
- **Risultato atteso**: dato che la generazione MUD è tecnicamente una lettura/esportazione, verificare col PO se è accettabile che anche VIEWER possa generarla — non è un'azione distruttiva ma va confermato se è nella policy dei permessi del prodotto.
- **Criteri di accettazione**: comportamento coerente con la policy di business dichiarata dal PO (da chiarire, non assumere).
- **Note/rischi**: scenario di chiarimento requisiti più che di bug — annotare la risposta del PO per aggiornare la matrice ruoli.

---

## 10. CER — P1

### UAT-CER-01 — Ricerca codice CER per testo libero
- **Attore/Ruolo**: qualsiasi ruolo (anche non autenticato, endpoint pubblico)
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna
- **Passi**:
  1. Su `/cer`, cercare un termine (es. "imballaggi").
- **Risultato atteso**: elenco di codici CER pertinenti.
- **Criteri di accettazione**: risultati coerenti col catalogo standard EER.
- **Note/rischi**: catalogo pubblico by design (`01-api-surface.md` riga 145) — confermare che sia una scelta consapevole, non un guard dimenticato (chiarimento per il PO, non blocco).

### UAT-CER-02 — Ricerca per codice esatto con e senza spazi
- **Attore/Ruolo**: qualsiasi ruolo
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: nessuna
- **Passi**:
  1. Cercare il codice "15 01 06" (con spazi).
  2. Cercare "150106" (senza spazi).
- **Risultato atteso**: entrambe le forme devono trovare lo stesso codice CER.
- **Criteri di accettazione**: nessun falso negativo per la forma senza spazi.
- **Note/rischi**: **collegato al difetto #15 di `04-gap-prod-develop.md`** — su produzione non promossa, la ricerca senza spazi restituisce falso negativo (nessuna normalizzazione); su ambiente di test con fix, entrambe le forme funzionano.

### UAT-CER-03 — Ricerca di codice CER inesistente restituisce 404, non `null` con 200
- **Attore/Ruolo**: qualsiasi ruolo
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Passi**:
  1. Cercare un codice CER palesemente inesistente (es. "99 99 99").
- **Risultato atteso**: risposta di errore "non trovato" gestita in UI (nessun risultato mostrato, messaggio chiaro).
- **Criteri di accettazione**: a livello API, ci si attende 404 (fix), non 200 con body `null`.
- **Note/rischi**: **collegato al difetto #15** — su produzione non promossa, verificare se il frontend gestisce comunque in modo pulito il caso `null`/200 anomalo (anche se l'API non è ideale, l'esperienza utente non deve rompersi).

### UAT-CER-04 — Statistiche catalogo CER
- **Attore/Ruolo**: qualsiasi ruolo
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Passi**:
  1. Consultare `GET /cer/statistics` (se esposto in UI).
- **Risultato atteso**: conteggi coerenti col numero di codici a catalogo.
- **Criteri di accettazione**: nessun valore palesemente errato (es. 0 codici quando il catalogo è popolato).
- **Note/rischi**: nessuno noto.

---

## 11. Notifiche — P1

### UAT-NOTIF-01 — Ricezione e visualizzazione notifiche
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: un evento che genera notifica (es. FIR emesso da altro utente, scadenza contratto)
- **Passi**:
  1. Osservare il badge campanella con conteggio non letti.
  2. Aprire la lista notifiche.
- **Risultato atteso**: notifica visibile con contenuto e link contestuale corretto.
- **Criteri di accettazione**: conteggio non letti coerente col numero reale.
- **Note/rischi**: nessuno noto.

### UAT-NOTIF-02 — Segna come letta una singola notifica
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: notifica non letta esistente
- **Passi**:
  1. Cliccare la notifica per marcarla come letta.
- **Risultato atteso**: badge conteggio decrementato, notifica marcata come letta.
- **Criteri di accettazione**: persistenza dello stato dopo refresh pagina.
- **Note/rischi**: nessuno noto.

### UAT-NOTIF-03 — Segna tutte come lette
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: più notifiche non lette
- **Passi**:
  1. Cliccare "Segna tutte come lette".
- **Risultato atteso**: badge azzerato, tutte le notifiche marcate lette.
- **Criteri di accettazione**: nessuna notifica residua non letta.
- **Note/rischi**: nessuno noto.

### UAT-NOTIF-04 — Eliminazione di una propria notifica
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: notifica esistente
- **Passi**:
  1. Eliminare una notifica dalla lista.
- **Risultato atteso**: notifica rimossa dalla lista dell'utente.
- **Criteri di accettazione**: la cancellazione non impatta le notifiche di altri utenti (già coperto anche in UAT-RBAC-10).
- **Note/rischi**: azione a basso raggio, sicura in produzione.

---

## 12. Backup e ripristino — P1

### UAT-BACKUP-01 — Creazione di un backup manuale
- **Attore/Ruolo**: ADMIN/SUPER_ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST] — preferire staging per non generare carico/costi inattesi in produzione, anche se l'azione in sé è non distruttiva
- **Precondizioni**: nessuna
- **Passi**:
  1. Navigare alla sezione backup (se esposta in UI) o invocare `POST /backup/create`.
- **Risultato atteso**: backup creato, elencato in `GET /backup/list`.
- **Criteri di accettazione**: dimensione/timestamp del backup coerenti.
- **Note/rischi**: nessuno noto oltre al carico I/O.

### UAT-BACKUP-02 — VIEWER/OPERATOR non può creare/ripristinare/eliminare backup
- **Attore/Ruolo**: VIEWER, OPERATOR
- **Priorità**: P0 (RBAC — CRITICO)
- **Ambiente**: [SICURO IN PRODUZIONE] (solo verifica del rifiuto, nessuna azione realmente eseguita)
- **Precondizioni**: login VIEWER e OPERATOR
- **Passi**:
  1. Con token VIEWER, tentare `POST /api/v1/backup/create`, `POST /api/v1/backup/restore`, `DELETE /api/v1/backup/cleanup`.
  2. Ripetere con token OPERATOR.
- **Risultato atteso**: 403 su tutte le chiamate per entrambi i ruoli.
- **Criteri di accettazione**: nessun backup creato/ripristinato/eliminato da ruoli non autorizzati.
- **Note/rischi**: **collegato al difetto CRITICO #3 di `04-gap-prod-develop.md`** — su produzione non promossa, `BackupController` non ha `RolesGuard` su nessun metodo: **qualunque utente autenticato, incluso VIEWER, può oggi forzare un restore del database di produzione o cancellare i backup**. Questo test, eseguito su produzione, verifica solo che la richiesta venga rifiutata — **NON eseguire mai realmente un restore/cleanup per la verifica**: se il 403 non arriva, interrompere immediatamente il test e segnalare come incidente di sicurezza attivo, non attendere il ciclo UAT ordinario.

### UAT-BACKUP-03 — Ripristino da backup (restore distruttivo)
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST] — sovrascrive il database corrente, nessun modo di annullare
- **Precondizioni**: ambiente di staging isolato, backup di test disponibile, nessun dato di produzione presente
- **Passi**:
  1. Da staging, eseguire `POST /backup/restore` con un backup di test.
- **Risultato atteso**: stato del database ripristinato al momento del backup selezionato.
- **Criteri di accettazione**: dati coerenti col punto nel tempo del backup.
- **Note/rischi**: **mai su produzione**, azione in blacklist esplicita.

### UAT-BACKUP-04 — Pulizia backup vecchi (cleanup distruttivo)
- **Attore/Ruolo**: SUPER_ADMIN
- **Priorità**: P1
- **Ambiente**: [SOLO AMBIENTE DI TEST]
- **Precondizioni**: staging con backup di test più vecchi di 30 giorni (o soglia configurata simulata)
- **Passi**:
  1. Eseguire `DELETE /backup/cleanup`.
- **Risultato atteso**: backup più vecchi della soglia eliminati permanentemente, quelli recenti conservati.
- **Criteri di accettazione**: nessuna cancellazione di backup più recenti della soglia.
- **Note/rischi**: **mai su produzione**, azione irreversibile in blacklist esplicita.

---

## 13. Dashboard — P1

### UAT-DASH-01 — Visualizzazione KPI dashboard post-login
- **Attore/Ruolo**: qualsiasi utente autenticato
- **Priorità**: P1
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: tenant con dati storici (FIR, movimenti)
- **Passi**:
  1. Login, osservare `/dashboard`.
- **Risultato atteso**: KPI/riepiloghi mostrati coerenti coi dati reali del tenant.
- **Criteri di accettazione**: nessun valore palesemente errato o a zero quando esistono dati.
- **Note/rischi**: dashboard sempre raggiungibile, nessun feature flag — nessuna copertura test automatica nota (`05-test-coverage-ci.md`), quindi verifica manuale particolarmente importante.

### UAT-DASH-02 — Export dati dashboard
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: dati dashboard disponibili
- **Passi**:
  1. Cliccare l'azione di export (`GET /dashboard/export`).
- **Risultato atteso**: file scaricato con dati coerenti a quanto visualizzato in dashboard.
- **Criteri di accettazione**: nessuna discrepanza tra vista e export.
- **Note/rischi**: nessuno noto.

---

## 14. Giacenze — P2

### UAT-GIAC-01 — Visualizzazione stato giacenze
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: movimenti registrati che generano giacenza
- **Passi**:
  1. Aprire `/giacenze`.
- **Risultato atteso**: stato aggiornato coerente coi movimenti di carico/scarico.
- **Criteri di accettazione**: nessuna giacenza negativa non giustificata.
- **Note/rischi**: nessuno noto.

### UAT-GIAC-02 — Alert deposito temporaneo (limiti art. 185-bis)
- **Attore/Ruolo**: qualsiasi utente
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: giacenza vicina/oltre i limiti tempo/quantità previsti
- **Passi**:
  1. Aprire `/giacenze`, osservare la sezione alert deposito temporaneo.
- **Risultato atteso**: alert mostrato quando la soglia è superata.
- **Criteri di accettazione**: alert corretto rispetto ai limiti normativi configurati.
- **Note/rischi**: verificare che le soglie configurate riflettano correttamente la normativa vigente (chiarimento business, non solo tecnico).

### UAT-GIAC-03 — VIEWER può consultare ma non alterare le giacenze
- **Attore/Ruolo**: VIEWER
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Passi**:
  1. Verificare che `/giacenze` sia sola lettura per tutti i ruoli (dato che deriva dai movimenti, non ha azioni dirette di scrittura proprie).
- **Risultato atteso**: nessuna azione di scrittura diretta disponibile per nessun ruolo su questa pagina (comportamento atteso by design).
- **Criteri di accettazione**: coerente con l'assenza di endpoint di scrittura dedicati (`01-api-surface.md` non ne elenca).
- **Note/rischi**: scenario di conferma, non di rischio.

---

## 15. Contratti — P2

### UAT-CONTR-01 — Creazione contratto con auto-fill da FIR
- **Attore/Ruolo**: OPERATOR
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: FIR/anagrafiche esistenti utilizzabili per auto-fill
- **Passi**:
  1. Aprire `/contratti`, cliccare "Nuovo contratto".
  2. Usare la funzione auto-fill per precompilare dati da FIR/anagrafiche esistenti.
  3. Completare e salvare.
- **Risultato atteso**: contratto creato con dati corretti.
- **Criteri di accettazione**: campi auto-compilati coerenti con la fonte selezionata.
- **Note/rischi**: nessuno noto.

### UAT-CONTR-02 — Cambio stato contratto nel workflow di approvazione
- **Attore/Ruolo**: OPERATOR/ADMIN
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: contratto esistente in stato iniziale
- **Passi**:
  1. Cambiare stato del contratto (es. da "bozza" ad "approvato").
- **Risultato atteso**: stato aggiornato, storicizzato.
- **Criteri di accettazione**: transizioni di stato coerenti col workflow previsto (non testato in dettaglio come per FIR — verificare se esistono transizioni illegali da bloccare).
- **Note/rischi**: nessuno noto.

### UAT-CONTR-03 — VIEWER non può creare/modificare contratti
- **Attore/Ruolo**: VIEWER
- **Priorità**: P0 (RBAC, ma area business P2 — priorità del singolo scenario elevata per motivi di sicurezza)
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Passi**:
  1. Verificare assenza/disabilitazione bottoni scrittura su `/contratti`.
  2. Tentare `POST /api/v1/contracts` e `PATCH /api/v1/contracts/:id/status` con token VIEWER.
- **Risultato atteso**: 403.
- **Criteri di accettazione**: nessun contratto creato/modificato da VIEWER.
- **Note/rischi**: **collegato al difetto #10 di `04-gap-prod-develop.md`** — atteso fallire su produzione non promossa, passare su ambiente di test.

### UAT-CONTR-04 — Lista contratti paginata e dettaglio
- **Attore/Ruolo**: qualsiasi ruolo
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Passi**:
  1. Aprire `/contratti`, scorrere le pagine, aprire un dettaglio.
- **Risultato atteso**: dati coerenti tra lista e dettaglio.
- **Criteri di accettazione**: nessuna discrepanza.
- **Note/rischi**: nessuno noto.

---

## 16. ESG / CO2 — P2

### UAT-ESG-01 — Consultazione report ESG
- **Attore/Ruolo**: qualsiasi ruolo con feature `esg` abilitata
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: dati sufficienti per generare il report (movimenti/FIR storici)
- **Passi**:
  1. Aprire `/esg`.
- **Risultato atteso**: report/KPI ESG mostrato coerentemente con i dati del tenant.
- **Criteri di accettazione**: nessun valore incoerente rispetto ai movimenti registrati.
- **Note/rischi**: nessuno noto.

### UAT-ESG-02 — Report ESG non visibile se feature flag disabilitata
- **Attore/Ruolo**: qualsiasi ruolo, tenant senza feature `esg`
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: tenant con feature `esg` disattivata
- **Passi**:
  1. Login su tenant senza `esg`, verificare che la voce menu non compaia.
  2. Navigare comunque a `/esg` via URL diretto.
- **Risultato atteso**: dato che non c'è `canActivate` di feature flag, verificare cosa succede realmente (probabile accesso comunque possibile se il backend non verifica il flag lato server).
- **Criteri di accettazione**: se il backend non applica il gate della feature flag, segnalarlo come gap (funzionalità non pagata/abilitata comunque accessibile) — di interesse per la strategia di pricing/packaging, non solo tecnico.
- **Note/rischi**: rilevante per il modello di business a feature flag — verificare con PO se il gate lato solo-frontend è accettabile per tutte le feature a pagamento o se serve enforcement lato backend.

---

## 17. Anomalie — P2

### UAT-ANOM-01 — Consultazione elenco anomalie rilevate
- **Attore/Ruolo**: qualsiasi ruolo con feature `anomalie` abilitata
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: almeno un'anomalia rilevata dal sistema (es. incoerenza tra registro e FIR)
- **Passi**:
  1. Aprire `/anomalie`.
- **Risultato atteso**: elenco anomalie mostrato con dettaglio sufficiente per la triage.
- **Criteri di accettazione**: nessuna anomalia di altri tenant visibile (isolamento tenant).
- **Note/rischi**: nessuno noto oltre isolamento tenant.

### UAT-ANOM-02 — Isolamento tenant sulle anomalie
- **Attore/Ruolo**: utenti di tenant A e B
- **Priorità**: P1 (per l'aspetto isolamento, anche se l'area è P2)
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: anomalia rilevata nel tenant A
- **Passi**:
  1. Login come utente tenant B, aprire `/anomalie`.
- **Risultato atteso**: nessuna anomalia del tenant A visibile a B.
- **Criteri di accettazione**: lista vuota o solo anomalie proprie di B.
- **Note/rischi**: nessuno noto.

---

## 18. Billing / Abbonamento — P2

### UAT-BILL-01 — Consultazione stato abbonamento
- **Attore/Ruolo**: qualsiasi utente autenticato
- **Priorità**: P2
- **Ambiente**: [SICURO IN PRODUZIONE]
- **Precondizioni**: tenant con abbonamento attivo/trial
- **Passi**:
  1. Aprire `/abbonamento`.
- **Risultato atteso**: stato piano, eventuale scadenza trial mostrati correttamente.
- **Criteri di accettazione**: dati coerenti con lo stato reale del tenant su Stripe.
- **Note/rischi**: pagina sempre in menu senza feature flag — verificare con PO se intenzionale che sia visibile anche a tenant TRIAL/scaduti (`02-frontend-flows.md` riga 193-194).

### UAT-BILL-02 — Avvio checkout Stripe (upgrade piano)
- **Attore/Ruolo**: ADMIN/SUPER_ADMIN
- **Priorità**: P2
- **Ambiente**: [SOLO AMBIENTE DI TEST] — usare le chiavi Stripe test/sandbox, mai chiavi live per un test ripetibile
- **Precondizioni**: ambiente configurato con Stripe test mode
- **Passi**:
  1. Da `/abbonamento`, cliccare "Aggiorna piano"/"Upgrade".
  2. Completare il checkout con una carta di test Stripe.
- **Risultato atteso**: redirect a Stripe Checkout, ritorno all'app con piano aggiornato.
- **Criteri di accettazione**: stato abbonamento riflette il nuovo piano dopo il checkout.
- **Note/rischi**: mai usare carte reali o ambiente Stripe live per un test ripetuto.

### UAT-BILL-03 — VIEWER/OPERATOR non può avviare checkout o portale billing
- **Attore/Ruolo**: VIEWER, OPERATOR
- **Priorità**: P0 (RBAC — collegato a difetto ALTA)
- **Ambiente**: [SICURO IN PRODUZIONE] (solo verifica rifiuto)
- **Precondizioni**: login VIEWER e OPERATOR
- **Passi**:
  1. Con token VIEWER, tentare `POST /api/v1/billing/checkout` e `POST /api/v1/billing/portal`.
  2. Ripetere con OPERATOR.
- **Risultato atteso**: 403 per entrambi i ruoli.
- **Criteri di accettazione**: nessun flusso di pagamento avviabile da ruoli non autorizzati.
- **Note/rischi**: **collegato al difetto #11 di `04-gap-prod-develop.md`** — atteso fallire su produzione non promossa (VIEWER può avviare checkout/portale), atteso passare su ambiente di test.

### UAT-BILL-04 — Webhook Stripe aggiorna correttamente lo stato abbonamento
- **Attore/Ruolo**: sistema (Stripe → backend), verifica indiretta da parte del tester
- **Priorità**: P2
- **Ambiente**: [SOLO AMBIENTE DI TEST] — richiede eventi Stripe simulati (CLI Stripe test) o sandbox dedicata
- **Precondizioni**: Stripe CLI o sandbox configurata per inviare eventi di test
- **Passi**:
  1. Simulare un evento `checkout.session.completed` o `customer.subscription.updated` verso l'endpoint webhook.
  2. Verificare in `/abbonamento` che lo stato si aggiorni di conseguenza.
- **Risultato atteso**: stato abbonamento riflette l'evento simulato senza intervento manuale.
- **Criteri di accettazione**: nessuna discrepanza tra evento Stripe e stato applicativo.
- **Note/rischi**: verificare che la firma HMAC sia validata correttamente (endpoint pubblico by design, sicurezza delegata alla firma).

---

## Dati di test necessari

### Utenti/ruoli (per tenant di test dedicato)
- 1 utente **SUPER_ADMIN** (accesso globale multi-tenant)
- 1 utente **ADMIN** per tenant di test A, associato anche a un secondo tenant B (per UAT-TEN-06/UAT-RBAC-07)
- 1 utente **OPERATOR** per tenant A
- 1 utente **VIEWER** per tenant A
- 1 utente **OPERATOR** per tenant B (isolamento cross-tenant)
- 1 utente **CONSULTANT** associato a più tenant (se il ruolo è provisioning-abile nell'ambiente sotto test — altrimenti annotare come non testabile)
- Credenziali SPID/CIE di test funzionanti per almeno 2 degli utenti sopra (login reale end-to-end)
- 1 utente "bersaglio" dedicato per i test di impersonificazione (non un utente reale in uso)

### Aziende/tenant
- **Tenant A** — tenant principale di test, con feature flag il più ampio possibile abilitate (fir, registro, cer, mud, giacenze, contratti, esg, anomalie, anagrafiche, rentri, reference_data)
- **Tenant B** — tenant secondario con un sottoinsieme diverso di feature flag abilitate (per verificare che il tenant switch ricalcoli correttamente il menu, UAT-TEN-04)
- **Tenant C** — tenant "usa e getta" dedicato solo agli scenari distruttivi (sospensione tenant, cancellazione anagrafiche/backup restore), da poter ricreare/scartare senza impatto su altri test

### Anagrafiche minime nel Tenant A
- Almeno 2 **produttori**, 2 **trasportatori**, 2 **destinatari** censiti, di cui almeno uno "usa e getta" per i test di cancellazione (UAT-ANA-04/05)
- Almeno 1 produttore/trasportatore/destinatario **non ancora censito** da usare per il test di creazione al volo (UAT-FIR-02)

### Codici CER
- Almeno un codice CER valido esistente a catalogo per la creazione FIR/movimenti registro (es. un codice della famiglia "15 01 xx" imballaggi, coerente con l'esempio usato negli scenari CER)
- Un codice CER palesemente inesistente noto a priori per i test negativi (es. "99 99 99")

### FIR di test
- Almeno 1 FIR per ciascuno stato del ciclo di vita (BOZZA, EMESSO, IN_TRANSITO, CONSEGNATO) pre-costituiti, per non dover sempre ripetere l'intero ciclo ad ogni scenario
- Almeno 1 FIR "usa e getta" dedicato all'annullamento (UAT-FIR-07/08, distruttivo)
- Almeno 1 FIR firmabile (utente con livello SPID adeguato) per i test di firma digitale

### RENTRI
- Un certificato PKCS12 di test (non un certificato RENTRI reale/produttivo) con password nota, dedicato a UAT-RENTRI-01/03

### Backup
- Ambiente di staging isolato con dati non sensibili, per eseguire in sicurezza i test di restore/cleanup (UAT-BACKUP-03/04) senza rischio per dati reali

### Billing
- Chiavi Stripe in modalità test/sandbox configurate sull'ambiente di test; carte di test Stripe standard (es. `4242 4242 4242 4242`)

### Reference data
- Comuni italiani e codici ATECO già seedati (per autocomplete in anagrafiche/form)

---

## Matrice di copertura area × ruolo

Legenda: **RW** = lettura e scrittura piena, **R** = solo lettura, **—** = nessun accesso previsto (403 atteso), **AdminOnly** = riservato a SUPER_ADMIN/ADMIN, **?** = da chiarire col PO (non deducibile con certezza dagli audit disponibili).

| Area | SUPER_ADMIN | ADMIN | OPERATOR | VIEWER |
|------|:---:|:---:|:---:|:---:|
| Dashboard | R | R | R | R |
| FIR (ciclo di vita) | RW | RW | RW | R |
| Registro art. 190 | RW | RW | RW | R |
| Anagrafiche (produttori/trasportatori/destinatari) | RW | RW | RW | R |
| CER | R | R | R | R (pubblico anche non autenticato) |
| MUD | RW | RW | RW | ? (vedi UAT-MUD-05) |
| ESG | R | R | R | R |
| Giacenze | R | R | R | R |
| Contratti | RW | RW | RW | R |
| Anomalie | R | R | R | R |
| Notifiche (proprie) | RW | RW | RW | RW |
| RENTRI (credenziale) | RW | RW | — | — |
| RENTRI (sync/firma FIR) | RW | RW | RW | — |
| Reference data (consultazione) | R | R | R | R |
| Reference data (reseed) | RW | RW | — | — |
| Backup (create/list) | RW | RW | — | — |
| Backup (restore/cleanup) | RW | — | — | — |
| Admin — Tenants | RW (tutti) | RW (solo propri) | — | — |
| Admin — Utenti | RW (tutti) | RW (solo propri tenant) | — | — |
| Admin — Impersonificazione | RW | — | — | — |
| Billing (checkout/portal) | RW | RW | — | — |
| Billing (consultazione stato) | R | R | R | R |
| Permessi granulari / ruoli custom | AdminOnly (nominale — sotto-sistema backend non cablato, vedi nota) | AdminOnly (idem) | — | — (self-service "my-permissions" R per tutti) |

**Nota sulla riga "Permessi granulari"**: l'intero sotto-sistema IAM a grana fine (`RoleController`, `UserRoleController`, `AuditController`, `TemporaryPermissionController`, `ConsultantController`) risulta **non raggiungibile in produzione** perché i relativi controller non sono cablati in nessun modulo Nest (`01-api-surface.md` righe 162-181). La matrice sopra riflette l'intento di design (desumibile da rotte/menu frontend), non il comportamento reale verificabile oggi: gli scenari UAT-RBAC-04 e UAT-ADMIN-07 servono proprio a confermare empiricamente se e cosa risulta davvero operativo.
