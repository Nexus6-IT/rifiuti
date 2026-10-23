# Piano B RENTRI, pezzo 8: i rilievi rimandati dalle revisioni dei pezzi 1-7 (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** chiudere i rilievi che le revisioni dei pezzi 1-7 hanno segnato come "deferred". Vengono prima quelli che cambiano un comportamento, poi i test mancanti, poi la fedeltà del finto al contratto, infine commenti e documentazione.

**Restano fuori** i punti che dipendono dalla prova sull'ambiente demo RENTRI, come deciso il 2026-10-23:
- XAdES conforme;
- numero vidimato nel payload;
- ricerca automatica dopo `RENTRI_TRASMISSIONE_INCERTA`;
- endpoint `rentri-sync` sul tenant della richiesta.

**Architettura:** nessun componente nuovo. Sono correzioni puntuali nei file già toccati dai pezzi 1-7.

**Tech Stack:** NestJS backend (Jest), fake RENTRI (`tools/rentri-fake`, Fastify, oracolo in-process).

**Spec:** le righe `minor (deferred)` e `Final: minor (deferred)` dei ledger in `.superpowers/sdd/2026-10-23-rentri-b{1..7}-*/progress.md`. Ogni task cita il pezzo da cui viene il rilievo, così il ledger originale fa da contesto.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b8-rilievi` in `C:\Progetti\rifiuti-wt-rentri-b1`, partito dalla punta della catena dopo il merge su `master`.
- **TDD** per i Task 1 e 2: prima il test, eseguito e visto fallire. I Task 3 e 4 sono test e documentazione, quindi il test nuovo deve passare sul codice attuale; quando si corregge il finto, deve fallire prima.
- **Comandi:**
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - finto: `cd tools/rentri-fake && npx jest <spec>`;
  - `npx tsc --noEmit -p apps/backend`;
  - lint della CI: `npx eslint "{src,test}/**/*.ts" --quiet` in `apps/backend`.
- **Sicurezza:** mai chiavi, certificati, passphrase o id di tenant nei messaggi d'errore restituiti all'utente.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Redis giù al caricamento del certificato:** i FIR riaperti a PENDING in AUTOMATICA/IBRIDA vengono accodati dal job di recupero entro un giro, senza intervento manuale.
2. **Credenziale env vuota per il tenant legato:** l'errore che arriva all'utente non contiene l'id del tenant.
3. **Il warn di algoritmo discordante e quello del fallback env** compaiono una volta per tenant e per processo, non a ogni richiesta.

---

### Task 1: rilievi che cambiano un comportamento

**Files:**
- `apps/backend/src/infrastructure/jobs/rentri-trasmissioni-sospese.job.ts`, più il metodo del repository FIR che usa (B6, final).
  - Oggi un FIR riaperto a PENDING quando Redis è giù resta senza job.
  - Il job di recupero accoda anche i FIR PENDING delle aziende in AUTOMATICA o IBRIDA:
    - senza job in coda;
    - con `rentri_sync_avviato_at` nullo;
    - aggiornati da più di `SOGLIA_STALLO_RENTRI_MS`.
  - Il jobId resta deterministico (`sync-<firId>`), quindi un FIR già in coda non si duplica.
- `apps/backend/src/infrastructure/rentri/rentri-credential.resolver.ts` (B5, final): l'Error generico per un tenant legato all'env con i PEM vuoti non deve più contenere l'id del tenant. L'id va solo nel log.
- `apps/backend/src/infrastructure/rentri/rentri-credential.resolver.ts` o `rentri-auth.service.ts` (B4, final; B5, task 1): il warn di algoritmo discordante sulle righe vecchie e il warn del fallback env si deduplicano per tenant e per processo, come già fatto per l'avviso di `RENTRI_ENV_TENANT_ID`. Il contatore delle occorrenze continua a contare ogni volta.
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (B1, task 1): `rentriTenantLocked.set` va spostato fuori dal `try` della POST. Un suo errore non deve classificare la chiamata come `NESSUNA_RISPOSTA`.
- `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts` (B7, final): il warn della rilettura riporta la causa dell'errore, come messaggio e senza dati del FIR.
- `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts` (B6, task 1): nel ramo `primaDellaPost` si emette l'evento di dominio dell'esito, come negli altri rami. Va verificato prima se l'evento si perde davvero; se no, lo si scrive nel report e si salta.

- [ ] **Step 1: test che falliscono.**
  - `'trasmissioni sospese: FIR PENDING in AUTOMATICA senza job e senza avvio da oltre la soglia → accodato con sync-<id>'`;
  - `'trasmissioni sospese: FIR PENDING in MANUALE → non accodato'`;
  - `'resolver: tenant legato con PEM env vuoti → messaggio senza id del tenant'`;
  - `'warn algoritmo discordante: due richieste dello stesso tenant → un solo warn, contatore a 2'`;
  - `'errore di rentriTenantLocked.set dopo una 2xx → esito della POST conservato'`;
  - `'rilettura dopo esitoRegistrato fallita → warn con la causa'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati, `tsc` e il lint. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): rilievi rimandati che cambiano un comportamento (recupero PENDING, messaggi, warn deduplicati)`.

### Task 2: test mancanti

**Files (solo test, salvo dove un test scopre un difetto):**
- **B1, task 1:** rate limiter che rifiuta durante una creazione: nessuna POST e FIR non bloccato in SYNCING.
- **B1, task 3:** il test "save stantio" usa un campo senza significato RENTRI al posto di `agganciaFormularioAcquisito`.
- **B3, task 2:** un certificato non valido ferma il flusso prima di `autorizzaFirmaRemota`. L'asserzione `certificates=None` diventa esplicita, senza `?? []`.
- **B4, task 1:**
  - un keyBag non cifrato;
  - un p12 senza un certificato che corrisponda alla chiave;
  - una chiave non EC sul fallback;
  - `tipoChiave` ricavato dalla chiave invece di essere `'rsa'` fisso.
- **B4, task 2:** catena e revoca EC asseriscono i messaggi di ciascun ramo; il test `/dichiara/` non deve combaciare con "non dichiara".
- **B5, task 1:**
  - lo spy su `Logger.prototype.warn` si ripristina in `afterEach`;
  - un test per il warn "risoluzione dal contesto".
- **B5, task 2:** l'oracolo asserisce `toHaveLength` sulle richieste catturate.
- **B6, task 1:** un test Postgres reale (`*.postgres.spec.ts`) sul percorso transazione in attesa → certificato mancante → caricamento del certificato → riapertura → ripresa senza una nuova POST.

- [ ] **Step 1:** scrivi i test. Se uno fallisce sul codice attuale, è un difetto: correggilo nello stesso task e scrivilo nel report.
- [ ] **Step 2:** esegui i test, `tsc` e il lint. Atteso: PASS.
- [ ] **Step 3: commit** `test(rentri): coperti i rami rimasti scoperti nei pezzi 1-7`.

### Task 3: fedeltà del finto al contratto

**Files:** `tools/rentri-fake/src/routes/ca-rentri.ts`, gli schemi generati, `tools/rentri-fake/scripts/genera-schema.js` e gli spec del finto.
- **B2, task 2:** la `SignatureRequest` va validata per intero:
  - `credentials_id` di 9 caratteri;
  - `sign_algo`;
  - `additionalProperties: false`;
  - 422 dove il contratto dice 422, non 403.
  Le fixture dell'oracolo vanno aggiornate con `credentials_id` di 9 caratteri.
- **B3, task 2:**
  - guardia di schema sulla risposta di `credentials/info` (`CredentialsInfoResponse` e `CertData` con `additionalProperties: false`);
  - i rami 400 non testati: `credentials_id` non di 9 caratteri, e cert omesso senza `cert_info`;
  - un titolo distinto per ciascun 400.
- **B3, task 1:**
  - il pattern `(?i)^mobile$` va applicato oppure documentato in `FEDELTA.md` §7;
  - le intestazioni dei due schemi generati devono citare la guardia giusta (`genera-schema.js:774`);
  - `PATTERN_CONTRATTO` nello spec di `descrizioneAutorizzazioneFirma` va letto dallo YAML del contratto invece di essere un letterale.
- **B2, task 2:** `tokenValido` va importato da `./aiuti/token` invece di essere duplicato.

- [ ] **Step 1:** test del finto sui nuovi controlli. Atteso FAIL sul finto attuale.
- [ ] **Step 2:** implementa.
- [ ] **Step 3:** suite intera del finto e `npm run test:oracolo -- rentri`. Fanno eccezione il test `/metrics` con Prometheus reale e il rate limiter, che vuole Redis su 16399. Atteso: PASS.
- [ ] **Step 4: commit** `test(rentri-fake): SignatureRequest e credentials/info validati come da contratto`.

### Task 4: commenti, documentazione e script

- **B2, task 2:**
  - via i commenti "ca-rentri non ha alcun contratto pubblico" (`tools/rentri-fake/src/routes/ca-rentri.ts:16`, `:30`, `:247`; `CA_RENTRI_PATH` del client, riga ~60; header dell'oracolo `firma-operazione`, righe ~29-30);
  - una nota di correzione datata nell'ADR `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md:121`, che cita ancora `/credentials/sign-hash`.
- **B2, task 1:** il commento di `SCOSTAMENTI_NOTI` va allineato alle etichette.
- **B1, task 1:** il JSDoc di `RENTRIApiClient` va riattaccato alla classe.
- **B1, task 2:** il calcolo `statoEmesso`/`nonGiaLegato` va estratto in un helper unico, usato sia da `avviaTentativoRentri` sia da `canSyncToRENTRI`.
- **B4:**
  - `.gitattributes` aggiunge `*.sh text eol=lf`;
  - lo script delle fixture EC non nasconde più gli errori di openssl e non rigenera CA e chiavi se esistono già (opzione `--rigenera`).
- **B5, final:** il contatore `rentri_credential_env_fallback_total` va allineato al prefisso delle altre metriche RENTRI. Prima verifica in `monitoring/alerts/*.yml` che nessun allarme lo usi già.
- **B6:**
  - via la quarta colonna inutilizzata nella tabella `it.each` del resolver;
  - il JSDoc di `haCredenziale` va spezzato;
  - indentazione del blocco `FirAnnullatoNelFrattempoError` in `sync-fir-to-rentri.use-case.ts`, righe ~563-570.
- **B7, final:** il letterale `RENTRI_CERTIFICATO_MANCANTE` in presentation e nel filtro HTTP va sostituito con la costante di `rentri-certificato.costanti.ts`. Il VO di dominio resta col letterale, perché non può importare dall'infrastruttura, e un commento lo spiega.

- [ ] **Step 1:** applica.
- [ ] **Step 2:** `tsc`, lint e gli spec dei file toccati. Atteso: PASS.
- [ ] **Step 3: commit** `docs(rentri): commenti, ADR e script allineati ai pezzi 1-7`.
