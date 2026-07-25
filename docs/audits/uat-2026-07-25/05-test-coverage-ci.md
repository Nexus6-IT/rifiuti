# 05 — Test Coverage & CI Audit (WasteFlow / rifiuti)

Data: 2026-07-25. Branch analizzato: `develop` (working tree locale, non pushato).
Scope: fotografia onesta dello stato di test e CI, per orientare le priorità della UAT.
Nessuna modifica al codice sorgente né nuovi test sono stati scritti in questa fase.

---

## 1. Inventario suite esistenti

| Suite | Percorso | Runner | File | Wired a un comando eseguibile? |
|---|---|---|---|---|
| Backend unit (co-locati) | `apps/backend/src/**/*.spec.ts` | Jest (`apps/backend/jest.config.js`, rootDir `src`) | 87 file / 766 test | **Sì** — `npm run test` / `test:cov` (root `backend:test*`) |
| Backend e2e | `apps/backend/test/*.e2e-spec.ts` | Jest (`test/jest-e2e.json`) | 4 file (`auth-spid`, `fir-workflow`, `fir-signatures`, `rentri-sync`) | Sì come comando (`npm run test:e2e`), ma **non gira in nessun workflow CI** |
| Backend integration (sotto `test/`) | `apps/backend/test/integration/*.e2e-spec.ts`, `test/unit/**` | Stesso `jest-e2e.json` | 1 e2e-spec + 3 unit spec (temporary-permission) + 1 `integration/setup.ts` condiviso | Idem, non in CI |
| Backend performance (k6) | `apps/backend/test/performance/load-test.js` | k6 (non npm/jest) | 1 script | **No** — richiede binario `k6`, nessun job lo esegue |
| Root `tests/backend/unit` | `tests/backend/unit/**/*.spec.ts` | Nessuno — sono `.spec.ts` Jest ma **nessun jest.config li referenzia** | 12 file (domain identity-access, application commands/queries feature 002 ruoli/permessi) | **No — file orfani**, non raggiungibili da nessun comando esistente |
| Root `tests/backend/integration` | `tests/backend/integration/*.integration.spec.ts` | Idem | 5 file (multi-tenant-isolation, custom-role, role-assignment, spid-reauth, audit-log-integrity, consultant-multi-tenant) | **No — orfani** |
| Root `tests/backend/e2e` | `tests/backend/e2e/consultant-workflow.e2e.spec.ts` | Idem | 1 file | **No — orfano** |
| Root `tests/performance` | `tests/performance/permission-guard.perf.spec.ts` | Jest-style ma import diretti da `../../apps/backend/src/...` | 1 file | **No — orfano**, nessun config lo esegue |
| Root `tests/load` | `tests/load/permission-checks.js` | k6 | 1 script | **No** — richiede k6 |
| Frontend unit (co-locati) | `apps/frontend/src/**/*.spec.ts` | Karma/Jasmine (`ng test`, `tsconfig.spec.json` include `src/**/*.spec.ts`) | **2 file soli**: `auth.service.spec.ts` (12 test), `fir.service.spec.ts` (8 test) | Sì, gira in CI |
| Root `tests/frontend/unit` | `tests/frontend/unit/features/permissions/**` | Karma/Jasmine ma **fuori da `tsconfig.spec.json`** (che include solo `src/**`) | 2 file (direttiva `has-permission`, pipe `permission-format`) | **No — orfani**, `ng test` non li vede |
| Cypress (in `apps/frontend/cypress/`) | `apps/frontend/cypress/e2e/**/*.cy.ts` | Cypress | 2 file: `spid-login.cy.ts`, `permissions/temporary-permission-workflow.cy.ts` | **No — `cypress` non è nemmeno una dipendenza npm del progetto** (assente da tutti i `package.json` e da `package-lock.json`) |
| Root `tests/frontend/e2e/cypress` | `tests/frontend/e2e/cypress/permissions/*.cy.ts` | Cypress | 2 file: `mobile-permission-discovery.cy.ts`, `offline-permissions.cy.ts` | **No** — stesso motivo, e comunque fuori dal `specPattern` di `apps/frontend/cypress.config.ts` |

