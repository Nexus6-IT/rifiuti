# Confutazione del piano D (esercizio) e della sua fedeltà a WinWaste

Data: 2026-10-22. Oggetto: `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md` (già implementato, commit `ddac487`, `e50afb9..c9b10dd`). Riferimenti: spec `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 8 e §7, `C:\Progetti\winwaste\docs\confronto-rifiuti\04-piattaforma-e-migrazione.md` §1.9-1.12 e §6, documentazione WinWaste in `C:\Progetti\winwaste\docs\` (`funzionalita.md`, `movimenti.md`, `giacenze.md`, `contabilita.md`). Il codice del worktree è stato letto solo per confermare che un buco del documento sia reale.

Non ripeto i punti già accolti o decisi nei giri 1-3 (`giro-*-esito.md`, `decisioni-per-graziano.md`): niente `TZ` (DG-07), off-site e cifratura (DG-46), restore di prova solo di notte (DG-05), spazio libero (DG-06), runtime e ambiente dedicato (DG-49, DG-50), errori RENTRI su Bugsink (DG-44), input `tag` (DG-45). Dove tocco una decisione presa, lo dico e porto un'evidenza nuova.

Severità: **Critica** = il piano promette una protezione che nel caso d'uso previsto non c'è e il danno è grave; **Importante** = buco reale con conseguenza concreta per un utente o per il ripristino; **Minore** = da sistemare, rischio limitato.

---

## Rilievi

### D-W-01 — `restore.sh` può dichiarare riuscito un ripristino parziale e rifare la migration che si voleva annullare

- **Severità:** Importante
- **Dove:** piano D, Decisione 8, Task 3 Step 4b e Step 8 (sezione Rollback), passo 7.8b; codice `ops/restore.sh`.
- **Affermazione del piano:** "Il resto del flusso (stop del backend, drop, restore, `migrate deploy`, start) non cambia"; "La prova di ripristino vera è quella notturna di `ripristino_di_prova`"; il rollback con perdita di dati si fa con `restore.sh` sul dump `wasteflow_predeploy_*`.
- **Perché non regge:** la prova notturna valida il **dump**, non **lo script di ripristino**, e i due si comportano in modo diverso:
  1. `ripristino_di_prova` usa `psql -v ON_ERROR_STOP=1`; `restore.sh` no (`gunzip -c … | … psql -U … -d …`). Con `set -euo pipefail` un `psql` senza `ON_ERROR_STOP` esce 0 anche se metà delle istruzioni falliscono: lo script scrive "Dump ripristinato".
  2. `restore.sh` non chiama `verifica_completezza_dump`, che la libreria offre già: si può ripristinare un `.scartato`, un `.parziale` o un dump troncato, e lo script **prima** fa `DROP DATABASE`.
  3. `"${DC[@]}" run --rm backend npx prisma migrate deploy || log "ATTENZIONE…"`, poi `"${DC[@]}" start backend`: se la migration fallisce, il backend riparte lo stesso su uno schema disallineato.
  4. `restore.sh` non esporta `TAG`, quindi `docker compose run backend` usa `rifiuti-backend:${TAG:-latest}` (`docker-compose.prod.yml:65`). Il build di `deploy.yml:237` pubblica `:latest` **prima** del deploy: nel caso tipico del rollback (rilascio nuovo con una migration che ha alterato dati), `latest` è proprio l'immagine nuova, e `migrate deploy` **riapplica la migration** sul dump appena ripristinato. Il ripristino annulla se stesso.
- **Conseguenza per un utente:** nel solo caso per cui il piano prevede `restore.sh` (una migration che ha rovinato i dati), la procedura può riportare i dati rovinati, oppure un database a metà, con il backend acceso e l'esito "Ripristino completato". Su un registro con valore legale è il guasto peggiore: sembra tutto a posto.
- **Evidenza:** `ops/restore.sh` (righe "Ripristino del dump", "Migrazione prisma", "Riavvio del backend"); `ops/lib/backup-verifica.sh` (`ripristino_di_prova` con `ON_ERROR_STOP`); `deploy.yml:237`, `:286` (`TAG` esportato solo dallo script di deploy); piano D passo 7.8b ("nessun ripristino reale").
- **Correzione proposta (modifica del piano, piccola):**
  - `restore.sh`: `verifica_completezza_dump` prima del `DROP` (uscita se fallisce); `psql -v ON_ERROR_STOP=1 -q`; `TAG` obbligatorio (`RIPRISTINO_TAG=sha-…`, uscita se manca) ed esportato prima di ogni `docker compose`; se `migrate deploy` fallisce, uscita non zero **senza** `start backend`.
  - Test bash: con `PG_EXEC` reale, `restore.sh` su un dump con un'istruzione rotta deve uscire non zero.
  - Il motivo per cui G1-C-04 ha sostituito la prova con una verifica a secco ("lo script ferma il backend di produzione") non vale per una prova su un progetto compose separato: `WASTEFLOW_COMPOSE_FILE` + `-p rifiuti-prova` con volumi propri, in WSL o sul VPS, non tocca il backend di produzione. Aggiungere al Task 7 una prova di ripristino completa su `rifiuti-prova` (con l'immagine del tag corrente), marcata [SERVER] se fatta sul VPS.

### D-W-02 — Il rollback con ripristino non dice in che ordine si fa né che cosa si perde verso RENTRI

- **Severità:** Importante
- **Dove:** piano D, Task 3 Step 8 (sezione Rollback di `ops/README.md`), Decisione 6; spec `04-piattaforma-e-migrazione.md` §4.6 e §4.7.
- **Affermazione del piano:** "Il ripristino dal backup `wasteflow_predeploy_*` con `restore.sh` si fa solo se una migration ha alterato dati, ed è distruttivo per le scritture successive al backup."
- **Perché non regge:** "distruttivo per le scritture successive" è vero ma non basta per agire:
  1. **Ordine.** Il README non dice se ripristinare prima o dopo il `git revert` (30-40 minuti di pipeline). Prima del revert, `restore.sh` gira con l'immagine nuova (D-W-01 punto 4); dopo il revert, per 30-40 minuti il codice difettoso continua a scrivere, e tutto andrà perso. Nessuno dei due ordini è scritto, né il fermo del backend nel frattempo.
  2. **Finestra del dump pre-deploy.** Il dump si prende mentre il backend vecchio è acceso e accetta scritture (`pull` → backup → `migrate` → `up -d`): ciò che si scrive fra dump e `migrate` è perso al ripristino senza che nessuno lo sappia.
  3. **Effetti esterni che il ripristino non annulla.** Dopo il dump l'applicazione può aver consumato numeri vidimati della scorta (`FOR UPDATE SKIP LOCKED`, spec §1.3), trasmesso FIR a RENTRI (`rentriNumeroFir`), assegnato progressivi del registro. Il ripristino riporta "libero" un vidimato già usato sull'ente (riuso), toglie il `rentriNumeroFir` a FIR già sull'ente (la sincronizzazione rifarebbe `POST /`, il doppio FIR della spec §4.6) e riassegna gli stessi progressivi a movimenti diversi da quelli eventualmente già stampati. Le code BullMQ in Redis, che non si ripristina, possono contenere job che puntano a righe sparite.
  4. **Nessuna traccia.** Il ripristino sostituisce anche `ActivityLog`: nel database non resta alcun segno che il registro è stato riportato indietro, né da quale file.
- **Confronto con WinWaste:** lì il ripristino è del database di **una** ditta e **un** anno (`WW<ditta><anno>`, `funzionalita.md` §3.13-3.14, `WWNET92.Restore_Server`), le operazioni di massa lasciano una riga nel log `PEDANA` (`giacenze.md` §4.2) e i vidimati stanno in un database separato (`WWQRCODE`). rifiuti, con un solo database per tutti, ha un raggio d'azione maggiore e meno tracce.
- **Conseguenza per un utente:** dopo un rollback con ripristino un cliente può trovarsi FIR doppi sull'ente, un vidimato usato due volte e numeri di registro che non corrispondono più a quelli stampati, senza che nessuno glielo dica.
- **Evidenza:** `ops/README.md`, sezione "Rollback" (righe 136-158 nel worktree); `deploy.yml:286-293` (backup con il backend vecchio acceso); spec 04 §4.6.
- **Correzione proposta (modifica del piano, solo documentazione):** nella sezione Rollback, una procedura in passi: (1) fermare il backend (`stop backend`) appena si decide il ripristino; (2) annotare l'istante del dump ed estrarre dal database corrente le righe create dopo (FIR con `rentriNumeroFir`, consumi della scorta, movimenti con il loro progressivo) in un file a parte; (3) `git revert`, pipeline, poi `restore.sh` con il `TAG` del rilascio precedente; (4) prima di riaprire, riconciliazione RENTRI dei FIR e della scorta dell'intervallo, e svuotamento verificato delle code BullMQ; (5) una riga in `ActivityLog` (o nel log del ripristino) con file, istante del dump e conteggio delle righe perse; (6) avviso ai tenant toccati. Va detto che per la Fase 0 il caso non si presenta (migration additive), ma la procedura resta per i rilasci successivi.

### D-W-03 — Il backup allarma quando fallisce, non quando non parte

- **Severità:** Importante
- **Dove:** piano D, Task 3 Step 4 (punto 9, `trap`), passi 7.7-7.8; spec `04-piattaforma-e-migrazione.md` §6 R2 ("cron installato **e monitorato**") e §1.9 ("il backup va trattato come funzione del prodotto, non come uno script").
- **Affermazione del piano:** "ogni backup è verificato … e allarma via mail se fallisce".
- **Perché non regge:** la mail parte dal `trap` dello script. Se lo script non gira affatto (file `/etc/cron.d/wasteflow-backup` rimosso o con permessi sbagliati, percorso cambiato dopo un riordino del repository, host riavviato all'ora del cron, cron fermo), non arriva nulla; se manca `msmtp`, `notifica_fallimento` scrive solo su stderr, cioè nel log del cron. Il passo 7.7 prova l'allarme una volta, non la sua presenza nel tempo.
- **Confronto:** il modello Fast Selling citato dal piano stesso ha un controllo **separato** (`/etc/cron.d/fastselling-salute`, ogni 5 minuti: "backup < 26 h", mail ai cambi di stato). WinWaste, pur lasciando il backup al cliente, ha la pianificazione nel prodotto (`WWNETPLAN`, `WWMANAGEMENT.BackupManager`) e un avviso al login (`Login.BackupNotify`, `funzionalita.md` §2, riga di `WWNET.EXE`): chi usa il programma sa se il backup è vecchio. In rifiuti nessuna persona vede lo stato del backup.
- **Conseguenza per un utente:** settimane senza backup scoperte il giorno in cui serve un ripristino.
- **Evidenza:** piano D Task 3 Step 4 punto 9; `grep -i "fresc|26 h|ultimo backup"` in `ops/` senza risultati utili; note infrastrutturali (cron `fastselling-salute`, sezione "BACKUP NEAT" del security report).
- **Correzione proposta:** (a) nel piano, un controllo di freschezza indipendente dallo script: o una sezione "BACKUP WASTEFLOW" in `/opt/roads/security-report.sh` (età dell'ultimo `wasteflow_*.sql.gz` verificato, oggetto `ATTENZIONE` oltre 26 h), o un cron sul modello `fastselling-salute`; [SERVER]. (b) Follow-up di prodotto: età e dimensione dell'ultimo backup verificato nella pagina "Stato del sistema" del SUPER_ADMIN (lo script può scrivere un file di stato letto dal backend in sola lettura).

### D-W-04 — Trenta giorni di backup e nessuna copia dell'anno chiuso

- **Severità:** Importante
- **Dove:** piano D, Task 3 Step 4 punto 8 (rotazione), Decisioni aperte 1; codice `ops/backup-offsite.sh:74` (`BACKUP_RETENTION_DAYS` default 30); spec §9 "conservazione degli anni passati", spec 04 §4.7 e domanda aperta 8.
- **Affermazione del piano:** rotazione per età (`RETENTION_DAYS`) dei notturni e 10 pre-deploy.
- **Perché non regge:** in WinWaste ogni anno chiuso è un database a sé (`WW<ditta><anno>`, `movimenti.md` §2.1; "Creazione archivi nuovo esercizio", `giacenze.md` §4.2): il backup dell'anno chiuso è una copia stabile che il cliente conserva. In rifiuti tutti gli anni stanno in un database vivo, e dopo 30 giorni non esiste più nessuna copia dello stato a una data passata. Un difetto che altera dati vecchi, un'operazione di massa sbagliata o la cancellazione a cascata di un tenant (`onDelete: Cascade`, spec 04 §4.7) scoperti dopo un mese non sono più recuperabili. Il caso tipico è il MUD: si presenta entro il 30 aprile sui dati dell'anno prima, il piano A rileva le modifiche successive con l'hash alla segnatura (`datiModificatiDopoPresentazione`), ma senza un backup di gennaio-aprile lo stato presentato non si ricostruisce.
- **Conseguenza per un utente:** davanti a una contestazione sul registro o sul MUD di un anno passato non si può mostrare com'erano i dati; un errore scoperto tardi è definitivo.
- **Evidenza:** `backup-offsite.sh:74`, `:227-231`; spec 04 §4.7 ("un prodotto che custodisce registri con obbligo di conservazione dovrebbe impedirlo"). L'obbligo di conservazione del registro (pluriennale, art. 190 del D.Lgs. 152/2006 nella lettura corrente) va confermato con il consulente, come la spec chiede alla domanda aperta 8.
- **Correzione proposta (decisione per Graziano, costo di spazio):** ritenzione a più livelli nello stesso script: il primo backup verificato di ogni mese tenuto 13 mesi; quello della prima notte dopo il 1° gennaio italiano (usando `annoSolareItaliano`) tenuto almeno quanto l'obbligo di conservazione più un margine; entrambi **fuori dal VPS** e cifrati quando DG-46 sarà deciso. Finché off-site resta spento, scriverlo nel README come rischio aperto.

### D-W-05 — Senza `TZ`, il PDF del FIR stampa l'ora della firma in UTC, e nessuno lo ha messo fra i follow-up

- **Severità:** Importante
- **Dove:** piano D, Decisione 10 e Decisioni aperte 8; spec `04-piattaforma-e-migrazione.md` §1.12 (terza conseguenza: "le date formattate lato server nei PDF (`pdf.service.ts`, `toLocaleString`) possono mostrare il giorno sbagliato").
- **Affermazione del piano:** "Si corregge invece, puntualmente, il difetto reale di mezzanotte"; il censimento dei punti residui (Decisioni aperte 8) elenca solo `raccogli-attenzione.use-case.ts`, `deadline-checker.service.ts:240,871`, `consultant-tenant-association.repository.ts:173`.
- **Perché non regge:** la Decisione 10 ha tolto il `TZ` che avrebbe sistemato anche la **formattazione**, ma l'elenco dei follow-up conta solo l'aritmetica delle date. `pdf.service.ts` formatta istanti senza `timeZone`, quindi in UTC:
  - `:257` `new Date(sig.signedAt).toLocaleString('it-IT')`: l'ora della firma sul FIR è **sempre** indietro di 1 ora (inverno) o 2 (estate), non solo vicino a mezzanotte;
  - `:146` data di creazione del FIR, `:238` data di rientro della quarta copia, `:57` "Generato il": giorno sbagliato fra le 00:00 e le 01:00/02:00 italiane.
  Con il piano C la data di registrazione diventa un istante reale (DG-18): ogni nuova formattazione lato server di un istante erediterà lo stesso difetto se non passa da `core/time`.
- **Confronto:** in WinWaste la data corrente è quella del PC del cliente (`DateAndTime.DateString`, `movimenti.md` §5 punto 9), cioè sempre l'ora italiana: su questo punto rifiuti stampa peggio del prodotto che vuole sostituire.
- **Conseguenza per un utente:** sul PDF di un FIR firmato alle 10:12 compare "08:12" d'estate; in un controllo su strada o in un'ispezione l'orario non corrisponde a quello dichiarato dal trasportatore.
- **Evidenza:** `apps/backend/src/infrastructure/pdf/pdf.service.ts:57`, `:146`, `:238`, `:257` (nessun `timeZone`); nessun piano della Fase 0 né rapporto dei giri cita queste righe (`grep "pdf.service"` nei piani: solo A Task 9 e C Task 9, su etichette e MUD).
- **Correzione proposta:** in D (o in C, che tocca già `buildFIRContent`) aggiungere a `core/time/anno-italiano.ts` `formattaDataOraItaliana(istante)` con `Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', … })` e usarla nelle quattro righe, con un test su una firma estiva; aggiungere al guardiano il divieto di `toLocale(Date|Time)?String(` senza `timeZone` su `Date` nei sorgenti del backend (eccezioni motivate per i numeri, già coperti da `formattaQuantita`). Se non lo si fa ora, metterlo per primo nelle Decisioni aperte 8.

