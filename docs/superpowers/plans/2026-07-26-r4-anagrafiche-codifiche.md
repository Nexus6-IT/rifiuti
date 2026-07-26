# R4 — Anagrafiche e codifiche: i dati arrivano dall'ente, non dalla tastiera

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** ridurre l'inserimento manuale e gli errori di codifica allineando **anagrafiche** (unità locali dell'operatore, chiave `num_iscr_sito`) e **codifiche** (CER e le altre tabelle di riferimento del formulario) direttamente dall'ente, invece che da tabelle interne mantenute a mano — **senza mai rompere un formulario già emesso che referenzia un codice**.

**Il criterio di valore, fissato dal committente:** un errore di codifica su un formulario è un errore normativo. Se il dato arriva dall'ente invece di essere digitato, l'errore sparisce alla radice. Ma un allineamento che **rimuove** un codice già usato da un FIR emesso è un danno, non un aggiornamento: l'integrità storica non è negoziabile.

**Stack:** NestJS 10, Angular 17 + PrimeNG, Prisma, BullMQ (per il job di allineamento periodico), Jest, Playwright.

## Vincoli globali

- **Italiano** in ogni testo utente. Identificatori di codice in inglese; i termini di dominio RENTRI (`num_iscr_sito`, `num_iscr`, `codici-eer`, `attivita-rs`) identici alla specifica.
- **Verbi del mestiere**: «allinea le codifiche», «verifica le mie unità locali» — mai «sincronizza», «reseed», «job».
- **`data-testid` dal primo commit**, secondo `e2e/SELECTORS-DEBT.md`.
- **Prettier** sui file toccati prima di ogni commit.
- Suite da non far calare: backend **106 suite / 987 test**, oracolo **6 suite / 13 test**, frontend **53 test**. Le suite nuove di questo piano si sommano, non sostituiscono.
- **Ogni migrazione Prisma va letta riga per riga prima di applicarla: niente `DROP`, niente `TRUNCATE`, niente colonne rese obbligatorie su dati esistenti.** È il vincolo che rende sicuro l'intero piano: ogni task che tocca lo schema è additivo.
- Commit in italiano, senza attribuzione ad AI.
- **423 = ban del chiamante.** Ogni chiamata verso `codifiche` o `anagrafiche` passa dagli stessi meccanismi di prudenza già maturati in R1/R0 (fail-closed su credenziali assenti, nessun ritentativo automatico su errori non transitori).

---

## Cosa dicono davvero i contratti — accertato, non dedotto

### `codifiche.yaml` (25 path, tutti `GET`, tutti sotto `/lookup/*` + `/status`)

Tabelle esposte, con tag e forma dati (`ByteLookupModel`/`Int16LookupModel`/`Int32LookupModel`/`StringLookupModel`, tutti con `id, code, name, properties`):

| Path | Contenuto | Tag |
|---|---|---|
| `/lookup/codici-eer` | Codici CER/EER (filtro `pericoloso`, `escludi00`) | Rifiuto |
| `/lookup/attivita-rs` | Operazioni di recupero/smaltimento (R1-R13, D1-D15) | Rifiuto |
| `/lookup/stati-fisici` | Stati fisici del rifiuto | Rifiuto |
| `/lookup/caratteristiche-pericolo` | Caratteristiche di pericolo | Rifiuto |
| `/lookup/adr-classi` | Classi ADR | Rifiuto |
| `/lookup/categorie-raee` | Categorie RAEE | Rifiuto |
| `/lookup/materiali`, `/lookup/provenienza`, `/lookup/unita-misura`, `/lookup/attivita` | Altre tabelle rifiuto | Rifiuto |
| `/lookup/province`, `/lookup/comuni`, `/lookup/comuni/{provincia_id}`, `/lookup/regioni`, `/lookup/nazioni` | Territoriali, **con semantica propria**: `attivo`, `fine-validita`, `nuovo-id` (comune soppresso/accorpato), `cciaa` | Territoriali |
| `/lookup/stati-formulario`, `/lookup/tipi-accettazione`, `/lookup/tipi-autorizzazione`, `/lookup/tipi-respingimento`, `/lookup/causali-operazione`, `/lookup/causali-respingimento`, `/lookup/tipi-tratte`, `/lookup/tipi-trasporto-transfrontaliero` | Codifiche del ciclo FIR/Registro (servono a R3, non a R4) | FIR/Registro |
| `/lookup/codici-errore` | Codici di errore dell'ente | — |
| `/status` | Stato dell'API (`Ok/Warning/Planned`) | — |

