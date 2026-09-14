# UAT — Il flusso delle scadenze dal dato al cruscotto (Task 5)

- **Data**: 2026-09-14
- **Ambito**: non un'entità, ma il FLUSSO — dato in scadenza → cron →
  notifica in applicazione → voce nel cruscotto. È la parte che nessun test
  per entità può provare da sola: che i tre pezzi restino coerenti tra loro
  quando attraversati nell'ordine reale.
- **Fonti lette prima di scrivere questo file**:
  - `apps/backend/src/application/admin/system-health/job-actions.service.ts`
    (le quattro azioni manuali esistenti, e la loro forma esatta: 202
    «avviato», lucchetto per chiave, audit su `ActivityLog`)
  - `apps/backend/src/application/admin/system-health/job-actions.service.spec.ts`
  - `apps/backend/src/application/admin/admin-system-health.module.ts` (come
    i job rilanciabili arrivano da moduli ESTERNI che li esportano)
  - `apps/backend/src/application/notifications/deadline-checker.service.ts`
    (`checkAuthorizationExpirations`, la deduplicazione settimanale in
    `esisteNotificaRecente`, `NOTIFICATION_DEDUP_GIORNI = 7`)
  - `apps/backend/src/application/notifications/notifications.module.ts`
  - `apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts`
    (`vociTrasportatoriInScadenza`, `SOGLIA_AVVISO_GIORNI = 30`, `azione.rotta`)
  - `apps/backend/src/api/dashboard/attenzione.controller.ts` (`GET /dashboard/attenzione`, calcolato dal vivo sulle tabelle, NON dalle notifiche)
  - `apps/backend/src/api/notifications/notifications.controller.ts` e
    `application/notifications/notification.service.ts` (`GET /notifications`
    filtra per `userId`+`tenantId` del chiamante; il DTO di risposta non
    espone `relatedEntityId`/`relatedEntityType`, solo `type`/`title`/...)
  - `apps/backend/src/application/admin/system-health/probes/job-schedulati.probe.ts`
    (il descrittore `job.scadenzario-autorizzazioni` dichiarava
    `implementato: false` — non più vero, v. §1)
  - `apps/frontend/src/app/features/dashboard/dashboard.component.ts` (i
    `data-testid` della fascia, `voce.chiave`/`voce.azione.rotta`)
  - `e2e/pages/anagrafiche.page.ts`, `e2e/pages/dashboard.page.ts`,
    `e2e/utils/{run-id,api-client,env}.ts`, `e2e/fixtures/{auth,risorse}.ts`
- **Automazione**: `e2e/tests/scadenze/flusso-scadenze.spec.ts`
- **Verifica di questa sessione**: `npx jest --runInBand --forceExit` su
  `job-actions.service.spec.ts`, `probes/job-schedulati.probe.spec.ts` e
  `admin-system-health.module.spec.ts` (tutti verdi), `npx tsc --noEmit -p
apps/backend/tsconfig.json` (0 errori), `npx tsc --noEmit -p e2e/tsconfig.json`
  (0 errori), `npx prettier --check` sui file toccati. **La suite E2E NON è
  stata eseguita contro un'app viva** — vincolo d'ambiente (macchina con
  meno di 2 GB liberi, ~190 processi node di altri progetti): dichiarato,
  non taciuto. L'esecuzione la fa il committente.

## 1. Il punto che il piano lasciava aperto: nessuna via per innescare il controllo a richiesta

Verificato sul sorgente: `job-actions.service.ts` esponeva quattro azioni
manuali (`rentri-riconciliazione`, `rentri-certificato-scadenza`,
`codifiche-rentri`, `dati-riferimento`) e **nessuna** innescava
`DeadlineCheckerService` — il cron giornaliero (10:00) che copre
autorizzazioni impianto, iscrizione Albo Gestori dei trasportatori e
autorizzazione dei destinatari (`checkAuthorizationExpirations`). Senza
aspettare il cron, quel controllo non si poteva eseguire a richiesta.

**Decisione (ruling del committente)**: si aggiunge l'azione mancante,
`scadenzario-autorizzazioni`, con la stessa cura del codice di produzione
delle quattro sorelle — non una scorciatoia per i test. Ha valore operativo
indipendente: la pagina «Stato del sistema» elenca i cron dello scadenzario
e mostrava il loro stato senza permettere di eseguirli; se il cron salta una
notte, un amministratore non aveva modo di recuperare prima di questa
sessione.

**Implementazione**:

- `job-actions.service.ts`: nuova voce `'scadenzario-autorizzazioni'`,
  stessa forma esatta delle altre quattro — stesso lucchetto per chiave
  (`this.inCorso`), stessa risposta 202 «avviato» (mai «eseguito»), stesso
  audit su `ActivityLog` con `AZIONE_AUDIT`. `DeadlineCheckerService`
  iniettato via costruttore, esportato da `NotificationsModule` (stessa
  convenzione già in uso per `RentriSyncModule`/`ReferenceDataModule`: il
  job NON viene riprovveduto nel modulo della pagina, altrimenti si
  raddoppierebbero gli `@Cron` registrati).
- `probes/job-schedulati.probe.ts`: il descrittore
  `job.scadenzario-autorizzazioni` dichiarava `implementato: false` — non
  più vero da tempo (il metodo copre da tempo tutte e tre le scadenze, Task
  1 e Task 3 dello scadenzario). Lasciarlo così avrebbe reso INVISIBILE il
  nuovo pulsante «esegui ora» nella pagina «Stato del sistema»: quel ramo
  del probe forza `actionable: false, actionKey: null` a prescindere da cosa
  dichiari `JOB_SCHEDULATI`. Rimosso `implementato: false`, aggiunto
  `actionKey: 'scadenzario-autorizzazioni'` e una `nota` (stesso stile di
  `job.rentri-certificato-scadenza`: nessuna `evidenza` dedicata, perché
  l'unica evidenza in banca dati disponibile — l'ultima notifica creata,
  chiave `'notifiche'` — è già condivisa con `job.pulizia-notifiche` e
  attribuirla anche a questo job sarebbe fuorviante).