### D-W-06 — Il backup di rifiuti non basta a ripristinare rifiuti: le identità stanno in Keycloak

- **Severità:** Importante
- **Dove:** piano D, Obiettivo e Task 3; spec 04 §1.6 (Keycloak come IdP) e §1.9.
- **Affermazione del piano:** backup verificato del database `wasteflow_prod` come garanzia di ripristino.
- **Perché non regge:** ogni utente di rifiuti è legato a Keycloak da `User.keycloakId @unique` (`apps/backend/prisma/schema.prisma:168`), e gli utenti si creano in Keycloak dall'applicazione (`user-admin.service.ts:123-158`). Nelle note infrastrutturali non risulta alcun cron di backup del Postgres di Keycloak (l'aggiornamento a 26.7.x annotato il 19/10 dice proprio "serve backup del DB Keycloak"). Se Keycloak si perde, ricreare gli utenti dà id nuovi e nessuno entra più; se si ripristina solo uno dei due a un istante diverso, restano utenti orfani da una parte o dall'altra.
- **Confronto:** in WinWaste gli utenti stanno in `ADMINWWNET` (`rentri/03-aggancio-a-winwaste.md` §2.3), un database SQL Server del cliente, nello stesso perimetro di backup dei dati.
- **Conseguenza per un utente:** dopo un incidente su Keycloak i dati ci sono ma nessun cliente può accedervi finché qualcuno non riallinea a mano `keycloak_id`.
- **Evidenza:** `schema.prisma:168`; `application/admin/user-admin.service.ts:123-158`; elenco dei cron nelle note infrastrutturali (nessuna voce Keycloak).
- **Correzione proposta (follow-up + decisione per Graziano, perché Keycloak è condiviso):** backup di Keycloak con la stessa libreria (`verifica_completezza_dump`, restore di prova); in `ops/README.md`, sezione Ripristino, una riga che dica che il ripristino di rifiuti presuppone Keycloak intatto e come riallineare `keycloak_id` per email se non lo è. Vale anche per la scelta del realm (spec 04 domanda 3).

