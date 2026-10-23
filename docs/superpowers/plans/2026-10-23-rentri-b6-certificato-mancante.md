# Piano B RENTRI, pezzo 6: "azienda senza certificato" come esito definitivo e chiaro (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** il pezzo 5 ha introdotto `TenantSenzaCertificatoRentriError`: un'azienda senza certificato proprio non usa più quello globale. L'errore però non è ancora trattato come esito definitivo:
- la trasmissione di un FIR lo ritenta fino a 5 volte;
- via HTTP esce come un 500 generico;
- i job periodici che girano su tutte le aziende lo segnalano come guasto a ogni giro, ogni 30 minuti e ogni 6 ore, anche su Bugsink.

Dopo questo pezzo:
- l'utente vede "carica il certificato" con il pulsante che porta alla pagina del certificato;
- i job saltano in silenzio le aziende senza certificato, con un log `info`, una volta per giro.

**Architettura:**
- un codice di errore non ritentabile `RENTRI_CERTIFICATO_MANCANTE`, con presentazione azione `VEDI_CERTIFICATO`;
- il filtro globale delle eccezioni traduce l'errore in 422;
- i cron controllano la credenziale prima di lavorare un'azienda.

**Tech Stack:** NestJS backend (Jest), Angular solo se serve per l'azione già esistente.

**Spec:**
- Ledger del pezzo 5: `.superpowers/sdd/2026-10-23-rentri-b5-tenant-firma-job/progress.md`, righe "Final: minor (deferred)".
- Decisione di Graziano del 2026-10-23: "Errore 'senza certificato' definitivo".
- Codice:
  - `apps/backend/src/infrastructure/rentri/rentri-credential.resolver.ts` (`TenantSenzaCertificatoRentriError`);
  - `apps/backend/src/domain/fir/rentri-sync-status.vo.ts` (`NON_RETRYABLE_ERROR_CODES`);
  - `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts` (catch degli errori, ~420-440);
  - `apps/backend/src/application/rentri/rentri-error-presentation.ts`;
  - `apps/backend/src/api/filters/global-exception.filter.ts`;
  - `apps/backend/src/infrastructure/jobs/rentri-rifornimento-scorta.job.ts`, `rentri-riconciliazione.job.ts`, `rentri-trasmissioni-sospese.job.ts`.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b6-certificato-mancante` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b5-tenant-firma-job` @ `1e8640e`.
- **TDD obbligatorio:** prima il test, **eseguito e visto fallire**, poi il codice.
- **Comandi:**
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - oracolo: `npm run test:oracolo -- <pattern>`;
  - `npx tsc --noEmit -p apps/backend`;
  - mai la suite intera.
- **Messaggio all'utente,** uguale ovunque: "L'azienda non ha un certificato RENTRI configurato: caricalo nella pagina del certificato RENTRI." È il messaggio già definito in `TenantSenzaCertificatoRentriError`, da riusare e non riscrivere. Non contiene mai l'id del tenant.
- **Commit:** senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Un FIR emesso da un'azienda senza certificato in modalità AUTOMATICA:** un solo tentativo, stato `PERMANENTLY_FAILED` con codice `RENTRI_CERTIFICATO_MANCANTE` e pulsante "Vai al certificato". Nessun "Riprova".
2. **Caricato il certificato,** un nuovo invio manuale parte. Il codice non deve bloccare per sempre: `riapriDopoVerificaManuale` o un caricamento del certificato devono rendere il FIR di nuovo trasmissibile. È la Decisione 1 qui sotto.
3. **Il cron di rifornimento della scorta con 3 aziende,** di cui una senza certificato: le altre due vengono rifornite; per quella senza certificato c'è un solo `info` e nessuna segnalazione a Bugsink.

## Decisioni (predefinite del controller, da riportare a Graziano)

1. **Dopo il caricamento del certificato il FIR torna trasmissibile.** Il codice `RENTRI_CERTIFICATO_MANCANTE` è ammesso da `riapriDopoVerificaManuale`. Il pulsante "Vai al certificato" porta al caricamento, e dopo il caricamento il dettaglio del FIR mostra "Riprova".
   - Il "Riprova" compare per `PERMANENTLY_FAILED` con codice `RENTRI_CERTIFICATO_MANCANTE` quando lo stato della credenziale del tenant risulta presente.
   - Se questo richiede un dato in più nel DTO del FIR, cioè "il tenant ha un certificato", lo si aggiunge.
   - Alternativa più semplice, se il frontend la rende complicata: il caricamento del certificato riapre in automatico i FIR fermi con quel codice per quel tenant. **Scelta predefinita: la riapertura automatica al caricamento**, nel service delle credenziali dopo un salvataggio riuscito, con un `updateMany` filtrato per tenant e codice. Non serve UI nuova, e al prossimo invio o al job di ripresa ripartono.
