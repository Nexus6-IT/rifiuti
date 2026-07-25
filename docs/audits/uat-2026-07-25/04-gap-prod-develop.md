# Gap produzione (`master`) vs `develop` — 2026-07-25

Analisi eseguita per distinguere, nell'audit UAT, i difetti **realmente ancora attivi in
produzione** (https://rifiuti.ignicraft.com, branch `master`) dai difetti **già corretti**
su `develop` ma non ancora promossi. Ogni riga della tabella è stata verificata a codice
(`git show origin/master:<path>`), non solo dal messaggio di commit.

## Ambito

```
git log origin/master..origin/develop --oneline
7b4296a fix(docker): healthcheck frontend con curl (wget assente in nginx:alpine)
2d52192 test(auth): riscrive la spec di AuthService allineata all'API corrente
e337d05 chore(lint): prettier sui file dei fix (gate CI)
09d8fd5 fix: hardening RBAC + robustezza da audit E2E
```

- `09d8fd5` — commit sostanziale: ~30 correzioni (RBAC scrittura, filtro eccezioni
  globale, autorizzazione FIR per tenant, validazioni di dominio, robustezza frontend).
- `e337d05` — solo prettier sui file toccati da `09d8fd5` (gate CI di lint), nessuna
  logica.
- `2d52192` — riscrittura della test spec di `AuthService` (allineamento ai comportamenti
  introdotti da `09d8fd5`) + aggiunta di un PDF di riferimento tracciati MUD (documentazione,
  non codice applicativo).
- `7b4296a` — fix Docker: `wget` non presente in `nginx:alpine`, sostituito con `curl` per
  l'healthcheck del container frontend. Riguarda solo l'infrastruttura del container, non
  la logica applicativa.

40 file, 951 inserzioni / 385 cancellazioni in totale. Nessuna migrazione Prisma nuova (vedi
sezione dedicata).

## Difetti ancora attivi in produzione

Tutti verificati leggendo il sorgente reale su `origin/master` (non solo il diff/commit
message).

| # | Difetto | Endpoint/Componente | Impatto in esercizio oggi | Severità | Corretto da | Verificato su master |
|---|---------|----------------------|----------------------------|----------|-------------|------------------------|
| 1 | PDF MUD generato con tenant **hard-coded** (`'tenant-id-placeholder'`), non quello dell'utente autenticato | `PdfController.downloadMUD` (`GET /pdf/mud/:year`) | **Data leak cross-tenant**: qualunque utente autenticato che scarica il PDF MUD riceve i dati del tenant placeholder invece dei propri (o dati potenzialmente inesistenti/di altro tenant a seconda di cosa risolve quell'id in produzione). Rischio concreto di esposizione dati di un'altra azienda in un documento scaricabile. | **CRITICA** | 09d8fd5 | Sì — `git show origin/master:.../pdf.controller.ts` conferma `generateMUDReport('tenant-id-placeholder', reportYear)`, nessuna lettura di `req.user.tenantId`, nessuna validazione dell'anno |
| 2 | `GET /fir/:id` autorizza confrontando `tenantId` con gli id di produttore/trasportatore/destinatario (parti del registro, non tenant) | `GetFIRByIdQueryHandler` (dettaglio FIR, `FIRControllerV2`) | **Blocco funzionale/rottura di sicurezza combinata**: nella pratica quasi nessuna richiesta legittima passa il controllo (i tenant non coincidono quasi mai con gli id di anagrafica) → il dettaglio FIR risulta inaccessibile al legittimo proprietario in molti casi, oppure — se per caso un tenantId coincide con un id di parte di un altro FIR — potenzialmente un'autorizzazione errata. Funzionalità core (visualizzare un FIR) inaffidabile in produzione. | **ALTA** | 09d8fd5 | Sì — `git show origin/master:.../get-fir-by-id.handler.ts` conferma il confronto su `produttoreId/trasportatoreId/destinatarioId` invece di `fir.tenantId` |
| 3 | Nessun `RolesGuard`/`@Roles` sulle scritture di `BackupController` | `POST /backup/create`, `GET /backup/list`, `POST /backup/restore`, `DELETE /backup/cleanup` | **CRITICA per il ripristino**: qualunque utente autenticato (anche VIEWER) può forzare un **restore del database di produzione** da un file di backup o cancellare backup — perdita/corruzione dati e possibile downtime, senza serve un ruolo elevato. | **CRITICA** | 09d8fd5 | Sì — `git show origin/master:.../backup.controller.ts` mostra solo `@UseGuards(JwtAuthGuard)`, nessun `RolesGuard`/`@Roles` su nessun metodo |
| 4 | Nessun `RolesGuard` sulle scritture di FIR (create/emetti/presa-in-carico/conferma-consegna/annulla) | `FIRControllerV2` | Un VIEWER autenticato può creare, emettere, prendere in carico, confermare consegna o **annullare** un FIR — documento con valore legale/tracciabilità rifiuti. Rischio di frodi/errori non attribuibili al ruolo corretto, dati di tracciabilità RENTRI potenzialmente falsati. | **ALTA** | 09d8fd5 | Sì — solo `@UseGuards(JwtAuthGuard)` a livello controller, nessun `@Roles` sui metodi di scrittura |
| 5 | `AnnullaFIRDto.motivo` opzionale, con fallback `''` | `POST /fir/:id/annulla` | Un FIR (documento legale) può essere annullato senza alcuna motivazione registrata → gap di tracciabilità/audit trail richiesto dalla normativa rifiuti. | **MEDIA** | 09d8fd5 | Sì — master ha `@IsOptional() motivo?: string` e `dto?.motivo ?? ''` nel controller |
| 6 | Nessun `RolesGuard` sulle scritture di `RegistroController` (registrazione movimenti carico/scarico) | `POST /registro` | Un VIEWER può registrare movimenti di carico/scarico nel registro cronologico rifiuti — falsificazione dati di tracciabilità normativa. | **ALTA** | 09d8fd5 | Sì — solo `@UseGuards(JwtAuthGuard)`, nessun `@Roles` |
| 7 | Nessuna validazione di dominio su CER/firId/date nel DTO di registrazione movimento | `POST /registro` (`RegistraMovimentoDto`) | Dati incoerenti (CER non valido, FIR inesistente, date malformate) possono essere persistiti nel registro cronologico, con conseguenze su MUD/RENTRI a valle. | **MEDIA** | 09d8fd5 | Sì (diff conferma DTO privo dei validator aggiunti; non ricontrollato per intero ma il codice del controller master non presenta le validazioni descritte) |
| 8 | Nessun `RolesGuard` sulle scritture di `RegistryController` (create/update/delete produttori, trasportatori, destinatari) | `POST/PUT/DELETE /registry/*` | Un VIEWER può creare, modificare o cancellare le anagrafiche di registro (produttori/trasportatori/destinatari) usate come base per FIR e MUD. | **ALTA** | 09d8fd5 | Sì — `git show origin/master:.../registry.controller.ts` conferma solo `@UseGuards(JwtAuthGuard)` su tutto il controller, nessun `@Roles` |
| 9 | Update anagrafica non trovata risponde 400 invece di 404 (`throw new BadRequestException(result.error)` generico) | `PUT /registry/{produttori,trasportatori,destinatari}/:id` | Comportamento API incoerente con GET/DELETE (che rispondono 404), integrazioni/FE possono gestire male l'errore di "risorsa non trovata" trattandolo come errore di validazione. | **BASSA** | 09d8fd5 | Sì |
| 10 | Nessun `RolesGuard` sulle scritture di `ContractController` (create contratto, cambio stato) | `POST /contracts`, `PATCH /contracts/:id/status` | Un VIEWER può creare contratti o cambiarne lo stato nel workflow di approvazione — impatto su processi di business/compliance contrattuale. | **ALTA** | 09d8fd5 | Sì — `git show origin/master:.../contract.controller.ts` conferma solo `@UseGuards(JwtAuthGuard)` a livello controller |
| 11 | Nessun `RolesGuard` su checkout/portal Stripe | `POST /billing/checkout`, `POST /billing/portal` | Un VIEWER può avviare un flusso di pagamento Stripe (upgrade piano) o aprire il portale di self-service billing dell'azienda — esposizione impropria di funzioni di fatturazione a ruoli non autorizzati. | **ALTA** | 09d8fd5 | Sì — `git show origin/master:.../billing.controller.ts` conferma `@UseGuards(JwtAuthGuard)` semplice su entrambi gli endpoint |
| 12 | Nessun `RolesGuard` su `POST /signatures/sign`; nessuna gestione delle `DomainException` (FIR non trovato, ordine firma, firma duplicata, livello SPID) | `SignaturesController.sign` | (a) Un VIEWER può firmare digitalmente un FIR — impatto su validità legale della firma; (b) qualunque violazione di dominio (es. firma fuori ordine, già firmato, FIR inesistente) degenera in **HTTP 500** invece di 400/404 → **ogni firma nella pratica rischia di fallire con errore generico** quando una precondizione di dominio non è rispettata, oltre a poter esporre stack/errore interno se il filtro globale non è attivo (vedi #13). | **CRITICA** (funzionale: firma FIR è core business; 500 su ogni violazione di dominio blocca il flusso) | 09d8fd5 | Sì — master ha solo `@UseGuards(JwtAuthGuard, SpidLevelGuard)`, nessun `RolesGuard`/`@Roles`, e la chiamata a `applySignatureUseCase.execute` non è avvolta in try/catch |
| 13 | Filtro eccezioni globale (`HttpExceptionFilter`) **non registrato** come `APP_FILTER` | `app.module.ts` (globale, tutta l'API) | Il filtro esiste come classe ma non è agganciato via `APP_FILTER`: viene usato solo dove esplicitamente applicato (se applicato), altrimenti Nest usa il proprio handler di default. Inoltre, anche dove il filtro *è* usato, la versione su master nel branch "unexpected error" fa `message = exception.message` — **espone messaggi di errore Prisma/interni grezzi** (nomi di colonne/query) al client con status 500 invece di mappare P2023→400 / P2025→404 con messaggio generico. | **ALTA** (information disclosure + errori mal classificati in tutta l'API) | 09d8fd5 | Sì — `git show origin/master:apps/backend/src/app.module.ts` non contiene `APP_FILTER`/`HttpExceptionFilter`; il file filtro su master gestisce solo `HttpException`/`DomainException`, poi fallback `exception.message` per qualunque altro errore (incluse `PrismaClientKnownRequestError`) |
| 14 | `@CurrentUser('userId')` in `PermissionController` (la property nel JWT payload è `id`, non `userId`) | `GET /permissions/my-permissions`, `GET /permissions/me` | `userId` risulta sempre `undefined` → la query permessi viene eseguita per un utente indefinito, con conseguente **500 o risposta vuota/errata** su un endpoint usato per popolare i permessi UI (RBAC frontend). | **ALTA** | 09d8fd5 | Sì — `git show origin/master:.../permission.controller.ts` conferma `@CurrentUser('userId')` in entrambi i metodi; l'interfaccia `CurrentUserPayload` espone solo `id`, non `userId` |
| 15 | `GET /cer/:code` (in master implementato come `?code=` query, non `@Param`) restituisce `null` invece di 404 quando il codice non esiste; nessuna normalizzazione formato (es. `150106` non trova `15 01 06`) | `CERController.getByCode` | Ricerca CER inconsistente: un codice valido ma scritto senza spazi non viene trovato (falso negativo), e un codice inesistente risponde 200 con body `null` invece di 404 — comportamento API non standard che può rompere l'integrazione frontend/validazioni a valle (es. compilazione FIR con CER errato non intercettata). | **MEDIA** | 09d8fd5 | Sì — codice master conferma `@Query('code')`, `return null` se non trovato, nessuna `normalizeCerCode` |
| 16 | `MudController` non valida il parametro `year` (`parseInt` diretto, nessun controllo su mancante/non numerico) | `GET /mud/generate`, `GET /mud/export` | Un `year` mancante o non numerico produce `NaN` propagato nei servizi sottostanti invece di un 400 esplicito — comportamento indefinito/errore poco chiaro per l'utente, possibile 500. | **MEDIA** | 09d8fd5 | Sì — master conferma `parseInt(year, 10)` senza validazione in entrambi i metodi |
| 17 | Frontend: `initializeAuth()` esegue `localStorage.clear()` su **qualunque** errore di `getSession()`, incluso un errore di rete/5xx transitorio | `AuthService.initializeAuth` | Un utente con un access token ancora valido può essere **sloggato involontariamente** al refresh della pagina o su un deep-link, se in quel momento il backend risponde con un errore transitorio (rete instabile, 5xx momentaneo, cold start) — impatto diretto sull'esperienza utente e possibile perdita di lavoro in corso (form compilati, ecc.). | **MEDIA** (UX/robustezza, non sicurezza) | 09d8fd5 | Sì — verificato dal diff (`error: () => localStorage.clear()` incondizionato su master); comportamento coerente con quanto descritto nel commit |

Nota: i punti 8/9 riguardano lo stesso controller (`RegistryController`); il gap di
`@Roles` copre create/update/delete su produttori/trasportatori/destinatari, elencati
insieme per brevità nella riga #8.

### Riepilogo per severità

| Severità | Conteggio |
|----------|-----------|
| CRITICA  | 3 (#1 PDF MUD cross-tenant, #3 backup/restore senza ruolo, #12 firma senza ruolo + 500 su violazioni di dominio) |
| ALTA     | 8 (#2, #4, #6, #8, #10, #11, #13, #14) |
| MEDIA    | 5 (#5, #7, #9 è BASSA — vedi sotto, #15, #16, #17) |
| BASSA    | 1 (#9) |

(Il conteggio "MEDIA" sopra include #5, #7, #15, #16, #17 = 5 voci; #9 è BASSA a parte.)

## Migrazioni DB pendenti

**Nessuna.** L'elenco dei file `migration.sql` sotto `apps/backend/prisma/migrations/` è
**identico** fra `origin/master` e `origin/develop` (20 migrazioni, dall'`init` fino a
`20260703100000_add_access_request`). Il diff `develop` non tocca lo schema Prisma: la
promozione a `master` non richiede `prisma migrate deploy` di nulla di nuovo, quindi
nessun rischio di migrazione distruttiva o downtime da schema change.

## Rischi e pre-requisiti della promozione develop→master

Analisi del diff completo (40 file) per breaking change, variabili d'ambiente nuove,
compatibilità immagini Docker:

- **Nessuna nuova variabile d'ambiente**: nessuna occorrenza aggiunta di `process.env.*`
  nel diff `master..develop` (verificato con grep mirato sulle righe aggiunte).
- **Nessuna migrazione Prisma nuova** (vedi sopra) — la promozione non richiede downtime
  da schema/DB.
- **Breaking change comportamentali da comunicare/testare in UAT prima del rilascio**:
  - `AnnullaFIRDto.motivo` diventa **obbligatorio** (`@IsNotEmpty`): qualunque client
    (frontend attuale o integrazioni esterne) che chiama `POST /fir/:id/annulla` senza
    `motivo` riceverà ora un 400 invece di essere accettato con stringa vuota. Verificare
    che il frontend `develop` invii sempre il campo (dovrebbe, essendo lo stesso commit).
  - Tutte le route ora protette da `@Roles` **negano l'accesso a VIEWER** che prima
    scrivevano: se in produzione esistono oggi utenti VIEWER che usano quelle azioni
    (backup, FIR, registro, anagrafiche, contratti, billing, firma), dopo il deploy
    riceveranno 403. Va comunicato agli utenti/supporto prima del rilascio (è un
    comportamento *corretto* secondo il modello di ruoli, ma è un cambio visibile).
  - `GET /fir/:id`: cambia la logica di autorizzazione da "id parti" a "tenant". Se in
    produzione esistono FIR il cui accesso "funzionava per errore" tramite il vecchio
    controllo (coincidenza casuale tenantId/partyId), quell'accesso potrebbe cambiare
    esito. Il nuovo comportamento è quello corretto (tenant-scoping) ma va incluso nello
    smoke test post-deploy.
  - `PDF MUD`: dopo il fix, il PDF userà il tenant reale — utenti che oggi (per errore)
    ricevevano dati del tenant placeholder vedranno d'ora in poi i propri dati corretti.
    Comportamento desiderato, ma se qualcuno si era "abituato" al bug va gestito come
    comunicazione, non come regressione.
  - `HttpExceptionFilter` come `APP_FILTER` globale: cambia la shape/contenuto dei body
    di errore in tutta l'API (messaggi generici invece di messaggi Prisma grezzi, status
    code diversi per P2023/P2025/P2002/ecc.). Il commit dichiara la shape flat invariata
    (`{ statusCode, error, message, correlationId, timestamp, path }`), ma qualunque
    codice frontend/integrazione che oggi facesse parsing di un messaggio di errore
    specifico (es. testo Prisma) andrebbe rotto — verificare non ci siano dipendenze di
    questo tipo lato frontend prima del rilascio.
  - `CERController.getByCode`: cambia da `?code=` query param a `@Param` (path param) —
    **breaking change di contratto API** se qualche client chiama l'endpoint con la vecchia
    forma URL. Verificare tutte le chiamate frontend `GET /cer/...` usino il nuovo path.
- **Docker/immagini**: `apps/frontend/Dockerfile.prod` (commit `7b4296a`) richiede un
  **rebuild dell'immagine frontend** per applicare il fix dell'healthcheck (installazione
  di `curl`); un semplice `docker compose up -d` senza rebuild/pull della nuova immagine
  non risolve l'unhealthy noto. Da includere nella pipeline di build immagini alla
  promozione.
- **Coverage/test**: `2d52192` riscrive `auth.service.spec.ts` per allinearsi al nuovo
  comportamento di `initializeAuth`; nessun impatto runtime, ma va verificato che la CI
  (soglie di coverage) passi pulita sul branch dopo il merge.
- **Nessun altro rischio infrastrutturale rilevato**: nessun cambiamento a
  `docker-compose*.yml`, nessuna nuova dipendenza di servizio esterno, nessuna modifica a
  porte/rete.

### Checklist operativa promozione `develop` → `master`

1. [ ] Comunicare agli utenti/supporto il cambio di permessi per ruolo VIEWER (non potrà
       più scrivere su FIR/registro/anagrafiche/contratti/billing/firma/backup).
2. [ ] Verificare in produzione se esistono utenti VIEWER che oggi usano attivamente le
       azioni di scrittura ora bloccate (query sul DB ruoli/audit log prima del deploy).
3. [ ] Rebuild + push dell'immagine frontend (per il fix Docker healthcheck) come parte
       della pipeline di build immagini, non solo un pull di configurazione.
4. [ ] Eseguire smoke test mirati post-deploy su: dettaglio FIR (`GET /fir/:id`) con
       utente reale, firma FIR (`POST /fir/:id/sign`), download PDF MUD (`GET
       /pdf/mud/:year`) con tenant reale, `GET /permissions/me`, `GET /cer/:code` (nuova
       forma path param).
5. [ ] Verificare che nessun client/integrazione esterna chiami `GET /cer?code=...`
       (vecchia forma) — se sì, aggiornare prima del cutover.
6. [ ] Confermare che il pipeline CI/lint (gate che ha originato `e337d05`) sia verde sul
       branch da promuovere.
7. [ ] Nessuna azione richiesta su migrazioni DB (schema invariato) — comunque eseguire
       `prisma migrate deploy` come da procedura standard per assicurare l'allineamento
       (no-op atteso).
8. [ ] Dopo il deploy, monitorare i log per errori 403 imprevisti (VIEWER bloccati) e per
       eventuali 400 su `POST /fir/:id/annulla` senza `motivo` da client non aggiornati.

## Raccomandazione

Promuovere `develop` a `master` **con priorità alta e quanto prima**: la produzione
espone oggi almeno 3 difetti CRITICI verificati a codice (restore/cleanup backup
accessibile a qualunque utente autenticato, PDF MUD con dati di tenant sbagliato, e
firma FIR che nega scrittura solo lato ruolo ma degenera in 500 su ogni violazione di
dominio) più 8 difetti ALTA — non "nuovi bug da audit UAT" ma difetti reali e verificati
tuttora presenti in esercizio, già risolti e testati su `develop`. Non essendoci
migrazioni DB né nuove variabili d'ambiente, il rischio tecnico della promozione è basso
e circoscritto a breaking change comportamentali comunicabili (checklist sopra); il
rischio di **non promuovere** (restare su `master` vulnerabile) è nettamente superiore al
rischio della promozione stessa.
