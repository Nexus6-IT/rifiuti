# WasteFlow — Analisi completa e UAT end-to-end
## Sintesi esecutiva

**Data:** 2026-07-25
**Ambiente analizzato:** produzione `https://rifiuti.ignicraft.com` (branch `master`) + codice `develop`
**Metodo:** orchestrazione multi-agente — coordinamento e **revisione** su Opus 5, implementazione su agenti Sonnet specializzati per dominio. Nessun finding entra in questo documento senza verifica diretta del coordinatore contro il codice o contro una risposta HTTP reale.

---

## 1. Il quadro in tre righe

L'applicazione è **funzionante e ben protetta sulla superficie non autenticata**: nessuna fuga di dati, CORS fail-closed, rate limiting attivo, TLS valido, 39 endpoint su 45 campionati rispondono correttamente `401`.

Il problema non è il perimetro esterno: è che **la produzione gira codice vecchio**. Il branch `master` non contiene il commit `09d8fd5` (hardening RBAC), fermo su `develop` dal 2026-07-05. Di conseguenza **17 difetti già corretti sono tuttora attivi in esercizio**, tre dei quali critici.

A questo si aggiunge una **non conformità nuova**, emersa in questa sessione e non presente in nessun audit precedente: la regola aziendale della sessione singola non è implementata.

---

## 2. Findings critici

### C1 — Chiunque sia autenticato può ripristinare o azzerare il database di produzione
`BackupController` su `master` monta **solo** `JwtAuthGuard`, senza `RolesGuard` né `@Roles`.

- **Evidenza:** `git show origin/master:apps/backend/src/api/backup/backup.controller.ts` → riga 13 `@UseGuards(JwtAuthGuard)`; `POST create` (19), `POST restore` (32), `DELETE cleanup` (40) privi di vincolo di ruolo.
- **Impatto:** un utente VIEWER (sola lettura) può invocare `POST /api/v1/backup/restore` e sovrascrivere il database di produzione, oppure `DELETE /api/v1/backup/cleanup` e cancellare i backup. Nessuna azione di annullamento possibile.
- **Stato:** già corretto su `develop` (`backup.controller.ts:15` → `@UseGuards(JwtAuthGuard, RolesGuard)`, restore/cleanup `@Roles('SUPER_ADMIN')`). **Non rilasciato.**
- **Rimedio:** promozione `develop` → `master`.

### C2 — Il PDF del MUD viene generato con un tenant hard-coded
- **Evidenza:** `apps/backend/src/api/pdf/pdf.controller.ts:62` su `master` → `generateMUDReport('tenant-id-placeholder', reportYear)`.
- **Impatto:** dichiarazione ambientale generata su dati non appartenenti all'azienda richiedente — fuga di dati fra tenant su un documento a valore legale.
- **Stato:** corretto su `develop`, non rilasciato.

### C3 — Firma digitale FIR senza controllo di ruolo e senza gestione degli errori di dominio
- **Evidenza:** `apps/backend/src/api/fir/fir.controller.v2.ts:101` su `master` → solo `@UseGuards(JwtAuthGuard)`.
- **Impatto:** la firma di un formulario — atto giuridicamente rilevante — è accessibile a ruoli non autorizzati; le violazioni di precondizione producono HTTP 500 anziché un errore comprensibile.
- **Stato:** corretto su `develop`, non rilasciato.

### C4 — [NUOVO] La sessione singola per utente non è implementata
Regola aziendale obbligatoria e trasversale a tutti i progetti: un nuovo login deve invalidare la sessione precedente.

- **Evidenza:** `apps/backend/src/auth/services/redis.service.ts:38-41` — la chiave è `refresh_token:${userId}:${token}`, cioè **una chiave per ogni token**. Ogni login aggiunge una sessione, nessuna viene invalidata. Non esiste alcun modello `Session`/`RefreshToken` fra i 35 modelli Prisma; il logout revoca solo il token presentato.
- **Impatto:** sessioni concorrenti illimitate per utente; un token sottratto resta valido fino a scadenza naturale (7 giorni) anche dopo un nuovo login legittimo.
- **Stato:** **mai implementata**, non è una regressione. Richiede decisione: correggere o autorizzare formalmente un'eccezione per questa applicazione.
- **Rimedio proposto:** chiave per utente (`refresh_token:<userId>` con il token come valore) con sovrascrittura all'emissione; valutare una lista di revoca per gli access token già emessi.

---

## 3. Findings ad alta e media severità

