# Piano B RENTRI, pezzo 3: firma remota allineata al contratto ca-rentri (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** la sequenza di firma remota, cioè `credentials/info` → `credentials/authorize` → `credentials/authorize-check` → `signatures/sign-hash`, parla il contratto `ca-rentri`. Oggi, contro l'ente reale, si fermerebbe:
- al primo passo, perché il client legge un campo `certificato` che il contratto non ha;
- al secondo, perché la `description` contiene un carattere vietato dal pattern;
- e i codici della verifica dell'autorizzazione hanno un significato diverso da quello del contratto.

Il simulatore impara a rifiutare ciò che il contratto rifiuta. Così l'oracolo smette di dare ragione al client per errore.

**Architettura:** il primo passo è il simulatore, come per i formulari:
- copie degli schemi del contratto (`CredentialsAuthorizeRequest`, `SignatureRequest`) in moduli TypeScript, controllate da un test che le confronta con lo YAML;
- validazione con il `validatore-contratto` già esistente.

Poi client e use case, un passo della sequenza per task, ciascuno con il suo pezzo di simulatore nello stesso commit, perché l'oracolo li usa insieme.

**Tech Stack:** Fastify + Jest (`tools/rentri-fake`), NestJS backend (Jest, oracolo in-process).

**Spec:**
- Revisione finale del pezzo 2: `.superpowers/sdd/2026-10-23-rentri-b2-percorso-sign-hash/progress.md`, righe "Final review" (Important 1-3).
- Contratto `docs/contracts/rentri/ca-rentri.yaml`:

  | Righe | Elemento |
  |---|---|
  | 825-905 | `/credentials/authorize` |
  | 906-987 | `/credentials/authorize-check/{handle}` |
  | 1294-1394 | `/credentials/info` |
  | 2019-2089 | `/signatures/sign-hash` |
  | 2346-2386 | `CertData` |
  | 2617-2664 | `CredentialsAuthorizeRequest` |
  | 2665-2681 | `CredentialsAuthorizeResponse` |
  | 2682-2687 | `CredentialsCertificate` |
  | 2779 | `CredentialsInfoResponse` |
  | 3517-3569 | `SignatureRequest` e `SignatureResponse` |

- Modello del meccanismo da riusare: `tools/rentri-fake/src/dominio/schema-nuovo-formulario.ts`, `src/dominio/validatore-contratto.ts`, `test/schema-allineato-al-contratto.test.ts`, `scripts/genera-schema.js`.

## Decisioni (predefinite, scelte dal controller; Graziano le può cambiare)

1. **Limite dell'attesa della conferma sul dispositivo.** Secondo il contratto `expires_in` arriva solo quando l'autorizzazione è concessa, quindi alla richiesta non c'è. Si attende al massimo `expires_in` se presente, altrimenti **120 secondi** (`ATTESA_CONFERMA_FIRMA_PREDEFINITA_S = 120`). Il contratto dà 60 secondi come durata del SAD, non come tempo per confermare.
2. **Codici di `authorize-check`:**

   | Risposta | Esito |
   |---|---|
   | 202 | `IN_ATTESA` |
   | 200 | `AUTORIZZATA`, con `sad` (obbligatorio) ed `expires_in` (facoltativo) letti dal corpo |
   | 400 | `SCADUTA` (contratto: "autorizzazione scaduta"; ricade qui anche "richiesta non valida") |
   | 403 | `RIFIUTATA` (contratto: "autorizzazione non concessa") |
   | 422 | errore esplicito "notifica al dispositivo non inviata" |

   La mappatura 410 → `SCADUTA` sparisce: il contratto non ha 410.
3. **Certificato non valido.** `credentials/info` si chiama con `cert_info=true` e `certificates=Single`, e si legge `cert.certificates[0]`. Se `cert.status` è presente e diverso da `Valid`, si solleva un errore esplicito prima di chiedere l'autorizzazione: "Il certificato di firma remota non è valido (stato: <status>)".
4. **`description` dell'autorizzazione:**
   - forma: `Firma del formulario <numero> - operazione <tipo>`;
   - ogni carattere fuori dal pattern del contratto diventa `-` (il caso tipico è `_`);
   - lunghezza da 1 a 1000;
   - una funzione pura sola, testata contro la regex copiata dal contratto.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b3-ca-rentri-contratto` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b2-sign-hash` @ `c2e89f6`. Va in merge dopo i pezzi 1 e 2. `node_modules` già installati.
- **TDD obbligatorio:** prima il test, poi guardarlo fallire.
- **Comandi:**
  - simulatore: `cd tools/rentri-fake && npx jest --runInBand <file>`. La suite intera va lanciata con `--runInBand`: in parallelo si inceppa per il carico;
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - oracolo: `npm run test:oracolo -- <pattern>`.

  Mai la suite intera del backend.
- **Contratti:** gli schemi del simulatore sono copie verificate da un test, mai scritte a mano "a memoria".
- **Fixture:** ogni `credentials_id` usato nei test (backend e simulatore) ha 9 caratteri, come vuole il contratto.
- **Lingua e commit:** commenti e messaggi in italiano, termini tecnici in inglese; commit senza attribuzione AI.

