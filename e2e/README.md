# E2E — WasteFlow (Playwright)

Suite End-to-End con [Playwright](https://playwright.dev/). Sostituisce
Cypress (configurato nel repo ma mai installato, spec ineseguibili) come
strumento E2E del progetto.

## Struttura

```
e2e/
  playwright.config.ts   # config: baseURL da env, reporter, trace/video/screenshot
  utils/
    env.ts                # risoluzione baseURL/apiUrl/credenziali per ruolo
    blacklist.ts           # endpoint distruttivi + matcher (guardrail)
  fixtures/
    auth.ts                # login Keycloak SAML per ruolo + storage state
    guardrail.ts            # route interception che blocca endpoint distruttivi
  pages/                  # Page Object Model (login, dashboard, FIR, registro, anagrafiche, admin, permessi)
  tests/
    public/               # girano SENZA credenziali, devono passare oggi
    auth/                  # ciclo di login (skip se mancano credenziali)
    rbac/                  # accesso per ruolo a rotte/API (skip se mancano credenziali)
    fir/                   # ciclo di vita FIR (scheletro, fixme finché mancano dati/credenziali)
    registro/              # registro C/S (scheletro)
    admin/                 # impersonificazione, tenant switch (scheletro)
  scripts/
    run-against-prod.js    # wrapper esplicito per l'esecuzione contro produzione
  SELECTORS-DEBT.md        # debito data-testid da aggiungere al frontend
```

## Esecuzione in locale

Prerequisiti: backend (`npm run backend:dev`, porta 3000) e frontend
(`cd apps/frontend && npm start`, porta 4200 — Angular `ng serve` di default)
in esecuzione.

```bash
npm install                 # installa @playwright/test (root package.json)
npx playwright install      # scarica i browser (chromium/firefox/webkit)

npm run e2e                 # chromium, headless
npm run e2e:headed          # chromium, con finestra browser
npm run e2e:ui               # Playwright UI mode (debug interattivo)
npm run e2e:report           # apre l'ultimo report HTML (e2e-report/)
```

Senza `E2E_BASE_URL` impostata, il target di default è
`http://localhost:4200` (frontend Angular locale) — **mai** produzione.

### Solo la suite pubblica (nessuna credenziale richiesta)

```bash
npx playwright test -c e2e/playwright.config.ts tests/public
```

## Variabili d'ambiente

| Variabile | Default | Note |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:4200` | baseURL del frontend. Impostarla a un host non-locale richiede anche `E2E_ALLOW_PROD_RUN=1` (vedi sotto) o playwright.config.ts rifiuta di partire. |
| `E2E_API_URL` | derivato (`http://localhost:3000/api/v1` in locale, `${E2E_BASE_URL}/api/v1` se `E2E_BASE_URL` è di produzione) | Solo per i test `public/` che chiamano l'API direttamente via `request` fixture. |
| `E2E_ADMIN_USER` / `E2E_ADMIN_PASS` | — | Credenziali ruolo ADMIN. Se assenti, tutti i test che le richiedono fanno `test.skip()` con messaggio esplicito. |
| `E2E_OPERATOR_USER` / `E2E_OPERATOR_PASS` | — | Credenziali ruolo OPERATOR. |
| `E2E_VIEWER_USER` / `E2E_VIEWER_PASS` | — | Credenziali ruolo VIEWER. |
| `E2E_SUPERADMIN_USER` / `E2E_SUPERADMIN_PASS` | — | Credenziali ruolo SUPER_ADMIN (impersonificazione, tenant switch, admin tenants). |
| `E2E_ALLOW_PROD_RUN` | — | Impostata automaticamente da `npm run e2e:prod` (`e2e/scripts/run-against-prod.js`). Non impostarla manualmente. |

Nessuna di queste credenziali è disponibile in questo ambiente al momento
della stesura di questa suite (2026-07-25) — vedi "Cosa manca" sotto.

## Eseguire contro produzione

Non esiste un modo implicito di puntare a `https://rifiuti.ignicraft.com`:
`playwright.config.ts` **rifiuta di avviarsi** se `E2E_BASE_URL` punta a un
host non-locale e `E2E_ALLOW_PROD_RUN` non è `"1"`.

```bash
npm run e2e:prod                 # esegue SOLO tests/public (read-only, sicuro)
npm run e2e:prod -- tests/auth   # esplicito, sconsigliato senza motivo forte
```

`e2e:prod` (`e2e/scripts/run-against-prod.js`) imposta lui stesso
`E2E_BASE_URL=https://rifiuti.ignicraft.com` e `E2E_ALLOW_PROD_RUN=1` — è
l'unico punto della suite che lo fa. Di default esegue solo `tests/public/`.

## Guardrail di sicurezza (endpoint distruttivi)

`e2e/utils/blacklist.ts` elenca gli endpoint distruttivi individuati
nell'audit backend (`docs/audits/uat-2026-07-25/01-api-surface.md`, sezione
"BLACKLIST distruttivi"):

- `POST /backup/restore`, `DELETE /backup/cleanup`, `POST /backup/create`
- `DELETE /registry/{produttori,trasportatori,destinatari}/:id`
- `PATCH /admin/tenants/:id/status`
- `POST /reference-data/reseed`
- `POST /fir/:id/annulla`
- `DELETE /rentri/credential`

`e2e/fixtures/guardrail.ts` espone una fixture `guardedPage` che installa
una `page.route('**/*', ...)` su Playwright: quando il target corrente è
"di produzione" (`isProductionTarget()` in `utils/env.ts` — qualunque host
diverso da `localhost`/`127.0.0.1`), ogni richiesta che matcha la blacklist
viene **abortita** (`route.abort('blockedbyclient')`) e il test **fallisce**
con un messaggio esplicito che identifica l'endpoint bloccato.