| # | Finding | Severità | Stato |
|---|---|---|---|
| A1 | Scritture senza `RolesGuard` su FIR, registro art. 190, anagrafiche, contratti, billing — un VIEWER può scrivere | ALTA | corretto su `develop`, non rilasciato |
| A2 | Autorizzazione `GET /fir/:id` basata sugli id delle parti anziché sul tenant | ALTA | corretto su `develop`, non rilasciato |
| A3 | Filtro eccezioni globale assente su `master` (nessun `APP_FILTER`) → messaggi Prisma grezzi esposti al client | ALTA | corretto su `develop`, non rilasciato |
| A4 | `@CurrentUser('userId')` errato in `PermissionController` (il payload JWT espone `id`) | ALTA | corretto su `develop`, non rilasciato |
| M1 | Spec OpenAPI completa pubblica in produzione (`/api/docs-json` → 200, 52 KB, 82 path inclusi admin/billing/rentri) | MEDIA | **aperto** |
| M2 | Documento HTML servito da nginx privo di header di sicurezza (l'API li ha via Helmet, il frontend no) | MEDIA | **corretto in questa sessione**, da rilasciare |
| M3 | `POST /auth/dev/login` protetto solo da un check runtime su `NODE_ENV`, non da codice | MEDIA | **corretto in questa sessione** |
| M4 | Doppio controller su `/health`: quale risponde dipende dall'ordine di init dei moduli | MEDIA | **corretto in questa sessione** |
| M5 | `/api/v1/health/detailed` accessibile senza autenticazione (espone environment, uptime, memoria, stato DB) | MEDIA | **corretto in questa sessione**, da rilasciare |
| M6 | Nessun guard di ruolo sulle 34 rotte frontend: un solo `authGuard`, gating admin solo cosmetico nel menu | MEDIA | aperto (per scelta architetturale l'enforcement è lato server, ma oggi il server non enforce — vedi A1) |
| B1 | `Server: nginx/1.24.0 (Ubuntu)` espone versione e distribuzione | BASSA | **corretto in questa sessione** (`server_tokens off`) |
| B2 | `/api/v1/cer/code/{code}` e `/cer/search` rispondono 500 invece di 400 | BASSA | corretto su `develop`, non rilasciato |

**Declassato in revisione:** un agente aveva segnalato `POST /auth/dev/login` come bypass di autenticazione sfruttabile. Verifica: il check `NODE_ENV === 'production'` **esiste e blocca** (`auth.controller.ts:107-114`), e l'ambiente di produzione riporta `environment:"production"`. Il rischio non è attuale ma strutturale → declassato da CRITICA a MEDIA (M3).

---

## 4. Debito strutturale

- **12 controller su 36 sono orfani**, non raggiungibili via HTTP. Fra questi **l'intero sottosistema di permessi granulari** (`@RequirePermission`, `PermissionGuard`), escluso esplicitamente in `permissions.module.ts` per un bug di injection CQRS. L'RBAC fine documentato nelle specifiche **non è mai entrato in esercizio**: l'autorizzazione reale passa solo dai ruoli grossolani `@Roles`.
- **Testing in stato critico:** suite e2e backend che non compilava (drift schema Prisma), 8/8 test FIR frontend rossi per drift di URL, Cypress configurato ma nemmeno installato, coverage reale ~35% contro soglia dichiarata 80%. I due gate CI divergono: `deploy.yml` lascia passare ciò che `ci.yml` blocca.
- **Testabilità del frontend:** `data-testid` presenti in 6 componenti su 64 (~9%). Elenco puntuale del debito in `e2e/SELECTORS-DEBT.md`.

---

## 5. Cosa è stato prodotto e corretto in questa sessione

**Correzioni applicate** (verificate: `tsc --noEmit` pulito, suite backend eseguita, test frontend FIR 9/9):
1. Consolidato il doppio controller `/health` preservando esattamente il contratto di risposta osservato in produzione.
2. `/health/detailed` ora richiede SUPER_ADMIN/ADMIN; `/health` resta pubblico per healthcheck e smoke test.
3. `POST /auth/dev/login` estratto in un controller registrato **solo** fuori produzione: in produzione la rotta non esiste.
4. Allineati gli 8 test FIR frontend all'URL reale del service.
5. Riscritto l'helper e2e backend sullo schema Prisma corrente: la suite ora compila ed esegue (fallisce solo per assenza di database di test).
6. Header di sicurezza + `server_tokens off` su `apps/frontend/nginx.conf`, con CSP tarata su ciò che la SPA usa davvero.

**Deliverable:**
- `06-scenari-uat.md` — 86 scenari UAT in italiano, 18 aree, ognuno marcato `[SICURO IN PRODUZIONE]` o `[SOLO AMBIENTE DI TEST]`.
- `e2e/` — suite Playwright creata da zero: 71 test verdi contro produzione, guardrail di rete che aborta gli endpoint distruttivi (con 14 test che ne dimostrano il funzionamento in entrambi i versi), Page Object, fixture di autenticazione Keycloak pronte.
- Report di dettaglio `01`-`05` in questa cartella.

---

## 6. Raccomandazioni, in ordine

1. **Promuovere `develop` → `master` al più presto.** Chiude 17 difetti attivi fra cui i tre critici. Zero migrazioni Prisma pendenti (20 identiche sui due branch), nessuna nuova variabile d'ambiente. Breaking change da comunicare: il VIEWER perde i permessi di scrittura che oggi ha di fatto, `GET /cer/:code` passa da query param a path param, e l'immagine frontend va ricostruita.
2. **Decidere su C4 (sessione singola):** implementare o autorizzare formalmente l'eccezione.
3. **Chiudere M1** disabilitando o proteggendo Swagger in produzione.
4. **Rilasciare le correzioni di questa sessione** (M2÷M5, B1) insieme alla promozione.
5. **Completare la UAT autenticata:** la parte che dimostra sul campo i buchi RBAC è scritta ma resta in `skip` finché non sono disponibili credenziali per almeno due ruoli distinti.
6. **Sanare il debito di testing:** riallineare i due gate CI, decidere il destino di Cypress (rimuoverlo o installarlo — oggi è solo rumore), e portare la coverage verso la soglia dichiarata invece di abbassare la soglia.

---

## 7. Limiti dichiarati di questa analisi

- La UAT **autenticata non è stata eseguita**: mancano le credenziali. Tutti i difetti di autorizzazione riportati sono dimostrati **a codice**, non per esecuzione sul sistema live.
- Il probe su produzione è stato volutamente **read-only** (solo GET/HEAD/OPTIONS, ~102 richieste): nessuna scrittura è stata effettuata, quindi lo sfruttamento pratico di C1/C3 non è stato confermato empiricamente — né va confermato su produzione.
- La CSP aggiunta al frontend è stata validata con `nginx -t` e uno smoke test in container, **non** contro l'applicazione reale in esecuzione: va verificata in staging osservando la console del browser prima del rilascio in produzione.