### D-W-07 — Nessun ripristino per un solo tenant

- **Severità:** Minore
- **Dove:** piano D, Task 3 Step 4b; spec 04 §1.1 e §1.5.
- **Affermazione del piano:** `restore.sh` ripristina il database intero.
- **Perché non regge:** in WinWaste il cliente ripristina, duplica e conserva il **suo** database (`funzionalita.md` §3.14: "Backup e ripristino, pianificazione, duplica database"; `WWNET92.FrmDuplica`). In rifiuti, se un solo cliente cancella per errore anagrafiche o contratti, l'unica via documentata riporta indietro tutti i tenant.
- **Conseguenza per un utente:** l'errore di un cliente si recupera solo a spese degli altri, oppure non si recupera.
- **Evidenza:** `ops/restore.sh` (`DROP DATABASE` dell'intero `DB_NAME`).
- **Correzione proposta (follow-up, Fase 1):** procedura documentata di ripristino selettivo (dump in un database temporaneo con lo stesso `ripristino_di_prova`, copia delle righe del tenant con `tenantId`, verifica); nel frattempo una riga nel README che dica che non è supportato.

### D-W-08 — La pulizia degli eventi Bugsink non guarda il testo delle eccezioni

- **Severità:** Minore
- **Dove:** piano D, Decisione 5, Task 2 (`ripulisciEventoSentry`), passo 7.5.
- **Affermazione del piano:** "niente dati personali negli eventi"; prova al 7.5 con `new Error('prova Fase 0 D')`.
- **Perché non regge:** `ripulisciEventoSentry` toglie `request` e riduce `user`, ma non tocca `exception.values[].value` né i `message` dei breadcrumb. I job inviano errori il cui testo viene dall'esterno: `RentriApiError(status, problema.title, problema.detail, …)` (`infrastructure/rentri/rentri-http-resilienza.ts:119`, `:145`) porta il `detail` dell'ente, che per un errore di validazione può citare identificativi del soggetto. La prova del 7.5 usa un errore pulito, quindi non può accorgersene.
- **Confronto:** la telemetria "con payload" verso il fornitore è proprio il difetto di WinWaste che la spec usa come argomento commerciale (spec 04 §3 riga 22, §5); un Bugsink condiviso da nove stack con CF nei messaggi lo indebolirebbe.
- **Evidenza:** `apps/backend/src/core/monitoring/opzioni-sentry.ts:13-44` (nessun trattamento di `exception`); `rentri-http-resilienza.ts:119`, `:145`.
- **Correzione proposta (modifica piccola):** in `ripulisciEventoSentry`, mascherare nei `value` delle eccezioni e nei `message` dei breadcrumb i codici fiscali (16 caratteri alfanumerici nel formato CF) e le partite IVA (11 cifre); un test con `RentriApiError` che contiene un CF finto; al 7.5 una seconda prova con un errore il cui messaggio contiene il CF finto.

### D-W-09 — Il backup pre-deploy senza interruttore blocca anche il rollback

- **Severità:** Minore
- **Dove:** piano D, Decisione 6 e Decisione 14; DG-05.
- **Affermazione del piano / decisione:** "Nessun interruttore per saltare il backup: se fallisce, il deploy si ferma e la produzione resta sulla versione precedente."
- **Evidenza nuova rispetto a DG-05:** la conseguenza scritta in DG-05 considera solo il rilascio in avanti. Il rollback documentato è un `git revert` che passa dalla **stessa** pipeline (sezione Rollback): anche il deploy del revert fa il backup pre-deploy e chiede 2× `pg_database_size` liberi in staging. Con il disco quasi pieno (95% a settembre, note infrastrutturali) il rollback si ferma e in produzione resta la versione difettosa, cioè il contrario di "la produzione resta sulla versione precedente".
- **Conseguenza per un utente:** il guasto che ha motivato il rollback dura finché qualcuno non libera spazio a mano.
- **Correzione proposta (solo documentazione, la decisione resta):** nel README, sezione Rollback, la via d'uscita con l'approvazione di Graziano: `BACKUP_STAGING_DIR` puntato a un filesystem con spazio, o liberare spazio (`vps-docker-cleanup.sh` in `DRY_RUN` prima) e rilanciare il job; mai togliere il passo dal workflow.

### D-W-10 — `annoSolareItaliano` e `giornoItaliano` usano due regole diverse nello stesso modulo

- **Severità:** Minore
- **Dove:** piano D, Decisione 9, Task 5 Interfaces.
- **Affermazione del piano:** `annoSolareItaliano(d) = anno UTC di (d + 1 h)`, "esatta per ogni istante" perché a Capodanno l'Italia è sempre in UTC+1; `giornoItaliano` usa invece l'ICU con `Europe/Rome`.
- **Perché non regge del tutto:** la formula fissa è esatta con le regole di oggi, ma è un'assunzione scritta a mano accanto a una funzione che legge le regole vere dal tzdata. Se l'Italia adottasse l'ora legale tutto l'anno (la proposta UE di abolire il cambio d'ora non è chiusa), `annoSolareItaliano` sbaglierebbe un'ora a Capodanno mentre `giornoItaliano` resterebbe giusta: anno del progressivo e giorno del movimento divergerebbero in silenzio. Il piano dice "un solo modulo, una sola regola", e qui le regole sono due.
- **Correzione proposta:** `annoSolareItaliano(d) = Number(giornoItaliano(d).slice(0, 4))`; i test del Task 5 restano validi così come sono.

---

## Cosa regge

- **Copertura della spec per l'esercizio.** I quattro punti di §4.8 che la Fase 0 doveva chiudere ci sono tutti: `SENTRY_DSN` nel compose con un guardiano che impedisce la stessa trappola delle variabili SMTP; dump con marcatore e restore di prova; backup prima di `migrate deploy` con `set -e` e `script_stop`; smoke test su `/api/v1/health/db` (R3). R1 è applicato nella parte prevista (log `max-size`). Node/Angular e l'ambiente dedicato sono fuori di proposito, con decisione registrata.
- **Backup.** Libreria senza `set -e`, `DROP … WITH (FORCE)` sempre eseguito, file `.parziale`/`.scartato`/`.non-verificato`, controllo dello spazio prima del dump e del restore, lettura del `.env` senza `source`, percorso del compose corretto anche in `restore.sh`: è la lezione Gitea del 16/09 e il modello Fast Selling applicati per intero. Rispetto a WinWaste, dove il backup è affare del cliente (spec 04 §1.9), rifiuti se lo prende in carico, che è la direzione giusta per un SaaS.
- **Tempo italiano.** La scelta di non impostare `TZ` è motivata con evidenza (orari dei `@Cron`, date salvate a mezzanotte UTC, colonne `timestamp` senza fuso) e la correzione puntuale della "data nel futuro" è giusta in ora solare e legale; i test coprono 00:30 del 1° gennaio e 00:30 estive. Il comportamento finale ("oggi" = giorno di Roma) coincide con quello di WinWaste, che usa la data del PC del cliente.
- **Passaggio d'anno.** rifiuti non ha bisogno di "Creazione archivi nuovo esercizio" né del riporto `AggGIACRIFIUTI` (non transazionale, `giacenze.md` §4.2): la numerazione riparte per `progressiveYear` dentro la stessa transaction, e con `annoSolareItaliano(registrationDate)` riparte alla mezzanotte italiana, come in WinWaste riparte per database. L'attribuzione al nuovo anno delle registrazioni di gennaio relative a operazioni di dicembre segue la data di registrazione, coerente con un registro cronologico; resta da far confermare al consulente insieme alle altre domande di dominio, non è un difetto del piano.
- **Bugsink e dati personali.** Niente tracing, `sendDefaultPii: false`, integrazioni HTTP e `RequestData` ristrette, `beforeSend` indipendente dalla versione dell'SDK, 4xx e 503 di `/health` esclusi, errori dei job per tenant con tag, lettura di un evento vero al 7.5: l'impianto è solido, salvo il testo delle eccezioni (D-W-08).
- **Ordine di rilascio e revert.** D → C → A, revert solo in ordine inverso, revert del revert, `PERMISSION_CACHE_HMAC_SECRET` nel `.env` prima del merge, passi sul server marcati e con baseline: coerenti con la natura condivisa del VPS.
- **Permessi.** Gli endpoint `/backup` sono già spariti (`ddac487`) e il piano toglie anche i bind mount: backup e ripristino restano operazioni da `root` sul VPS, non funzioni esposte. In WinWaste la funzione F08 è dietro le autorizzazioni per utente e azienda; in un SaaS tenerla fuori dall'applicazione è più prudente, purché lo stato del backup sia visibile a qualcuno (D-W-03).

---

## Conteggio

- Critica: 0
- Importante: 6 (D-W-01, D-W-02, D-W-03, D-W-04, D-W-05, D-W-06)
- Minore: 4 (D-W-07, D-W-08, D-W-09, D-W-10)