**Nota sul punto 4 della richiesta**: è confermato che l'area effettivamente "coperta" da spec Cypress è solo `permissions` (4 file su 4 totali, sparsi in due directory diverse) — ma **nessuno di questi 4 file è eseguibile oggi**, perché Cypress non risulta installato in nessun `package.json`/lockfile del repo. Il pacchetto Cypress non è mai stato aggiunto come devDependency: `cypress.config.ts` e le spec sono stati scritti ma il tool non è mai stato collegato al progetto.

---

## 2. Esecuzione reale delle suite

### 2.1 Backend — unit (`npx jest --testPathPattern=src --ci --runInBand --coverage`, timeout 580s)

```
Test Suites: 87 passed, 87 total
Tests:       766 passed, 766 total
Time:        95.881 s
```

Tutti i test **passano**. Ma la copertura globale è molto sotto le soglie configurate in `apps/backend/jest.config.js`:

```
Jest: "global" coverage threshold for statements (80%) not met: 35.05%
Jest: "global" coverage threshold for branches (75%) not met: 29.98%
Jest: "global" coverage threshold for lines (80%) not met: 35%
Jest: "global" coverage threshold for functions (80%) not met: 34.56%
```

**Verificato exit code**: `1` (fallimento). Questo significa che `npm run test:cov` (lo step "Test (Jest + coverage)" di `.gitea/workflows/ci.yml`) **fallisce oggi**, anche se tutti i 766 test individuali sono verdi — la pipeline CI backend è rossa per soglia di coverage non raggiunta, non per test rotti.

Nota: `.gitea/workflows/deploy.yml` invece usa `npx jest --testPathPattern="src" --forceExit --ci --runInBand` **senza** `--coverage`, quindi il gate di deploy su `master`/`develop` NON controlla la soglia — solo che i test passino. Questo spiega perché i deploy passano nonostante `ci.yml` sia rosso: sono due gate diversi, con criteri diversi.

### 2.2 Backend — e2e/integration (`npx jest --config ./test/jest-e2e.json --ci`)

```
FAIL test/rentri-sync.e2e-spec.ts
FAIL test/fir-workflow.e2e-spec.ts
FAIL test/fir-signatures.e2e-spec.ts
FAIL test/auth-spid.e2e-spec.ts
FAIL test/integration/fir.e2e-spec.ts
Test Suites: 5 failed, 5 total
Tests:       0 total
```

**0 test eseguiti** — tutte e 5 le suite falliscono in fase di **compilazione TypeScript**, prima ancora di partire. La causa è drift dello schema Prisma rispetto a `test/integration/setup.ts` (helper condiviso da tutte le suite e2e):

- `RolePermission` non accetta più `permissions: string[]` diretto sul create (probabilmente ora è relazione many-to-many via join esplicito) — errore TS2322 su `test/integration/setup.ts:150`.
- Il modello `User` non ha più il campo `passwordHash` (probabilmente rinominato o rimosso a favore di auth solo Keycloak/SAML) — errori TS2353 su più righe.
- `PrismaService` non espone più `userPermission` (rinominato in `permission`?) — errori TS2551.
- `import * as request from 'supertest'` non è più chiamabile come funzione con la versione di `supertest`/target TS attuale (namespace import vs default import) — TS2349.

Questo significa che **l'intera suite e2e backend (FIR workflow completo, firme, auth SPID, sync RENTRI) è rotta e ferma da un tempo indeterminato** — probabilmente da quando lo schema Prisma è stato aggiornato (rimozione auth locale a favore di Keycloak, ristrutturazione permessi) senza allineare l'helper di setup dei test e2e. Non è un problema di ambiente locale: è un errore di compilazione che si presenterebbe identico in qualunque CI.

Il processo Jest ha inoltre prodotto un errore Node non gestito (`EPERM` su `ChildProcess.kill`) alla chiusura dei worker — questo è un artefatto di ambiente Windows/jest-worker (kill di processi figli su Windows), non un bug applicativo; annotato per completezza ma non è il problema reale.

