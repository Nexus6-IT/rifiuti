# Piano B RENTRI, pezzo 5: tenant esplicito nella firma di integrità (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** ogni richiesta verso RENTRI firma autenticazione e integrità con la credenziale dello stesso tenant, anche quando parte da un job in coda dove non c'è un contesto di richiesta.

Oggi le due firme risolvono la credenziale in due modi diversi:
- l'header `Authorization` usa il `tenantId` passato in modo esplicito (`RentriAuthService.risolviCredenziale(tenantId)`);
- l'header `Agid-JWT-Signature` la legge dal `TenantContext` (`RentriSignatureService.buildIntegrityHeaders` → `RentriCredentialResolver.resolve()`).

Nei worker BullMQ il contesto manca, quindi la firma di integrità ricade sulle credenziali globali da env: il messaggio esce firmato con il certificato di un altro operatore. Se le credenziali globali non ci sono, la firma fallisce.

**Architettura:**
- una sola risoluzione della credenziale: `RentriCredentialResolver.resolve(tenantId)`, con il tenant come parametro;
- `RentriAuthService` la usa invece di avere la sua copia;
- `buildIntegrityHeaders` riceve il `tenantId` come parametro obbligatorio, e ogni client lo passa: è lo stesso valore che già passa all'autenticazione;
- il `TenantContext` resta solo come ripiego per i chiamanti che non hanno il tenant, che non dovrebbero esistere dopo questo piano. Se viene usato, si logga un warn.

**Tech Stack:** NestJS backend (Jest), jose per la verifica nell'oracolo, fake RENTRI in-process.

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 2, terzo trattino ("nei job in coda la firma di integrità non trova il tenant");
- `C:\Progetti\winwaste\docs\rentri\04-confronto-con-rifiuti.md` difetto (c) e riga 34.
- Codice:
  - `apps/backend/src/infrastructure/rentri/rentri-signature.service.ts:45-75`;
  - `rentri-credential.resolver.ts:1-80`;
  - `rentri-auth.service.ts:47-100`;
  - chiamanti di `buildIntegrityHeaders`: `rentri-api.client.ts:1436`, `rentri-copie.client.ts:553` e `:697`, `rentri-registri.client.ts:416`, `rentri-trasmissioni.client.ts:228` e `:404`, `xfir/rentri-xfir.client.ts:338`.

## Decisioni (predefinite del controller, da riportare a Graziano)

1. **Ripiego sulle credenziali globali da env.**
   - Resta com'è oggi: un tenant senza credenziale propria usa quella globale, che è la modalità pilota single-operator.
   - In più si logga un **warn** con l'id del tenant, mai materiale di chiave, ogni volta che succede per un tenant esplicito.
   - Togliere il ripiego, cioè rifiutare la firma, sarebbe più sicuro in multi-tenant, ma romperebbe l'ambiente pilota. Lo si decide con Graziano prima di avere più aziende reali.
2. **`tenantId` obbligatorio** nella firma di integrità: la firma diventa `buildIntegrityHeaders(rawBody, tenantId, contentType?)`. Una stringa vuota solleva un errore esplicito ("Firma di integrità RENTRI senza tenant"), senza ripiegare in silenzio sul contesto.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b5-tenant-firma-job` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b4-certificati-ec` @ `09f3051`. Va in merge dopo i pezzi 1-4. `node_modules` già installati.
- **TDD obbligatorio:** prima il test, **eseguito e visto fallire**, poi il codice.
- **Comandi:**
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - oracolo: `npm run test:oracolo -- <pattern>`;
  - `npx tsc --noEmit -p apps/backend`;
  - mai la suite intera del backend.
- **Sicurezza:** mai chiavi, certificati o passphrase nei log.
- **Lingua e commit:** commenti in italiano, termini tecnici in inglese; commit senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Un job senza `TenantContext`** (worker BullMQ, cron): autenticazione e integrità firmate con il certificato dello stesso tenant. Lo si verifica confrontando l'`x5c` dei due header e la firma.
2. **Due tenant con credenziali diverse in richieste consecutive nello stesso processo:** nessuna credenziale passa da uno all'altro.
3. **Tenant senza credenziale propria con il ripiego env configurato:** si firma con l'env e compare il warn (Decisione 1). Senza ripiego: errore esplicito.
4. **Una chiamata con body da un client diverso da `RENTRIApiClient`** (registri, copie, trasmissioni, xFIR): anche lì le firme sono dello stesso tenant.

---