In locale il guardrail resta installato ma non blocca nulla: è lecito
esercitare i path distruttivi contro un database locale/di test con dati
throwaway (es. per testare davvero il flusso di eliminazione anagrafica).

`e2e/tests/public/guardrail-self-test.spec.ts` verifica il matcher stesso
(nessuna chiamata di rete, gira sempre) con casi positivi (i path della
blacklist) e negativi (path simili ma legittimi, per evitare falsi positivi
che romperebbero test legittimi).

**Uso nei test**: importare `test`/`expect` da `../../fixtures/guardrail`
invece che da `@playwright/test`, e usare `guardedPage` invece di `page`
nei test che possono girare contro produzione con un ruolo autenticato
(es. `tests/rbac/*`, `tests/admin/*`).

## Skip condizionale per credenziali mancanti

Ogni test che richiede login usa `hasRoleCredentials(role)` /
`skipReason(role)` da `e2e/fixtures/auth.ts`:

```ts
test.describe('...', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))
  // ...
})
```

Questo produce uno **skip esplicito e visibile nel report** (mai un test
verde che in realtà non ha eseguito nulla, mai un fallimento rumoroso per
credenziali assenti).

## Cosa manca per completare la suite

1. **Credenziali di test** per i 4 ruoli (`E2E_ADMIN_*`, `E2E_OPERATOR_*`,
   `E2E_VIEWER_*`, `E2E_SUPERADMIN_*`) su un tenant di test dedicato (mai
   sul tenant di produzione reale con dati veri).
2. **Verifica del flusso Keycloak reale** (`e2e/fixtures/auth.ts`,
   `e2e/pages/keycloak-login.page.ts`): gli id dei campi (`#username`,
   `#password`, `#kc-login`) sono quelli standard del tema Keycloak, ma il
   tema effettivo usato dal client `rifiuti` non è confermato (vedi TODO nel
   file) — verificare al primo run con credenziali reali.
2bis. **Conferma/smentita del bug sospetto sul `returnUrl`** dopo login SPID
   (audit frontend §5.9, `tests/auth/login-flow.spec.ts` ha un `test.fixme`
   dedicato).
3. **Dati di fixture stabili** per i test in `tests/fir/`, `tests/registro/`
   (un tenant di test con anagrafiche/CER/contratti seed, per non inventare
   ID a runtime) — attualmente sono scheletri con `test.fixme()` e commenti
   `TODO`.
4. **Comportamento UI reale sul 403** per rotte admin raggiunte da
   OPERATOR/VIEWER (nessuna route guard lato Angular — vedi audit §3): il
   test in `tests/rbac/admin-routes-access.spec.ts` verifica solo la
   risposta di rete (401/403), il feedback UI resta un `test.fixme()`.
5. **`data-testid` mancanti** sulle 13+ feature ad alto valore di business
   (FIR, Registro, CER, MUD, Giacenze, Contratti, ESG, Anomalie, Anagrafiche,
   Admin, RENTRI, Billing, Reference-data) — vedi `e2e/SELECTORS-DEBT.md`
   per l'elenco puntuale file-per-file. Finché non vengono aggiunti, i Page
   Object si appoggiano a ruoli ARIA/testo visibile (più fragili ai cambi di
   copy IT).
6. Decidere se riesercitare/rimuovere i componenti "orfani" segnalati
   nell'audit (`header.component.ts`, `tenant-selector.component.ts`,
   `verify-signatures.component.ts`) — impatta quali Page Object sono
   effettivamente utili.

## Fake API RENTRI

I test in `tests/rentri/` richiedono il servizio `rentri-fake`:

```bash
docker compose up -d rentri-fake
```

URL configurabile con `E2E_RENTRI_FAKE_URL` (default `http://localhost:4010`).
La fake è l'oracolo di conformità: rifiuta ciò che RENTRI rifiuterebbe. Il suo
verdetto di fedeltà è in `docs/contracts/rentri/FEDELTA.md`.

Nota: il test sul rifiuto di una chiamata non autenticata verifica **403**,
non 401 — il contratto ufficiale documenta 403 "Operazione non consentita"
per credenziale mancante o non valida (mai 401); la fake è stata corretta
di conseguenza dopo l'irrigidimento della verifica JWT.

## Stato di verifica (2026-07-25)

La suite `tests/public/` è stata eseguita contro `https://rifiuti.ignicraft.com`
(solo richieste read-only, coerente con i vincoli del probe
`docs/audits/uat-2026-07-25/03-prod-unauth-probe.md`) come parte della
consegna di questa infrastruttura. Vedi il messaggio di consegna dell'agente
per l'output completo; il riepilogo è mantenuto qui aggiornato ad ogni run
significativa:

- `guardrail-self-test.spec.ts`: verifica pura del matcher, nessuna rete.
- `app-reachability.spec.ts`: root + deep-link protetti + wildcard.
- `api-protected-endpoints.spec.ts`: ~40 endpoint GET protetti, generati
  dinamicamente da `docs/audits/uat-2026-07-25/01-api-surface.json`.
- `security-headers.spec.ts`: header Helmet su API; gap noto F2 documentato
  (non imposto) sulla root HTML.
- `no-file-leaks.spec.ts`: fallback SPA su path sensibili.
- `swagger-exposure.spec.ts`: gap noto F1 documentato (non imposto).