### 2.3 Frontend — unit (`npx ng test --watch=false --browsers=ChromeHeadless`)

```
Chrome Headless ... Executed 20 of 20 (8 FAILED)
TOTAL: 8 FAILED, 12 SUCCESS
```

Exit code verificato: `1`. Quindi anche lo step "Test (Karma + ChromeHeadless)" di `.gitea/workflows/ci.yml` **fallisce oggi** (il commento nel workflow dice "non imponiamo soglia di coverage per non far fallire la pipeline" — ma qui il fallimento non è di soglia, sono proprio 8 test rossi).

Tutti gli 8 test falliti sono in `fir.service.spec.ts` (tutti gli 8 test del file, cioè il 100% di quel file):
`getFIRList` (x2), `getFIRById`, `createFIR`, `emettiFIR`, `presaInCarico`, `annullaFIR`, `confermaConsegna`.

Causa: drift URL API. Le spec fanno match su richieste verso `/api/fir/...` (nessun prefisso versione), ma il servizio reale (`fir.service.ts`) costruisce l'URL come `${environment.apiUrl}/fir` e `environment.apiUrl = 'http://localhost:3000/api/v1'` → le richieste reali vanno a `/api/v1/fir/...`. Le spec non sono mai state aggiornate dopo l'introduzione del versioning `/api/v1` sul backend. `auth.service.spec.ts` (12 test) passa interamente.

---

## 3. Coverage — dettaglio per area (dal run 2.1)

Soglia configurata (`apps/backend/jest.config.js`): 80% lines/statements/functions, 75% branches, **globale** — non raggiunta (35% circa). Aree a **0% di copertura** (nessun test le tocca mai), rilevanti per il rischio prodotto:

- `infrastructure/backup/backup.service.ts` — **0%**
- `infrastructure/pdf/pdf.service.ts` — **0%** (generazione PDF FIR/formulari)
- `infrastructure/email/template.service.ts` — 0%; `email.service.ts` 15%
- `infrastructure/security/input-sanitization.service.ts` — **0%**
- `infrastructure/storage/s3.service.ts` — **0%**
- `infrastructure/logging/structured-logger.service.ts`, `monitoring/*` — 0%
- `infrastructure/jobs/*` (audit-logging, expire-temp-permissions, cleanup-old-permission-requests, warm-permission-cache) — **0%** (i job schedulati non sono testati)
- `infrastructure/keycloak/keycloak-user.adapter.ts` — **0%** (473 righe, mapping utenti SSO)
- `infrastructure/caching/cache-strategy.service.ts` — 0%
- `infrastructure/persistence/*-prisma.repository.ts` per FIR, CER, destinatario, trasportatore, consultant-tenant-association, role-change-history — quasi tutti **0%** (i repository concreti non sono testati, solo gli aggregate/entity di dominio)
- `domain/identity-access/consultant-tenant-association.entity.ts`, `role-change-history.entity.ts`, `role.entity.ts` — **0-5%** (nonostante la feature 002 ruoli/permessi abbia una suite dedicata molto più ricca in `tests/backend/` — che però è orfana, vedi §1)
- `domain/notification/notification.entity.ts` — **3%**
- `domain/rentri/rentri-sync-log.aggregate.ts` — **0%**
- `domain/pdf/entities/company-template.entity.ts` — **0%**
- `application/admin/*` (tenant.service.ts, user-admin.service.ts, impersonation.service.ts, feature-catalog.ts, system-roles.ts) — **nessun file `.spec.ts` esiste**, quindi 0% de facto (provisioning tenant/utenti SUPER_ADMIN, funzione live in produzione secondo la memoria di progetto)

Aree con buona copertura (>80%):
- `domain/fir` (aggregate, value objects, eventi) — 82-100%
- `domain/waste-movement` — 98%
- `infrastructure/rentri` (client, auth, crypto, jws, pkcs12, signature) — 84-100%
- `domain/registry/value-objects` — 95%
- `domain/cer/services/cer-catalog.service.ts` — 92%
- `application/billing/*` — passano (billing.service, subscription-enforcement) ma coverage numerica non isolata dal report aggregato
- `core/interceptors/tenant-switch.interceptor.ts`, `infrastructure/persistence/tenant-isolation.spec.ts` — presenti e verdi