### Task 1: una sola risoluzione della credenziale, tenant esplicito nella firma di integrità

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri-credential.resolver.ts`, con `resolve(tenantId?: string)`:
  - se `tenantId` è valorizzato, lo usa;
  - se è `undefined`, ricade su `TenantContext.getTenantId()` con un warn "risoluzione della credenziale RENTRI dal contesto: passare il tenant in modo esplicito";
  - warn della Decisione 1 quando un tenant esplicito senza credenziale usa l'env.
- Modify: `apps/backend/src/infrastructure/rentri/rentri-auth.service.ts`. `risolviCredenziale(tenantId)` delega al resolver e si tolgono il doppione e il suo `algoritmo` privato. Se l'iniezione del resolver crea un ciclo di dipendenze in `RentriModule`, lo si segnala nel report.
- Modify: `apps/backend/src/infrastructure/rentri/rentri-signature.service.ts`, con `buildIntegrityHeaders(rawBody: string, tenantId: string, contentType = 'application/json')`. Con `tenantId` vuoto solleva un errore (Decisione 2).
- Modify: i 7 chiamanti elencati nella Spec, che passano lo stesso tenant che usano per `creaAuthorizationHeader`. Se un chiamante non ce l'ha in scope, lo si aggiunge alla firma del metodo seguendo il pattern di `RENTRIApiClient.post(path, body, metricEndpoint, tenantId?)`. Il valore deve essere quello effettivo, cioè `tenantId ?? this.tenantIdCorrente()` come già fa l'autenticazione: le due firme devono vedere lo stesso valore.
- Test:
  - `rentri-signature.service.spec.ts`;
  - `rentri-credential.resolver.spec.ts`;
  - `rentri-auth.service.spec.ts`;
  - gli spec dei client toccati, aggiornando i mock di `buildIntegrityHeaders`.

- [ ] **Step 1: test che falliscono.**
  - Firma:
    - `'buildIntegrityHeaders con tenant esplicito e senza TenantContext usa la credenziale del tenant'`: il mock del credential service restituisce una credenziale per `'tenant-a'`, la verifica avviene con jose su `x5c`/chiave di quella credenziale, e la chiamata è fuori da `TenantContext.run`;
    - `'buildIntegrityHeaders con tenant vuoto → errore'`.
  - Resolver:
    - `'resolve(tenantId) non legge il TenantContext'`: il contesto contiene `'tenant-b'`, si passa `'tenant-a'`, si usa `'tenant-a'`;
    - `'tenant senza credenziale con env: warn con l'id del tenant, nessun materiale di chiave'`.
  - Auth: `'creaAuthorizationHeader e buildIntegrityHeaders per lo stesso tenant usano la stessa credenziale'`.
- [ ] **Step 2:** esegui. Atteso: FAIL, perché la firma attuale non accetta il tenant e usa il contesto.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test dello Step 1, gli spec dei client toccati e `npx tsc --noEmit -p apps/backend`. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): firma di integrità col tenant esplicito, una sola risoluzione della credenziale`.

### Task 2: prova end-to-end da job, due tenant

**Files:**
- Create: `apps/backend/src/infrastructure/rentri/rentri-firma-tenant-job.oracolo.spec.ts`.
  - Due tenant con credenziali diverse: le fixture RSA di test esistenti e la fixture EC del pezzo 4 (`tools/rentri-fake/test/fixture/ec/`, passphrase `prova-ec`), entrambe accettate dal finto.
  - `RENTRIApiClient` reale con `RentriAuthService`, `RentriSignatureService` e `RentriCredentialResolver` reali, su un credential service in memoria.
  - Due `creaFormulario` consecutivi, uno per tenant, chiamati **fuori** da qualunque `TenantContext.run`, come fa un worker.
  - Per ogni richiesta ricevuta dal finto si catturano gli header (hook `onRequest`, come nel pezzo 1).
- Test:
  - `'da job: Authorization e Agid-JWT-Signature dello stesso tenant (stesso x5c)'`;
  - `'due tenant consecutivi: nessuna credenziale passa dall'uno all'altro'`;
  - `'Agid-JWT-Signature verificata con il certificato del tenant (compactVerify)'`.

- [ ] **Step 1:** scrivi lo spec ed eseguilo sul codice **prima** del Task 1 per vedere il RED (`git stash`, o un worktree temporaneo su `09f3051`). Se non è praticabile, mostra il RED ripristinando per un attimo `buildIntegrityHeaders` alla risoluzione da contesto, poi riporta il file a HEAD. Atteso: la firma di integrità usa la credenziale env o fallisce.
- [ ] **Step 2:** con il codice del Task 1, esegui `npm run test:oracolo -- rentri-firma-tenant-job`. Atteso: PASS.
- [ ] **Step 3:** `npm run test:oracolo -- rentri`. Fa eccezione il test `/metrics` con Prometheus reale; il rate limiter richiede Redis su 16399.
- [ ] **Step 4: commit** `test(rentri): firme di autenticazione e integrità dello stesso tenant anche da job`.

## Verifica finale

- [ ] `grep -rn "buildIntegrityHeaders(" apps/backend/src --include=*.ts | grep -v spec`: ogni chiamata passa il tenant.
- [ ] `grep -rn "credentialResolver.resolve()" apps/backend/src`: nessun risultato.
- [ ] Oracoli RENTRI verdi (con le stesse eccezioni ambientali dei pezzi precedenti).