**Nessun meccanismo di aggiornamento incrementale.** Nessun parametro `updated_since`, nessuna `version`/`etag` sulla collezione, nessun endpoint di sola-differenza. L'unico segnale di validità temporale è nei modelli territoriali (`attivo`, `fine-validita`, `nuovo-id`): per le altre 20 tabelle **il solo modo di sapere se qualcosa è cambiato è riscaricare tutto e confrontare**. Questo impone: (a) il download completo periodico è l'unico meccanismo possibile, (b) la cadenza va scelta con prudenza perché ogni ciclo fa ~25 chiamate GET, ben sotto la soglia dei 100/5s, ma va comunque serializzato — un burst di 25 richieste parallele non è mai giustificato per dati che cambiano a mesi di distanza.

### `anagrafiche.yaml` (23 path)

**Tutto sola lettura**, tranne i `/registri` (apertura/modifica/chiusura registro), che sono **fuori dall'ambito di R4**: appartengono ai registri cronologici, esplicitamente esclusi dal design del programma (`docs/superpowers/specs/2026-07-26-area-rentri-design.md` §3.4) perché l'API non è pubblicata.

Path rilevanti per R4 (tag `Operatore`):

| Path | Restituisce | Chiave |
|---|---|---|
| `GET /operatore` | Elenco operatori (filtro `num_iscr_ass`) | — |
| `GET /operatore/{identificativo}/controllo-iscrizione` | booleano: il CF è iscritto? | codice fiscale |
| `GET /operatore/{identificativo}/controllo-autorizzazione-albo` | booleano: autorizzato Albo? | codice fiscale |
| `GET /operatore/{num_iscr}/autorizzazione-albo` | Dettaglio autorizzazione Albo | `num_iscr` |
| `GET /operatore/{num_iscr}/siti` | **Elenco unità locali dell'operatore**, paginato (`Paging-Page`/`Paging-PageSize`, header di risposta) | `num_iscr` → produce `num_iscr_sito` |
| `GET /operatore/{num_iscr}/siti/{num_iscr_sito}` | Dettaglio unità locale (`SitoModel`: nome, comune_id, provincia_id, attività, stato, is_sede_legale) | `num_iscr` + `num_iscr_sito` |
| `GET /operatore/{num_iscr}/siti/{num_iscr_sito}/autorizzazioni` | Autorizzazioni dell'unità locale (tipo, attività R/D, date) | idem |
| `/soggetto-delegato/...` | Stesso schema per chi opera per conto di un delegante | `num_iscr_ass` |

**`num_iscr_sito` è la chiave che serve anche a R2** (`POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` su `formulari.yaml`, citato nel design §3.2). Oggi **non esiste nel modello dati di WasteFlow**: verificato che l'unica occorrenza nel codice è un commento (`schema.prisma` riga 398, sull'enum `RentriOrigineLegame`) che cita il nome del parametro RENTRI, non un campo persistito. **Serve modellarlo in R4** perché R2 lo richiede e perché è precisamente il dato con cui l'operatore oggi digita a mano indirizzo/comune/attività della propria sede quando compila un formulario.

### Scritture

**Nessuna** operazione di scrittura su soggetti o unità locali. Sono dati di iscrizione mantenuti dall'ente/CCIAA al momento dell'iscrizione o della variazione: WasteFlow può solo leggerli. Le uniche scritture del contratto `anagrafiche` sono sui `/registri` (fuori ambito). Questo semplifica R4: non c'è conflitto di scrittura da arbitrare, solo lettura e cache.

---

## Stato di partenza — cosa esiste già e va riusato o distinto

**Il sottosistema `reference-data`** (`apps/backend/src/application/reference-data/`) gestisce oggi `CERCode`, `AtecoCode`, `IstatNazione`, `IstatProvincia`, `IstatComune` (`apps/backend/prisma/schema.prisma` righe 702-769):