---

## 4. Stato CI (`.gitea/workflows/`)

Non esiste `.github/workflows/` in questo repo (nessuna migrazione GHA da disattivare qui — coerente con il fatto che il progetto è nato Gitea-first, vedi memoria).

### `ci.yml` — gira su push/PR verso `develop`/`master`, nessun deploy

| Job | Step critico | Esito reale (verificato oggi) |
|---|---|---|
| backend | `npm run test:cov` | **FALLISCE** — soglia coverage 80/75/80/80% non raggiunta (~35% reale). I 766 test sottostanti passano tutti. |
| frontend | `npm run test -- --watch=false --browsers=ChromeHeadless` | **FALLISCE** — 8/20 test rossi in `fir.service.spec.ts` per drift URL `/api/fir` vs `/api/v1/fir` |
| security (npm audit) | `npm audit --audit-level=high \|\| true` | Non bloccante per costruzione (`\|\| true`), quindi "verde" a prescindere dagli esiti |

Il file stesso documenta nei commenti i gap noti (soglia coverage 80%, "pochissimi test frontend", audit non bloccante) — è quindi un rosso **atteso e già annotato dal team**, non una sorpresa. Confermato con esecuzione diretta che è tuttora rosso su entrambi i job applicativi.

### `deploy.yml` — gira su push a `develop`/`master`, deploya in prod solo su `master`

Il job `quality` (gate pre-build/deploy) esegue i test backend **senza coverage** (`npx jest --testPathPattern="src" --forceExit --ci --runInBand`) e il lint backend/frontend, ma **non esegue affatto i test frontend** (`ng test` non compare in `deploy.yml`) — solo lint frontend. Questo significa che gli 8 test frontend rotti **non bloccano il deploy in produzione**, e la soglia di coverage backend nemmeno. Il gate di deploy è quindi strutturalmente più permissivo del gate CI, ed è quello realmente attivo su `master` (dove gira anche il deploy vero e proprio su Contabo).

Né `ci.yml` né `deploy.yml` eseguono: e2e backend (`test/*.e2e-spec.ts`), integration backend (`test/integration/*.e2e-spec.ts`), Cypress, k6/performance, o le suite orfane sotto `tests/` a root. Questi livelli di test sono quindi **completamente fuori da ogni automazione**: l'unica verifica possibile oggi è manuale/UAT.

---

## 5. Matrice di rischio per la UAT

Legenda copertura: **Buona** = suite unit presente e superiore all'80% sulle parti toccate, o suite dedicata funzionante; **Parziale** = qualche test esiste ma con gap seri (0% su repository concreti, e2e rotto, o suite orfana non eseguibile); **Nessuna** = 0% reale e nessun file `.spec.ts` individuato.