## Review Focus

1. **Un corpo che viola lo schema** (`credentials_id` non di 9 caratteri, `description` con `—` o `_`, un campo in più, `sign_algo` sbagliato): il simulatore risponde 400 con ProblemDetails, e un test lo prova per ciascun caso.
2. **`credentials/info` senza `cert.certificates`, con un array vuoto o con `status` diverso da `Valid`:** errore esplicito, nessuna richiesta di autorizzazione.
3. **Autorizzazione concessa al primo `authorize-check` senza `sad` nel corpo:** errore esplicito, nessuna firma.
4. **Il SAD usato da `sign-hash` è quello arrivato da `authorize-check`,** non dalla richiesta di autorizzazione.
5. **Un `authorize` che risponde già con `sad`** (concessione immediata, ammessa dallo schema): si accetta senza attendere.

---

### Task 1: il simulatore valida i corpi di authorize e sign-hash; description ammessa dal contratto

**Files:**
- Create: `tools/rentri-fake/src/dominio/schema-ca-rentri.ts`, con gli schemi `CredentialsAuthorizeRequest`, `AuthObjectData` e `SignatureRequest` copiati dal contratto, come in `schema-nuovo-formulario.ts`. Se `scripts/genera-schema.js` li sa generare, si usa lo script.
- Create: `tools/rentri-fake/test/schema-ca-rentri-allineato-al-contratto.test.ts`, sul modello di `schema-allineato-al-contratto.test.ts`.
- Modify: `tools/rentri-fake/src/routes/ca-rentri.ts`:
  - `authorize` e `sign-hash` validano il corpo con `validatore-contratto` e rispondono 400 ProblemDetails se non è valido;
  - `sign-hash` risponde **422** (non 403) quando l'hash non coincide con quello autorizzato o il SAD non è autorizzato, come dice il contratto (righe 2048-2049).
- Create: `apps/backend/src/application/rentri/descrizione-autorizzazione-firma.ts`, con `descrizioneAutorizzazioneFirma(numeroFir: string, tipoOperazione: string): string`. Test accanto.
- Modify: `apps/backend/src/application/rentri/completa-operazione-con-firma.use-case.ts:251`, che usa la funzione nuova.
- Modify: le fixture `credentials_id` negli spec oracolo del backend e nei test del simulatore, portate a 9 caratteri. I file si trovano con `grep -rn "credentialsId\|credentials_id" apps/backend/src tools/rentri-fake --include=*.ts`.

**Interfaces:**
- Produces: `descrizioneAutorizzazioneFirma(numeroFir, tipoOperazione)`, Decisione 4. È pura, non solleva mai errori e restituisce sempre una stringa che rispetta il pattern.

- [ ] **Step 1: test che falliscono.**
  - Simulatore, schema: `'gli schemi ca-rentri del finto coincidono con il contratto'`.
  - Simulatore, rotte:
    - `'authorize con credentials_id di 8 caratteri → 400'`;
    - `'authorize con description contenente — → 400'`;
    - `'authorize con un campo non previsto → 400'`;
    - `'sign-hash con sign_algo diverso da 1.2.840.10045.4.3.2 → 400'`;
    - `'sign-hash con SAD non autorizzato → 422'`.
  - Backend:
    - `'descrizioneAutorizzazioneFirma rispetta il pattern del contratto'`, su casi con `_`, `—`, lettere accentate e una stringa molto lunga;
    - lo use case passa a `autorizzaFirmaRemota` la descrizione della funzione.
- [ ] **Step 2:** esegui i test. Atteso: FAIL.
- [ ] **Step 3:** implementa, poi aggiorna le fixture.
- [ ] **Step 4:** esegui:
  - i test dello Step 1;
  - la suite del simulatore con `--runInBand`;
  - `npm run test:oracolo -- rentri-firma-operazione rentri-accettazione rentri-annullamento`;
  - `npx tsc --noEmit -p apps/backend`.

  Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): il finto valida authorize e sign-hash sul contratto, descrizione ammessa`.

### Task 2: credentials/info legge il certificato dove lo mette il contratto

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`, `leggiCertificatoFirmaRemota` (righe ~860-895): query, lettura e JSDoc che rimanda a `CredentialsInfoResponse`.
- Modify: `tools/rentri-fake/src/routes/ca-rentri.ts`, rotta `credentials/info`. Risponde con `cert: { status: 'Valid', certificates: [...] }`, oltre a `description`, `key` e `auth` se servono allo schema. Rispetta `certificates` (`None` → nessun certificato; `Single` → uno; `Chain` → catena, con l'ente finale per primo). Senza `credentials_id` risponde 400.
- Test: `rentri-api.client.spec.ts`, i test del simulatore su `ca-rentri` e gli oracoli della firma.

**Interfaces:**
- Firma invariata: `leggiCertificatoFirmaRemota(tenantId, credentialsId): Promise<string>`.

- [ ] **Step 1: test che falliscono.**
  - Client:
    - `'credentials/info: query credentials_id, cert_info=true, certificates=Single'`;
    - `'credentials/info: restituisce cert.certificates[0]'`;
    - `'credentials/info senza cert.certificates o con array vuoto → errore esplicito'`;
    - `'credentials/info con cert.status Expired → errore "Il certificato di firma remota non è valido (stato: Expired)"'`.
  - Simulatore:
    - `'credentials/info risponde con CertData'`;
    - `'certificates=None → nessun certificato'`.
- [ ] **Step 2:** esegui i test. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** stessi test, poi gli oracoli della firma e `tsc`. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): credentials/info legge cert.certificates come da contratto`.

### Task 3: authorize e authorize-check con la semantica del contratto

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`:
  - `autorizzaFirmaRemota` (righe ~897-960);
  - `verificaAutorizzazioneFirma` (righe ~962-1046);
  - i tipi `AutorizzazioneFirmaRemota` ed `EsitoVerificaAutorizzazione`.