- Fonte dati: CSV bundled in `apps/backend/prisma/reference-data/*.csv`, con URL esterno opzionale via `ReferenceDataConfig` (`reference-data.config.ts`) — **mai RENTRI**, oggi.
- Seed: `reference-data-seeder.service.ts`, tutto upsert idempotente, **mai delete**. Cron mensile (`@Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)`).
- Endpoint `POST /reference-data/reseed` (`reference-data.controller.ts`), guardia `RolesGuard` + `@Roles('SUPER_ADMIN','ADMIN')`, accetta `?dataset=...`, esecuzione in background (202 `{accepted:true}`). **È in blacklist** come endpoint distruttivo (`docs/audits/uat-2026-07-25/01-api-surface.md` riga 102/155: *"ripopola (sovrascrive) i dataset di riferimento condivisi (comuni/ATECO/nazioni/province) dalle sorgenti esterne"*) — anche se in pratica fa solo upsert, sovrascrive i valori esistenti con quelli della fonte, quindi la classificazione è corretta.
- Nessuna delle 5 tabelle ha un campo di validità (`attivo`, `rimossoAl`): oggi si assume che un codice presente sia sempre valido.

**Uso reale nel dominio FIR**: `FIR.cerCode` (`schema.prisma` riga 269) è una **stringa libera** (`VarChar(10)`, indicizzata, nessuna FK). La validazione avviene in un sottosistema **parallelo e distinto** da `reference-data`: `apps/backend/src/domain/cer/` (`CERCatalogService`, `ICERRepository`) → `apps/backend/src/infrastructure/persistence/cer-prisma.repository.ts` (`CERPrismaRepository`) → letto/scritto da `apps/backend/src/application/fir/use-cases/create-fir.use-case.ts` (righe 32-40), che chiama `cerRepository.exists(cerCode)` e rifiuta la creazione se il codice non esiste. Entrambi i sottosistemi leggono/scrivono la **stessa tabella** `CERCode`, ma con interfacce indipendenti — è una divergenza architetturale preesistente che R4 eredita e non deve aggravare: ogni nuovo campo su `CERCode` deve essere visibile a entrambi.

`AtecoCode`/`IstatProvincia`/`IstatComune`/`IstatNazione` **non sono referenziati dal FIR**: servono solo a `ReferenceDataService.validateLocalita` (usato dal MUD) e al campo ATECO del `Tenant`. RENTRI **non espone ATECO** in nessun contratto: quella tabella resta locale per intero, senza alternativa.

---

### Task 1: L'oracolo impara a rispondere «codifiche» e «anagrafiche»

Senza questo non c'è verifica: il programma si regge sull'oracolo, e oggi `tools/rentri-fake/src/routes/` ha solo `formulari.ts`, `token.ts`, `transazioni.ts`, `xfir.ts`, `controllo.ts`. Va esteso **prima** di scrivere qualunque client applicativo, non dopo.

**Files:**
- `tools/rentri-fake/src/routes/codifiche.ts` (nuovo)
- `tools/rentri-fake/src/routes/anagrafiche.ts` (nuovo)
- `tools/rentri-fake/src/stato/archivio.ts` (estendere con fixture di codifiche e anagrafiche)
- `tools/rentri-fake/src/app.ts` (registrare le nuove rotte)
- Test: `tools/rentri-fake/test/codifiche.spec.ts`, `tools/rentri-fake/test/anagrafiche.spec.ts` (verificare la struttura esistente dei test della fake prima di nominare i file)

- [ ] **Step 1: Fixture minime ma reali**

  `Archivio` espone un piccolo catalogo statico per `codifiche` (un sottoinsieme vero di `codici-eer` — almeno un codice pericoloso `*` e uno non pericoloso, `attivita-rs` con almeno un R e un D, `stati-fisici`, `province`/`comuni`/`nazioni` con **almeno un comune con `fine-validita` valorizzata** per poter testare il caso di un comune soppresso) e per `anagrafiche` (un operatore con `num_iscr`, uno o più `siti` con `num_iscr_sito`, coerenti con lo schema `SitoModel`/`OperatoreModel` di `anagrafiche.yaml`).

- [ ] **Step 2: Rotte `codifiche`, tutte `GET`, prefisso `/codifiche/v1.0`**

  Replica la forma esatta delle risposte (`ByteLookupModel`/`Int16LookupModel`/`StringLookupModel`: `id, code, name, properties`), non un formato semplificato — è quello che il client dovrà deserializzare. Autenticazione: stesso schema Bearer JWT delle rotte `formulari` (`verificaJwt`), stesso comportamento su 403/429/423 tramite l'hook globale già presente in `app.ts` (il guasto iniettato dal canale di controllo si applica a tutte le rotte tranne `__controllo`/`__salute` — verificare che le nuove rotte non lo bypassino).

