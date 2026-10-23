# Piano B RENTRI, pezzo 2: percorso ufficiale della firma remota (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** la firma remota del digest va al percorso del contratto, `POST /ca-rentri/v1.0/signatures/sign-hash`. Oggi va a `/ca-rentri/v1.0/credentials/sign-hash`, che il contratto non contiene: contro l'ente reale ogni firma remota (accettazione, annullamento, operazioni firmate dei FIR) fallirebbe. Inoltre un test impedisce che la fake RENTRI esponga di nuovo rotte assenti dai contratti, che è il motivo per cui il difetto non è mai emerso.

**Architettura:**
- **Prima la protezione:** un test della fake confronta ogni rotta registrata con i path del contratto del suo servizio (prefisso → file YAML). Diventa rosso subito, su `/credentials/sign-hash`.
- **Poi la correzione,** in un unico commit su fake, client e commenti.

**Tech Stack:** Fastify (fake in `tools/rentri-fake`, test Jest), NestJS backend (Jest, oracolo in-process).

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 2, secondo trattino.
- `C:\Progetti\winwaste\docs\rentri\04-confronto-con-rifiuti.md`, difetto (b).
- Contratto `docs/contracts/rentri/ca-rentri.yaml`:
  - righe 2019-2089: `/signatures/sign-hash`, corpo `SignatureRequest`, risposta `SignatureResponse { signatures: string[] }`;
  - riga 2090: `/signatures/signHash`, deprecato;
  - schemi alle righe 3517-3569.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b2-sign-hash` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b1-idempotenza-fir` @ `1e2236a`. Va in merge dopo il pezzo 1. I `node_modules` sono già installati in locale.
- **TDD obbligatorio:** prima il test, poi guardarlo fallire.
- **Comandi:**
  - fake: `cd tools/rentri-fake && npx jest <file>`;
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - oracolo: `npm run test:oracolo -- <pattern>`.
  - Mai la suite intera del backend.
- **Lingua:** commenti e messaggi in italiano; termini tecnici in inglese.
- **Commit senza attribuzione AI.**
- **Si usa solo il percorso non deprecato** (`sign-hash`, non `signHash`).

## Review Focus

1. **Una rotta della fake senza riscontro nel contratto:** il test la nomina con metodo e path. Nessuna eccezione silenziosa.
2. **Il canale di controllo `/__controllo/...` e le rotte tecniche della fake** (salute, token) non sono rotte dell'ente: sono escluse per prefisso, con un elenco esplicito.
3. **Path con parametri** (`:handle` nella fake, `{handle}` nel contratto): il confronto li normalizza.
4. **Il vecchio percorso `/credentials/sign-hash` dopo la correzione risponde 404** dalla fake, quindi un client rimasto indietro fallisce nei test invece di passare.
5. **Corpo della richiesta:** il client continua a mandare `credentials_id`, `sad`, `hashes` (un solo elemento) e `sign_algo`, come vuole `SignatureRequest`.

---

### Task 1: protezione, le rotte della fake esistono nei contratti

**Files:**
- Create: `tools/rentri-fake/test/rotte-allineate-ai-contratti.test.ts`

**Interfaces:**
- Produces: nessuna interfaccia di produzione, solo il test.
- **Raccolta delle rotte:** l'hook `onRoute` di Fastify, registrato su un'istanza creata come in `creaApp()`. Se `creaApp` non permette di agganciare l'hook prima della registrazione, la raccolta parte da `app.printRoutes({ commonPrefix: false })` o dall'equivalente disponibile nella versione installata, letta e normalizzata.
- **Mappa prefisso → contratto:**

  | Prefisso | Contratto |
  |---|---|
  | `/anagrafiche/v1.0` | `anagrafiche.yaml` |
  | `/ca-rentri/v1.0` | `ca-rentri.yaml` |
  | `/codifiche/v1.0` | `codifiche.yaml` |
  | `/dati-registri/v1.0` | `dati-registri.yaml` |
  | `/formulari/v1.0` | `formulari.yaml` |
  | `/vidimazione-formulari/v1.0` | `vidimazione-formulari.yaml` |

  I file stanno in `docs/contracts/rentri/`; il path si risolve dalla radice del repo.
- **Rotte escluse:** quelle che non iniziano con nessuno dei prefissi della mappa (canale di controllo, token, salute), elencate nel test in una costante `PREFISSI_TECNICI_ESCLUSI`. Una rotta che non sta né nella mappa né negli esclusi fa fallire il test.
- **Confronto:**
  - sul contratto, `paths` → chiave più metodi presenti (get/post/put/patch/delete);
  - sulla fake, `:param` → `{param}`. Il nome del parametro non conta: si confronta la forma con `{}`.