| Area funzionale | Criticità business | Copertura test attuale | Gap principale | Priorità UAT |
|---|---|---|---|---|
| **FIR (ciclo di vita)** | Alta (core business) | Parziale | Unit domain/application solidi (82-100%), ma **e2e `fir-workflow`/`fir-signatures` non compilano** e **8/8 test frontend `fir.service` falliscono** per drift API `/api/fir` vs `/api/v1/fir` | **P0** |
| **Permessi/RBAC** | Alta (sicurezza, isolamento multi-tenant) | Parziale | Suite dedicata ricca (feature 002: 18 file unit+integration+e2e) è **completamente orfana**, non gira mai; coverage reale in `apps/backend/src` su identity-access solo 46% (alcune entity 0-5%) | **P0** |
| **Auth/SPID** | Alta (unico accesso al sistema) | Parziale | `keycloak-saml.strategy` 97%, ma `keycloak-user.adapter` 0%; **e2e `auth-spid` non compila**; Cypress `spid-login.cy.ts` esiste ma **Cypress non è installato** | **P0** |
| **RENTRI** | Alta (obbligo normativo, invio formulari) | Parziale | Client/crypto/firma ben coperti (84-100%), ma **e2e `rentri-sync` non compila** e il job di sync (`rentri-sync.job.ts`) è solo al 53% | **P0** |
| **Admin tenant/utenti (SUPER_ADMIN)** | Alta (provisioning, sicurezza multi-tenant, feature live) | Nessuna | `application/admin/*` (tenant.service, user-admin.service, impersonation.service) **non ha nessun file `.spec.ts`** | **P0** |
| **Registro art.190 / anagrafiche (produttore/destinatario/trasportatore)** | Alta (obbligo legale) | Parziale | Domain/value-objects coperti bene, ma repository Prisma concreti quasi a 0% (persistenza reale non testata) | **P1** |
| **MUD** | Alta (adempimento annuale) | Parziale | 4 spec unit su application/mud, nessun integration/e2e | **P1** |
| **CER** | Media-alta | Parziale | `cer-catalog.service` 92%, ma `cer-code.vo.ts` e `cer-prisma.repository.ts` 0% | **P1** |
| **Notifiche** | Media | Nessuna | `notification.entity.ts` 3%, nessun test sui job (`audit-logging.job`, ecc.) | **P1** |
| **Backup** | Alta (perdita dati) | Nessuna | `backup.service.ts` 0% | **P1** |
| **Dashboard** | Media (visibilità operativa, non transazionale) | Nessuna | Nessuno unit test individuato lato frontend (solo 2 file spec totali in tutto il frontend) | **P1** |
| **Giacenze** | Media | Parziale | 2 spec su application/giacenze, nessuna integration | **P2** |
| **Contratti** | Media | Parziale | 2 spec su application/contracts | **P2** |
| **ESG** | Bassa-media | Parziale | 3 spec su application/esg | **P2** |
| **Anomalie** | Media | Parziale | 2 spec su application/anomaly | **P2** |
| **Billing** | Media (impatto economico ma non compliance) | Buona | `billing.service` e `subscription-enforcement.service` spec presenti e verdi | **P2** |

Priorità UAT ordinata (P0 → in cima):
1. Auth/SPID (unico ingresso al sistema — un regression qui blocca tutto)
2. Permessi/RBAC (isolamento multi-tenant, sicurezza — suite esistente ma orfana, va rivalidata manualmente)
3. FIR — ciclo di vita completo (core business, e2e e frontend rotti)
4. RENTRI (obbligo normativo, sync e2e rotto)
5. Admin tenant/utenti SUPER_ADMIN (provisioning, zero test automatici)
6. Registro art.190 / anagrafiche, MUD, CER, Notifiche, Backup, Dashboard (P1)
7. Giacenze, Contratti, ESG, Anomalie, Billing (P2)

---

## 6. Cose che NON sono state verificate (onestà sui limiti dell'audit)

- Non è stato eseguito alcun test e2e Cypress reale (impossibile: Cypress non installato). Non è stato installato per non alterare lo stato del repo/lockfile durante un audit di sola lettura.
- Non è stato eseguito il backend e2e/integration dopo un fix ipotetico dello schema drift — non essendo questa una fase di correzione, l'errore di compilazione è stato solo diagnosticato, non riprodotto "risolto".
- Non sono stati eseguiti gli script k6 (`tests/load/permission-checks.js`, `apps/backend/test/performance/load-test.js`) — richiedono il binario `k6` e un ambiente applicativo up (DB/Redis/API in esecuzione), fuori scope per un audit statico.
- Il coverage per singolo modulo `application/*` non è sempre isolabile dal report aggregato Jest quando il modulo non compare come riga separata (es. `application/admin` non compare proprio nel report perché non ha file sorgente "coperto" da alcun test — trattato come 0% de facto, coerente con l'assenza di spec file).
- Non è stato verificato lo storico delle run CI reali su Gitea (nessun accesso rete/API Gitea in questa sessione) — le conclusioni su `ci.yml`/`deploy.yml` sono basate sulla **riproduzione locale** dei comandi esatti definiti nei workflow, non sui log delle run passate.