2. **Nei cron, l'azienda senza certificato si salta in silenzio,** con un `info` per giro e senza segnalazione a Bugsink, così il rumore non copre i guasti veri.

---

### Task 1: esito definitivo nella trasmissione, 422 via HTTP, riapertura al caricamento del certificato

**Files:**
- Modify: `rentri-sync-status.vo.ts`: `RENTRI_CERTIFICATO_MANCANTE` si aggiunge a `NON_RETRYABLE_ERROR_CODES` e ai codici ammessi da `riapriDopoVerificaManuale`.
- Modify: `sync-fir-to-rentri.use-case.ts`. Un `TenantSenzaCertificatoRentriError`, dovunque emerga (prima della POST, nella firma), produce `markRENTRISyncFailed(messaggio, 'RENTRI_CERTIFICATO_MANCANTE')`, `willRetry: false` e nessuna POST. Se emerge prima della prenotazione o nel wrapper `primaDellaPost`, lo stato definitivo va salvato comunque.
- Modify: `rentri-error-presentation.ts`: `case 'RENTRI_CERTIFICATO_MANCANTE'` → messaggio del Global Constraint, `azione: 'VEDI_CERTIFICATO'`.
- Modify: `api/filters/global-exception.filter.ts`: `TenantSenzaCertificatoRentriError` → 422 con `message` uguale a quello dell'errore e `error: 'RENTRI_CERTIFICATO_MANCANTE'`.
- Modify: il service delle credenziali (`rentri-credential.service.ts`, dopo l'upsert riuscito), con la riapertura della Decisione 1: i FIR del tenant con `rentri_sync_status = 'PERMANENTLY_FAILED'` e `rentri_last_sync_error_code = 'RENTRI_CERTIFICATO_MANCANTE'` tornano `PENDING` con i tentativi azzerati. Si logga il numero di FIR riaperti.
- Test:
  - `rentri-sync-status.vo.spec.ts`;
  - `sync-fir-to-rentri.use-case.spec.ts`;
  - `rentri-error-presentation.spec.ts`;
  - lo spec del filtro globale (se non esiste, si crea accanto);
  - lo spec del service delle credenziali, oppure un test Postgres se l'`updateMany` è SQL. Il Postgres di test è `wasteflow-pg-test` su 55432; se il container non c'è va ricreato come nei Global Constraints dei pezzi precedenti.

- [ ] **Step 1: test che falliscono.**
  - `'resolver senza certificato: PERMANENTLY_FAILED RENTRI_CERTIFICATO_MANCANTE, nessuna POST, willRetry false'`;
  - `'traduciErroreRentri RENTRI_CERTIFICATO_MANCANTE → VEDI_CERTIFICATO'`;
  - `'filtro globale: TenantSenzaCertificatoRentriError → 422 col messaggio'`;
  - `'caricamento del certificato riapre i FIR fermi per certificato mancante di quel tenant, non di altri'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test, `npx tsc --noEmit -p apps/backend` e `npm run test:oracolo -- rentri-firma-tenant-job`. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): azienda senza certificato come esito definitivo, 422 e riapertura al caricamento`.

### Task 2: i job periodici saltano le aziende senza certificato

**Files:**
- Modify: `rentri-rifornimento-scorta.job.ts`, `rentri-riconciliazione.job.ts` e `rentri-trasmissioni-sospese.job.ts`. Prima di lavorare un tenant si controlla che il resolver gli dia una credenziale (tenant o env legato): un metodo `haCredenziale(tenantId): Promise<boolean>` nel resolver, senza eccezioni. Se non c'è, si scrive un `info` "azienda <id> senza certificato RENTRI: saltata" e si va avanti, senza `segnalaErroreJob`.
  - Per il job delle trasmissioni sospese: un FIR di un'azienda senza certificato non si accoda; lo chiuderà il Task 1 quando arriverà comunque un tentativo.
- Modify: `rentri-credential.resolver.ts`, che aggiunge `haCredenziale(tenantId)` con la stessa regola di `resolve` (credenziale propria, oppure tenant legato all'env con i PEM env presenti).
- Test: gli spec dei tre job (si trovano con `ls`) e lo spec del resolver.

- [ ] **Step 1: test che falliscono.**
  - `'rifornimento: 3 aziende, una senza certificato → le altre rifornite, info, nessuna segnalazione'`;
  - lo stesso per la riconciliazione;
  - `'trasmissioni sospese: FIR di azienda senza certificato non accodato'`;
  - `'haCredenziale: propria → true; legata all'env → true; altra → false'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test e `tsc`. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): i job periodici saltano le aziende senza certificato`.