- [ ] **Step 3: Rotte `anagrafiche`, prefisso `/anagrafiche/v1.0`**

  `GET /operatore/{num_iscr}/siti` con paginazione reale (header `Paging-Page`/`Paging-PageSize`/`Paging-PageCount`/`Paging-TotalRecordCount`, sul modello di quanto già fatto per l'elenco formulari in `formulari.ts` righe 55-66). `GET /operatore/{num_iscr}/siti/{num_iscr_sito}` con 404 se non esiste. `GET /operatore/{identificativo}/controllo-iscrizione` booleano.

- [ ] **Step 4: Test della fake**

  Un test per rotta che verifica: forma della risposta, 403 senza JWT valido, 404 su chiave inesistente, propagazione del guasto iniettato dal canale di controllo (429/423).

- [ ] **Step 5: Commit**

---

### Task 2: Colmare il vuoto — `num_iscr` e `num_iscr_sito` nel modello dati

R2 ha bisogno di `num_iscr_sito` per l'acquisizione di visibilità; R4 ne ha bisogno per leggere le proprie unità locali. Nessuno dei due esiste oggi.

**Files:**
- `apps/backend/prisma/schema.prisma` (estendere `RentriCredential`, riga 1418, o `Tenant`, riga 25 — decidere in Step 1)
- Nuova migrazione in `apps/backend/prisma/migrations/`
- `apps/backend/src/infrastructure/rentri/rentri-credential.service.ts` (se il campo va lì)

- [ ] **Step 1: Decidere dove vive `num_iscr` (operatore) e disegnare `RentriSito`**

  `RentriCredential` è 1:1 con `Tenant` (`tenantId` unique) e già rappresenta "l'identità RENTRI dell'azienda": è la sede naturale per `numIscrOperatore` (il numero di iscrizione che serve come parametro di path per `/operatore/{num_iscr}/siti`). Le unità locali, invece, sono multiple per operatore: servono in una tabella propria, `RentriSito` (`tenantId` FK, `numIscrSito` — univoco per tenant, non globalmente: due tenant non condividono un'unità locale —, `nome`, `comuneId`, `provinciaId`, `attivita` array, `isSedeLegale`, `stato` enum su `Stati` del contratto, `sincronizzatoAl` timestamp). **Non modellare una relazione verso `FIR`**: l'uso di `num_iscr_sito` nel ciclo di acquisizione-visibilità (R2) è per valore, non per FK — un FIR può essere agganciato a un sito che poi viene disattivato, e il FIR deve restare leggibile (stesso principio di integrità storica del Task 4).

  Scrivi la migrazione additiva: nuova colonna nullable su `RentriCredential`, nuova tabella `RentriSito`. Nessun default forzato, nessuna colonna resa obbligatoria su righe esistenti.

- [ ] **Step 2: Test dello schema**

  Un test di integrazione (Prisma test DB, come da convenzione esistente in `apps/backend/src/infrastructure/rentri/*.spec.ts`) che crea un `Tenant` + `RentriCredential` con `numIscrOperatore`, poi uno o più `RentriSito` collegati, e verifica il vincolo di unicità per tenant.

- [ ] **Step 3: Commit**

---

### Task 3: Le unità locali si leggono, non si digitano

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-anagrafiche.client.ts` (nuovo, sul modello di `rentri-api.client.ts`)
- `apps/backend/src/application/rentri/use-cases/sincronizza-siti.use-case.ts` (nuovo)
- `apps/backend/src/infrastructure/rentri/rentri-anagrafiche.client.oracolo.spec.ts`

- [ ] **Step 1: Client HTTP verso `anagrafiche`**

  Stesso pattern di autenticazione di `RENTRIApiClient` (ID_AUTH_REST_02, `RentriAuthService`, firma `Agid-JWT-Signature` sulle richieste con body — qui non serve, sono tutte `GET`). Metodi: `elencaSiti(numIscrOperatore)`, `dettaglioSito(numIscrOperatore, numIscrSito)`, `controlloIscrizione(codiceFiscale)`. Path base `/anagrafiche/v1.0`, confermato da `anagrafiche.yaml` `servers[0].url`.

- [ ] **Step 2: Test contro l'oracolo esteso (Task 1)**

  Verifica: elenco siti restituisce `num_iscr_sito` reali della fixture; paginazione rispettata; 404 su sito inesistente; 403/429/423 propagati e non ritentati automaticamente (stesso principio di `rentri-api.client.resilienza.oracolo.spec.ts`).

- [ ] **Step 3: Use case di sincronizzazione, on-demand — non a cron**

  A differenza delle codifiche (Task 5), le unità locali sono per-tenant e cambiano per iniziativa dell'azienda (nuova sede, variazione), non per un ciclo dell'ente. **Non serve un cron globale che interroga tutti i tenant**: l'allineamento parte quando l'utente apre la sezione «Unità locali» dell'area RENTRI, con una cache (`sincronizzatoAl`) che evita di richiamare l'ente ad ogni apertura pagina (TTL ragionevole, es. 1 ora — motivarlo nel commit).

  Fail-closed: se il tenant non ha `numIscrOperatore` configurato, l'azione non parte e lo dice («Configura il numero di iscrizione RENTRI della tua azienda prima di leggere le unità locali» + link alla pagina certificato/credenziali).

- [ ] **Step 4: Endpoint applicativo**

  `GET /rentri/siti` (tenant corrente, dalla cache locale) e `POST /rentri/siti/aggiorna` (forza la rilettura dall'ente) — solo ADMIN/SUPER_ADMIN, stesso principio di Task 1 di R1 (è una configurazione che impegna l'azienda, non un'azione operativa quotidiana).

- [ ] **Step 5: Test e commit**

---

### Task 4: Le codifiche CER arrivano dall'ente, ma senza cancellare la storia

Questo è il rischio centrale del piano: un CER che sparisce da sotto un formulario emesso è un danno.

**Files:**
- `apps/backend/prisma/schema.prisma` (estendere `CERCode`, righe 702-716)
- Nuova migrazione
- `apps/backend/src/infrastructure/rentri/rentri-codifiche.client.ts` (nuovo)
- `apps/backend/src/application/reference-data/rentri-cer-sync.service.ts` (nuovo — **non** dentro `reference-data-seeder.service.ts`: fonte diversa, ciclo di vita diverso, va tenuto distinto per non confondere ulteriormente i due sottosistemi CER già paralleli)
- `apps/backend/src/domain/cer/services/cer-catalog.service.ts` (verificare impatto: `validateCode`/`exists` non deve mai considerare "non valido" un codice storico)

- [ ] **Step 1: Estendere `CERCode` in modo additivo**

  Nuovi campi nullable/con default: `presenteInRentri Boolean @default(true)`, `rimossoDaRentriAl DateTime? @map("rimosso_da_rentri_al")`, `fonte String @default("locale")` (`"locale"` per lo stato preesistente da CSV, `"rentri"` per i codici allineati dall'ente — permette di distinguere in diagnostica cosa viene da dove durante la transizione). **Non toccare** `code` (chiave), non renderlo FK-friendly più di quanto già sia: resta stringa, coerente con `FIR.cerCode`.

  Scrivi la migrazione, leggila riga per riga: deve limitarsi ad `ALTER TABLE ... ADD COLUMN` con default, zero impatto sulle righe esistenti (`presenteInRentri` a `true` per tutte, `fonte` a `'locale'` per tutte).

- [ ] **Step 2: Scrivere i test del comportamento, prima del client**

  - Un CER presente in RENTRI ma non ancora noto localmente → upsert, `fonte='rentri'`, `presenteInRentri=true`.
  - Un CER noto localmente (`fonte='locale'`) che l'ente restituisce anch'esso → upsert dei campi descrittivi, ma **non un downgrade silenzioso**: se la descrizione RENTRI diverge da quella locale, il test verifica che venga aggiornata (l'ente è la fonte di verità sui testi) ma il codice non cambia identità.
  - **Un CER noto localmente e referenziato da un FIR esistente, che RENTRI smette di restituire** → il test verifica che: (a) la riga **non viene cancellata**, (b) `presenteInRentri` passa a `false` e `rimossoDaRentriAl` si valorizza, (c) `cerRepository.exists(code)` per quel codice **continua a restituire `true`** (il FIR esistente resta valido, leggibile, stampabile), (d) `CERCatalogService.validateCode` usato in **creazione di un nuovo FIR** invece **rifiuta** un codice con `presenteInRentri=false` con un messaggio leggibile («Questo codice CER non è più valido secondo il registro dell'ente: verificane la sostituzione»).

  Questa distinzione — valido per la storia, non valido per il nuovo — è la sostanza della protezione richiesta.

- [ ] **Step 3: Client + servizio di sincronizzazione**

  `RentriCodifcheClient.codiciEer()` legge `/codifiche/v1.0/lookup/codici-eer` (con `escludi00=false` esplicito: i codici capitolo/00 non vanno esclusi silenziosamente, la logica di visualizzazione filtra a valle se serve). `RentriCerSyncService.allinea()` applica la logica del Step 2. Fail-closed su credenziali assenti/non valide, nessun ritentativo su 403/423.

- [ ] **Step 4: Aggiornare `CERCatalogService.exists`/`validateCode`**

  Distinguere esplicitamente (nuovo metodo o parametro) "esiste per riferimento storico" da "è utilizzabile per un nuovo formulario". `create-fir.use-case.ts` (righe 32-40) deve usare la seconda; ogni lettura di un FIR esistente deve usare la prima. Test di non-regressione: un FIR creato prima della rimozione resta leggibile in tutti i path esistenti (dettaglio, PDF, export MUD).

- [ ] **Step 5: Cadenza dell'allineamento**

  Stessa cadenza prudente di `reference-data` oggi: mensile (`EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT`), non giornaliera. `codifiche.yaml` non offre un segnale di "cosa è cambiato": ogni ciclo è un download completo di ~1500-2000 righe CER, una singola chiamata paginata o non paginata (verificare in Step 3 se `codici-eer` pagina o restituisce tutto in un colpo — il contratto non dichiara header di paging su questa rotta, quindi presumibilmente un solo array): il costo per l'ente è basso, il rischio è nella frequenza inutile, non nel volume. Motivare per iscritto nel commit perché mensile e non più frequente: i CER cambiano per norma, non per uso quotidiano.

- [ ] **Step 6: Commit**

---

### Task 5: Le altre codifiche — cosa si allinea ora, cosa si rimanda e perché

Non tutte le 25 tabelle vanno sincronizzate subito: costruire una cache per una codifica che nessun campo del formulario usa ancora è lavoro speculativo, e un audit onesto vale più di una lista completa non verificata.

**Files:**
- `apps/backend/prisma/schema.prisma` (nuove tabelle solo per le codifiche di questo Step)
- `docs/audits/rentri-codifiche-campi-2026-07-26.md` (nuovo — audit dei campi FIR/Contract che oggi sono testo libero o enum locale e potrebbero diventare codice RENTRI)

- [ ] **Step 1: Audit dei campi effettivamente usati**

  Cerca in `apps/backend/prisma/schema.prisma` (modelli `FIR`, `WasteMovement`, `Contract`) e nei DTO di creazione FIR i campi che oggi sono stringa libera o enum hardcoded e corrispondono a una tabella di `codifiche.yaml`: stato fisico del rifiuto, unità di misura, caratteristiche di pericolo, classe ADR. **Non includere** le codifiche del ciclo esteso del formulario (`causali-respingimento`, `tipi-trasporto-transfrontaliero`, `tipi-tratte`, `causali-operazione`) — quei campi non esistono ancora nel dominio, arriveranno con R3: sincronizzarle ora significherebbe mantenere una cache di dati che nessuno legge.

  L'audit produce una tabella: campo applicativo → tabella RENTRI corrispondente → azione (`allinea ora` / `rimanda a R3`).

- [ ] **Step 2: Modellare solo le tabelle di "allinea ora"**

  Stesso schema di lifecycle di `CERCode` (Task 4): `presenteInRentri`, `rimossoDaRentriAl`. Migrazione additiva, letta riga per riga.

- [ ] **Step 3: Territoriali RENTRI — perché restano separate da `IstatComune`/`IstatProvincia`/`IstatNazione`**

  RENTRI espone comuni/province/nazioni con una semantica propria e diversa da quella ISTAT usata oggi per il MUD: `attivo`, `fine-validita`, `nuovo-id` (comune soppresso/accorpato). `IstatComune` non ha questo concetto — è un elenco statico. **Non unificare le due tabelle**: il MUD ha bisogno del codice ISTAT puro (stabile, non soggetto alla logica di validità di RENTRI), mentre la compilazione di un sito/formulario verso RENTRI ha bisogno della logica di validità dell'ente (un comune con `nuovo-id` valorizzato non va più proposto in un nuovo modulo, ma un FIR vecchio che lo referenzia resta leggibile). Fondere le due fonti di verità produrrebbe esattamente il problema che il Task 4 risolve per i CER, applicato al territorio.

  Introduci `RentriComune`/`RentriProvincia`/`RentriNazione` come cache **dedicata all'uso RENTRI** (validazione pre-invio di siti/formulari), lasciando `Istat*` intatte per il MUD. Motiva questa scelta nel commit — è la stessa logica del Task 4, applicata a un dominio diverso.

- [ ] **Step 4: Sincronizzazione, stessa cadenza mensile di Task 4**

  Un solo servizio di orchestrazione (`RentriCodificheSyncService`) chiama in sequenza — **non in parallelo** — tutte le tabelle di "allinea ora" (CER incluso, riusando Task 4), con una pausa breve tra una chiamata e l'altra: anche restando ben sotto i 100 req/5s, non c'è motivo di fare un burst per dati che cambiano a mesi di distanza, ed è la postura prudente richiesta dal design (§7 rischi, «un'automazione mal tarata non rallenta, viene bandita»).

- [ ] **Step 5: Test e commit**

---

### Task 6: Un endpoint di allineamento, non un altro `reseed`

L'endpoint esistente `POST /reference-data/reseed` è già in blacklist come distruttivo (`docs/audits/uat-2026-07-25/01-api-surface.md`). R4 introduce una superficie nuova: va progettata per non finire nella stessa categoria, e per non confondersi con quella esistente.

**Files:**
- `apps/backend/src/application/reference-data/rentri-codifiche.controller.ts` (nuovo, o estensione di un controller RENTRI esistente in `apps/backend/src/rentri/`)
- `docs/audits/uat-2026-07-25/01-api-surface.md` (aggiornare la tabella con la nuova voce, **non** rimuovere quella esistente su `reseed`)

- [ ] **Step 1: Nome e semantica**

  Verbo del mestiere: `POST /rentri/codifiche/allinea` (non `reseed`, non `sync`). Comportamento: sempre e solo upsert additivo con la logica del Task 4/5 (`presenteInRentri`), mai `DELETE`/`TRUNCATE`. Perché questo lo rende **non distruttivo** in un senso che l'endpoint esistente non è: `reseed` sovrascrive i valori con quelli della fonte senza distinguere "scomparso" da "mai esistito"; il nuovo endpoint marca, non sovrascrive alla cieca.

  Ruoli: SUPER_ADMIN/ADMIN — stesso principio di R1 Task 1 (un'operazione che impegna verso l'ente).

- [ ] **Step 2: Test che dimostrano la non-distruttività**

  Un test che allinea due volte con un fixture dell'oracolo che nella seconda chiamata omette un codice presente nella prima: verifica che la riga sopravviva con `presenteInRentri=false`, non scompaia.

- [ ] **Step 3: Aggiornare l'audit della superficie API**

  Aggiungi la voce alla tabella di `01-api-surface.md`, colonna "Distruttivo": **NO** — con la motivazione (upsert + marcatura, mai cancellazione) — così il prossimo audit non lo confonde con `reseed`.

- [ ] **Step 4: Il vecchio `reseed` non cambia comportamento**

  `reference-data-seeder.service.ts` continua a servire ATECO/ISTAT (dati che RENTRI non espone, o che restano intenzionalmente separati per il MUD — Task 5 Step 3). Non toccarlo in questo piano oltre a quanto già richiesto da Task 4/5 per `CERCode` (che ora ha due fonti convergenti sulla stessa tabella: verificare che il vecchio seed da CSV e il nuovo allineamento da RENTRI non si pestino i piedi — il CSV bundled resta il fallback quando RENTRI non è raggiungibile o il tenant non ha credenziali, mai eseguito in sovrascrittura dopo che RENTRI ha già scritto `fonte='rentri'` su una riga).

- [ ] **Step 5: Commit**

---

### Task 7: L'interfaccia — dove l'utente vede che non deve più digitare

**Files:**
- `apps/frontend/src/app/features/rentri/` (l'area RENTRI dedicata, §5.2 del design)
- Nuovo componente sezione «Unità locali»
- Nuovo componente sezione «Codifiche» (diagnostica)

- [ ] **Step 1: Sezione «Unità locali»**

  Tabella con `num_iscr_sito`, nome, comune, stato, data ultimo aggiornamento. Azione «Aggiorna dall'ente» (verbo del mestiere, non «sincronizza»). Se il tenant non ha `numIscrOperatore` configurato: messaggio con link alla pagina di configurazione, non una tabella vuota silenziosa.

- [ ] **Step 2: Sezione «Codifiche» — solo diagnostica, nessuna azione manuale sui singoli codici**

  Mostra: data dell'ultimo allineamento riuscito, quante codifiche sono state aggiornate, se qualche codice è stato marcato come non più presente in RENTRI dall'ultimo giro (con l'elenco, perché un amministratore potrebbe dover intervenire su un FIR in bozza che lo usa). **Non esporre un pulsante «allinea ora» a chiunque abbia accesso**: stesso principio di R1 — è un'azione che ha conseguenze verso l'ente, riservata a chi ha il ruolo.

- [ ] **Step 3: Il form del FIR smette di accettare CER non presenti**

  Verifica (o introduce, se non esiste) l'autocomplete del campo CER nel form di creazione FIR: deve attingere da `CERCode` filtrato per `presenteInRentri=true`, con `data-testid="fir-cer-autocomplete"`. Un codice storico non più presente resta visibile e invariato sui FIR già emessi, ma non è più proponibile per uno nuovo.

- [ ] **Step 4: `data-testid` e test frontend**

  Secondo `e2e/SELECTORS-DEBT.md`: `rentri-siti-tabella`, `rentri-siti-aggiorna-btn`, `rentri-codifiche-diagnostica`, `fir-cer-autocomplete`.

- [ ] **Step 5: Commit**

---

### Task 8: Verifica end-to-end

- [ ] **Step 1: Scenari Playwright**

  Con le credenziali disponibili (o `skip` condizionale come il resto della suite): la sezione unità locali mostra i siti dell'oracolo; l'autocomplete CER esclude un codice marcato non presente; l'azione «Aggiorna dall'ente» aggiorna la data visibile.

- [ ] **Step 2: Ciclo contro l'oracolo esteso (Task 1)**

  Nuove spec `*.oracolo.spec.ts`: un allineamento completo codifiche+CER contro l'oracolo con fixture realistiche; uno scenario in cui l'oracolo "rimuove" un codice tra due chiamate (tramite il canale di controllo o una seconda fixture) e verifica la marcatura, non la cancellazione; un 423 iniettato dal canale di controllo che blocca l'allineamento senza ritentativi.

- [ ] **Step 3: Suite complete**

  Backend, oracolo, frontend. Nessuna cala rispetto alla baseline di questo piano (106/987 backend, 6/13 oracolo, 53 frontend, più i nuovi test di questo piano).

- [ ] **Step 4: Commit**

---

## Criteri di completamento di R4

- [ ] `num_iscr` (operatore) e `num_iscr_sito` (unità locale) sono modellati e popolabili dall'ente; R2 può usarli senza ulteriore lavoro sul modello dati.
- [ ] Le unità locali dell'azienda si leggono nell'area RENTRI, non si inventano.
- [ ] I codici CER vengono allineati dall'ente; un codice referenziato da un FIR esistente **non sparisce mai**, ma non è più proponibile per un FIR nuovo se l'ente non lo restituisce più.
- [ ] Nessuna migrazione contiene `DROP`/`TRUNCATE` o rende obbligatoria una colonna su dati esistenti.
- [ ] L'endpoint di allineamento delle codifiche RENTRI è distinto dal vecchio `reseed`, non è in blacklist come distruttivo, ed è documentato nell'audit della superficie API.
- [ ] L'oracolo (`tools/rentri-fake/`) sa rispondere a `codifiche` e `anagrafiche`, non solo a `formulari`.
- [ ] Le tre suite (backend, oracolo, frontend) restano verdi e crescono.

## Ciò che R4 non fa

- Le codifiche del ciclo esteso del formulario (causali di respingimento, tipi di trasporto transfrontaliero, tipi di tratta, causali operazione) restano fuori: nessun campo del dominio le usa ancora. Arriveranno con **R3**, quando quei campi esisteranno.
- I registri cronologici e le operazioni di scrittura su di essi (`/registri` di `anagrafiche.yaml`) restano fuori: appartengono all'ambito escluso dal design del programma (API registri non pubblicata).
- L'acquisizione di visibilità sui formulari altrui (uso di `num_iscr_sito` contro `formulari.yaml`) è **R2**: R4 si limita a rendere disponibile il dato, non lo consuma.
- La UI per intervenire manualmente su un FIR in bozza che referenzia un CER appena marcato non-presente non viene costruita in R4: la diagnostica (Task 7 Step 2) segnala il caso, l'azione correttiva è successiva.