- File toccati fuori dal perimetro letterale del brief ma necessari e
  precedenti (stessa cartella o wiring diretto): `notifications.module.ts`
  (aggiunto export), `admin-system-health.module.ts` (aggiunto import),
  `admin-system-health.module.spec.ts` (aggiornata l'attesa DI, il test
  compila l'intero grafo del modulo e avrebbe altrimenti fallito).

**TDD**: ogni modifica di produzione è stata preceduta da un test rosso —
v. `job-actions.service.spec.ts` (nuovo test "rilancia a mano il controllo
scadenze autorizzazioni/controparti") e `job-schedulati.probe.spec.ts`
(nuovo test "offre il pulsante «esegui ora»..."), entrambi verificati rossi
prima dell'implementazione e verdi dopo.

## 2. Perché il Trasportatore, non l'Autorizzazione impianto

Il flusso E2E usa `Trasportatore.scadenzaIscrizione`, non
`AutorizzazioneImpianto.dataScadenza`, benché `checkAuthorizationExpirations`
copra entrambi. Motivo: il Trasportatore ha (a) un endpoint di registro
(`POST`/`DELETE /registry/trasportatori`) già tracciato dal teardown della
suite (`fixtures/risorse.ts` conosce il tipo `'trasportatore'`, non
`'autorizzazione-impianto'`) e (b) una pagina reale (`/trasportatori`) verso
cui il pulsante del cruscotto naviga — l'Autorizzazione impianto non ha né
l'uno né l'altro: `raccogli-attenzione.use-case.ts` non le assegna
`azione` di proposito ("nessuna pagina di dettaglio esiste... un
collegamento che ricarica la pagina su se stessa è peggio di nessun
collegamento").

## 3. Come si misura il delta (e perché non è un totale grezzo)

`GET /notifications` filtra già per l'utente/tenant del chiamante — non è
un totale di sistema. Ma il tenant/utente di test **operator** è condiviso
da TUTTA la suite E2E (v. `e2e/README.md`), non solo da questo file: un
conteggio "lunghezza della lista prima/lunghezza dopo" rischierebbe rumore
da altri test in esecuzione parallela sullo stesso utente (falsi positivi o
falsi negativi sul delta atteso).

Il delta qui è quindi **filtrato** per `type ===
'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA'` e per il `numeroIscrizione` del
trasportatore creato da questo test (univoco per invocazione, incorporato
nel titolo della notifica da
`DeadlineCheckerService.elaboraScadenzaControparte`: `Scadenza iscrizione
${identificativo}`). Resta un delta — mai un totale assoluto, come richiesto
— solo più preciso di un conteggio grezzo che il resto della suite
renderebbe inaffidabile. Non serve leggere `relatedEntityId`: il DTO di
`GET /notifications` non lo espone comunque (`notification.service.ts`,
`getUserNotifications` mappa solo `type`/`title`/`message`/...).

**Attese su condizione, mai a tempo**: la chiamata di avvio risponde 202
subito (il giro vero avviene in background — stessa regola delle altre
quattro azioni). Il test attende, con `expect.poll` su
`GET /admin/system-health/actions/audit`, che l'esecuzione avviata compaia
come `esito: 'completato'` con timestamp successivo al proprio avvio —
esattamente il segnale che leggerebbe un amministratore reale — mai un
`waitForTimeout` a durata fissa.

**Finestra fra "completato in audit" e "lucchetto rilasciato"**: in
`JobActionsService.avvia()` la scrittura dell'audit `'completato'` avviene
nel `.then()` della catena della promise, e SOLO DOPO, nel `.finally()`
concatenato subito dopo, `this.inCorso.delete(jobKey)` libera il lucchetto
per quella chiave. Fra i due passaggi c'è una finestra reale (una manciata
di millisecondi): il Passo 6 di UAT-SCADFLOW-01 (secondo avvio, per provare
la dedup) chiama l'azione di nuovo subito dopo che `attendiCompletamento`
ha visto "completato" — cadendo proprio in quella finestra poteva ricevere
un 409 "già in corso" e far fallire il test a caso, non per un difetto del
dedup. Il test ritenta l'avvio (non l'attesa) su 409 fino a 10s prima di
arrendersi, così l'esito dipende dal dedup reale, non da una gara innocua
sul lucchetto.

**Residuo non ripulito, per scelta esplicita (v. anche `fixtures/risorse.ts`
sul principio generale)**: oltre alle notifiche già segnalate sopra, questo
file fa girare per davvero il job dello scadenzario, che scrive anche righe
di **audit** (`ActivityLog`, evento 'avviato' e poi 'completato' per
`jobKey = 'scadenzario-autorizzazioni'`) ad ogni invocazione — due per il
primo giro, due per il secondo. Né le notifiche né queste righe di audit
portano il prefisso di run (`conPrefisso`, v. `utils/run-id.ts`) e nessuna
delle due tabelle è interrogata da `e2e/scripts/verifica-residuo.ts`: sono
quindi residuo per costruzione in una suite il cui principio dichiarato è
residuo zero. Scelta deliberata, non una svista — e NON perché l'accesso
diretto al database sia fuori contratto per la suite: lo è già, per i FIR
(`fixtures/risorse.ts` → `eliminaFirConPrefisso`, `utils/db-locale.ts`) e,
da questo stesso giro di correzioni, per l'intera verifica di residuo
(`e2e/scripts/verifica-residuo.ts` legge anagrafiche e FIR dal DB, non
dall'API). Il motivo vero è un altro: cancellare queste due tabelle
falserebbe proprio ciò che il test osserva. Le righe di audit sono lette
dal poll dello stesso test (`attendiCompletamento`, che aspetta
`esito: 'completato'` su `GET .../actions/audit`) — cancellarle dopo la
fine del test non aiuta nessuno, ma cancellarle a metà run (prima che il
secondo giro abbia finito di leggerle) romperebbe l'attesa su condizione
che il test stesso usa; e il loro scopo dichiarato è essere uno storico
per un amministratore, quindi ripulirle a ogni run E2E contraddirebbe
perché esistono. La notifica del primo giro è la prova stessa della dedup
a 7 giorni verificata al Passo 6 (il secondo giro deve trovarla ancora lì
per non duplicarla): cancellarla subito dopo il test invaliderebbe
esattamente l'invariante appena controllato per qualunque run successiva
nella stessa finestra di dedup. In più, nessun endpoint di cancellazione
esiste per nessuna delle due tabelle (un DELETE diretto sul DB sarebbe
comunque possibile tecnicamente, come per i FIR, ma qui andrebbe contro lo
scopo sopra, non solo contro una convenzione), ed entrambe sono innocue —
le notifiche escono dalla dedup dopo 7 giorni e dal cleanup automatico
settimanale dopo 30, le righe di audit non influenzano nessun'altra
asserzione della suite. Se in futuro servirà davvero residuo zero anche
qui, la via è un endpoint di pulizia dedicato per i test che cancelli SOLO
le righe più vecchie della finestra di dedup/dello storico voluto, non un
DELETE indiscriminato che romperebbe l'invariante che questo stesso test
verifica.

## 4. Riserva dichiarata — Passo 5 del brief ("tutto a posto")

Il brief chiede: «senza nulla in scadenza la fascia non compare affatto» —
cioè l'intero `data-testid="attenzione-fascia"` assente. Verificato che
questa garanzia ha già una copertura solida e NON fragile a livello di
componente: `dashboard.component.spec.ts` → "non mostra alcuna fascia
quando non ci sono voci" (mock del servizio con `voci: []`, quindi
indipendente da qualunque dato reale).

Riprodurla in E2E nella forma letterale richiederebbe un tenant
GARANTITO privo di qualunque scadenza (certificato RENTRI, autorizzazioni
impianto, altri trasportatori/destinatari) nello stesso istante — ma il
tenant di test è condiviso da tutta la suite E2E (altri file, inclusa la
suite `rentri`/`scorta-vidimata` in esecuzione parallela in questa stessa
sessione di lavoro, e run precedenti non ripulite). Non esiste, nel
perimetro di questo task, un modo per creare un tenant nuovo e isolato
(nessun endpoint di self-registration/creazione tenant richiamabile da
E2E — verificato in `apps/backend/src/api`).

**Scelta**: il secondo test in `flusso-scadenze.spec.ts` verifica la stessa
garanzia end-to-end attraverso lo stack reale (DB → use case →
controller → rendering), ma SCOPED al dato che il test controlla: un
trasportatore con `scadenzaIscrizione` a due anni (ben oltre la soglia di
30 giorni, `SOGLIA_AVVISO_GIORNI`) non produce alcuna voce che lo nomini nel
cruscotto. Non dimostra che l'intera fascia sia assente nel tenant
condiviso (impossibile da garantire da qui), ma dimostra che l'assenza di
scadenza per QUESTO dato non genera mai una voce inventata — stesso
principio di regressione, verificabile senza dipendere dallo stato
dell'intero tenant.

Il committente può decidere se questo compromesso è accettabile o se vuole
investire nella creazione di un tenant E2E dedicato e isolato (fuori dal
perimetro di questo task).

## 5. Casi UAT

### UAT-SCADFLOW-01 — Trasportatore scaduto: delta esatto, dedup a 7 giorni, cruscotto con navigazione reale

- **Precondizioni**: credenziali `operator` e `superAdmin` disponibili
  (`E2E_OPERATOR_*`, `E2E_SUPERADMIN_*`); altrimenti il test fa skip
  esplicito.
- **Passi**:
  1. `POST /registry/trasportatori` (operator) con `scadenzaIscrizione`
     ieri.
  2. Conta le notifiche filtrate per questo trasportatore (PRIMA).
  3. `POST /admin/system-health/actions/scadenzario-autorizzazioni/run`
     (superAdmin) → 202 «avviato».
  4. Attende (su condizione, `GET .../actions/audit`) l'esito «completato».
  5. Conta di nuovo (DOPO): il delta deve essere esattamente 1.
  6. Ripete avvio+attesa una seconda volta: il delta della seconda volta
     deve essere esattamente 0 (dedup 7 giorni).
  7. Login UI come operator, `/dashboard`: la voce
     `attenzione-voce-trasportatore-iscrizione` (filtrata per ragione
     sociale) è visibile; click sul suo pulsante di azione; verifica che la
     navigazione arrivi DAVVERO su `/trasportatori` (non solo che l'attributo
     esista).
- **Pulizia**: `DELETE /registry/trasportatori/:id` (teardown automatico
  via `fixtures/risorse.ts`). Le notifiche create non vengono ripulite
  esplicitamente — nessun endpoint di cancellazione nel perimetro tracciato,
  e sono comunque innocue (scompaiono dalla dedup dopo 7 giorni, dal
  cleanup automatico settimanale dopo 30).
- **Automazione**:
  `e2e/tests/scadenze/flusso-scadenze.spec.ts::trasportatore scaduto: delta di notifiche esatto, dedup a 7 giorni, voce in cruscotto con navigazione reale`

### UAT-SCADFLOW-02 — Trasportatore con scadenza lontana: nessuna voce inventata (riserva, v. §4)

- **Precondizioni**: credenziali `operator` disponibili.
- **Passi**: crea un trasportatore con `scadenzaIscrizione` a due anni;
  login UI, `/dashboard`; verifica che nessun elemento nomini la sua
  ragione sociale.
- **Pulizia**: come sopra.
- **Automazione**:
  `e2e/tests/scadenze/flusso-scadenze.spec.ts::trasportatore con scadenza fra due anni: nessuna voce di attenzione per lui in cruscotto`
- **Nota sullo scope**: v. §4 — non dimostra l'assenza dell'INTERA fascia,
  solo l'assenza della voce per questo dato specifico.