- **Scostamenti noti di altri servizi:** se il test trova scostamenti fuori da `ca-rentri`, non si correggono in questo piano. Vanno in una costante `SCOSTAMENTI_NOTI` con un commento per voce: metodo, path e perché resta, per esempio "rotta 501 segnaposto". Il controllo deve fallire anche se una voce di `SCOSTAMENTI_NOTI` non è più uno scostamento, così l'elenco non invecchia.

- [ ] **Step 1: scrivi il test** `describe('rotte della fake allineate ai contratti RENTRI')`:
  - `it('ogni rotta della fake esiste nel contratto del suo servizio')`: elenca gli scostamenti come `METODO path` e si aspetta una lista vuota, al netto di `SCOSTAMENTI_NOTI`;
  - `it('nessuna voce di SCOSTAMENTI_NOTI è superata')`.
- [ ] **Step 2: esegui** `cd tools/rentri-fake && npx jest test/rotte-allineate-ai-contratti.test.ts`. Atteso: FAIL, con `POST /ca-rentri/v1.0/credentials/sign-hash` nell'elenco. Gli altri scostamenti che compaiono vanno in `SCOSTAMENTI_NOTI` con il motivo, dopo averli verificati uno per uno sul contratto. `/credentials/sign-hash` **non** ci va: resta rosso e lo corregge il Task 2.
- [ ] **Step 3:** nessun codice di produzione. Il test resta rosso solo per `ca-rentri`.
- [ ] **Step 4: commit** del test rosso con il messaggio `test(rentri-fake): le rotte della fake devono esistere nei contratti`. È l'unico commit con un test rosso; il Task 2 lo porta a verde. Nel report va riportato l'output rosso esatto.

### Task 2: firma remota sul percorso del contratto

**Files:**
- Modify: `tools/rentri-fake/src/routes/ca-rentri.ts` (rotta a riga ~197) e i commenti di `tools/rentri-fake/src/stato/archivio.ts` (righe ~246 e ~379).
- Modify: `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`, `firmaHashRemoto` (righe ~1048-1090).
- Modify: commenti in `apps/backend/src/application/rentri/completa-operazione-con-firma.use-case.ts:142` e negli spec oracolo che citano il vecchio percorso. I nomi si trovano con `grep -rn "credentials/sign-hash" apps/backend/src tools/rentri-fake`.
- Test:
  - `apps/backend/src/infrastructure/rentri/rentri-api.client.spec.ts`;
  - `tools/rentri-fake/test/rotte-allineate-ai-contratti.test.ts` (Task 1);
  - un test della fake sul vecchio percorso, nel file di test della fake che copre `ca-rentri` se esiste, altrimenti nuovo `tools/rentri-fake/test/ca-rentri-sign-hash.test.ts`.

**Interfaces:**
- **Firma invariata:** `firmaHashRemoto(tenantId, richiesta): Promise<string>`. Cambia solo l'URL: `${CA_RENTRI_PATH}/signatures/sign-hash`. Il contesto dei log e degli errori diventa `'/ca-rentri/signatures/sign-hash'`.
- **Il commento** "Forma della risposta assunta, non confermata da fonte ufficiale" diventa: "Forma della risposta dal contratto: `SignatureResponse { signatures: string[] }` (ca-rentri.yaml righe 3560-3569)".

- [ ] **Step 1: test che falliscono.**
  - Nel client:
    - `'firmaHashRemoto chiama POST /ca-rentri/v1.0/signatures/sign-hash'`: verifica l'URL passato a `httpService.post`;
    - `'firmaHashRemoto manda il corpo di SignatureRequest'`: `credentials_id`, `sad`, `hashes` con un solo elemento, `sign_algo` = `1.2.840.10045.4.3.2`.
  - Nella fake: `'POST /ca-rentri/v1.0/credentials/sign-hash risponde 404'`.
- [ ] **Step 2: esegui** i due test. Atteso: FAIL, perché l'URL è il vecchio e la fake risponde sul vecchio percorso.
- [ ] **Step 3: implementa.** Sposta la rotta della fake su `/signatures/sign-hash`, cambia l'URL nel client e aggiorna i commenti.
- [ ] **Step 4: verifica.** Esegui:
  - i test dello Step 2;
  - il test del Task 1, che ora deve essere verde;
  - tutta la cartella di test della fake (`npx jest` in `tools/rentri-fake`);
  - `npm run test:oracolo -- rentri-firma-operazione rentri-accettazione rentri-annullamento`;
  - `npx tsc --noEmit -p apps/backend`.

  Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): firma remota sul percorso del contratto /signatures/sign-hash`.

## Verifica finale

- [ ] `grep -rn "credentials/sign-hash" apps/backend/src tools/rentri-fake/src`: nessun risultato.
- [ ] Tutti i test della fake verdi.
- [ ] Oracoli RENTRI del backend verdi. Fa eccezione il test `/metrics` con Prometheus reale, che è ambientale; il rate limiter richiede Redis su 16399.