- Modify: `apps/backend/src/application/rentri/completa-operazione-con-firma.use-case.ts`: limite di attesa (Decisione 1) e SAD dall'esito `AUTORIZZATA`.
- Modify: `tools/rentri-fake/src/routes/ca-rentri.ts` e `src/stato/archivio.ts`:
  - `authorize` risponde 200 `{ handle }`;
  - `authorize-check` risponde:

    | Stato | Risposta |
    |---|---|
    | in attesa | 202 `{ handle }` |
    | concessa | 200 `{ sad, expires_in, handle }` |
    | scaduta | 400 |
    | rifiutata | 403 |
  - il canale di controllo che oggi simula conferma, rifiuto e scadenza resta, ma produce questi codici.
- Test: lo spec del client, `completa-operazione-con-firma.use-case.spec.ts`, i test del simulatore su `ca-rentri` e gli oracoli della firma.

**Interfaces:**
- `autorizzaFirmaRemota(...)` restituisce `Promise<{ handle: string; sad?: string; expiresIn?: number }>`. Senza `handle` solleva un errore esplicito. `sad` ed `expires_in` sono facoltativi.
- `verificaAutorizzazioneFirma(...)` restituisce `Promise<{ stato: 'IN_ATTESA' } | { stato: 'AUTORIZZATA'; sad: string; expiresIn?: number } | { stato: 'SCADUTA' } | { stato: 'RIFIUTATA' }>`. Con 200 e senza `sad` solleva un errore esplicito; con 422 solleva un errore esplicito "La notifica al dispositivo per la firma non è stata inviata" (Decisione 2). I nomi dei campi dell'unione esistente si adattano a quelli attuali del file, se diversi.
- Lo use case:
  - `export const ATTESA_CONFERMA_FIRMA_PREDEFINITA_S = 120`;
  - limite di attesa = `autorizzazione.expiresIn ?? ATTESA_CONFERMA_FIRMA_PREDEFINITA_S`;
  - se `authorize` porta già `sad`, si firma subito senza polling;
  - altrimenti si usa il `sad` dell'esito `AUTORIZZATA`.

- [ ] **Step 1: test che falliscono.**
  - Client:
    - `'authorize senza sad né expires_in è valido: restituisce handle'`;
    - `'authorize senza handle → errore esplicito'`;
    - `'authorize-check 200 → AUTORIZZATA con sad dal corpo'`;
    - `'authorize-check 200 senza sad → errore esplicito'`;
    - `'authorize-check 400 → SCADUTA'`;
    - `'authorize-check 403 → RIFIUTATA'`;
    - `'authorize-check 422 → errore notifica non inviata'`;
    - `'authorize-check 410 non è più un esito'`: 410 cade nella gestione generica.
  - Use case:
    - `'il SAD di sign-hash è quello di authorize-check'`;
    - `'authorize con sad immediato: firma senza polling'`;
    - `'senza expires_in il limite di attesa è 120 secondi'`.
  - Simulatore: i codici della tabella qui sopra.
- [ ] **Step 2:** esegui i test. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui:
  - i test dello Step 1;
  - la suite del simulatore con `--runInBand`;
  - `npm run test:oracolo -- rentri-firma-operazione rentri-accettazione rentri-annullamento`;
  - `npx tsc --noEmit -p apps/backend`.

  Atteso: PASS.
- [ ] **Step 5:** aggiorna la testata del simulatore e il commento di `CA_RENTRI_PATH`. I passi info e authorize passano da "non ancora allineati" ad allineati; resta dichiarato solo ciò che resta davvero non verificato, cioè la firma RSA del simulatore contro l'ECDSA dell'ente.
- [ ] **Step 6: commit** `fix(rentri): authorize e authorize-check con la semantica del contratto ca-rentri`.

## Verifica finale

- [ ] `grep -rn "certificato'\|410" apps/backend/src/infrastructure/rentri/rentri-api.client.ts`: nessun riferimento al vecchio campo né al 410 di `authorize-check`.
- [ ] Suite del simulatore verde con `--runInBand`.
- [ ] Oracoli RENTRI del backend verdi. Fa eccezione il test `/metrics` con Prometheus reale, che è ambientale; il rate limiter richiede Redis su 16399.
