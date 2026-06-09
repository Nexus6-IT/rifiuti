# Inventario Debito Tecnico — Fase 0 (WasteFlow / rifiuti)

> Generato il 2026-06-05. Scope analizzato: `apps/backend/src` + `apps/frontend/src`
> (esclusi `node_modules`, `dist`, `coverage`). Marker cercati: `TODO`, `FIXME`,
> `HACK`, `XXX`, `not implemented`, `throw new Error('TODO'|'not implemented')`.

## 0. Stato avanzamento (aggiornato 2026-06-09)

Blocchi risolti rispetto alla baseline del 2026-06-05:

| # | Blocco | Stato | Commit/Nota |
|---|--------|-------|-------------|
| 1 | permission.guard cache-miss → DB | ✅ risolto | guard interroga il DB su cache miss (`loadPermissionsFromDb`) |
| 2 | jwt.strategy permessi RBAC vuoti | ✅ risolto | `resolvePermissions` da assegnazioni ruolo attive |
| 4 | assign-role: utente/tenant non validati | ✅ risolto | validazione esistenza + appartenenza tenant |
| 5 | RLS disabilitata | ✅ risolto | commit P0 sicurezza (multi-tenant/RLS) |
| 8 | analytics dati mock (destinationType) | ✅ risolto | `wasteOperationType` reale + groupBy |
| 9 | MUD generator dati mock | ✅ risolto | aggregazione reale recupero/smaltimento |
| 10 | FIR mapping campi anagrafici vuoti | ✅ risolto | snapshot anagrafico immutabile dai registri |
| 15 | assign/revoke ruolo non auditati | ✅ risolto | revoke accoda `role-change`; assign già accodava |

Ancora aperti (bloccanti residui): #3 (facilityIds/temp permission lookup),
#6/#7 (filtro tenant nei repository produttore/FIR — verificare dopo il lavoro
RLS), #11-#14 (audit firma/retention S3/decennale, integrità catena audit API),
e su tutti il #1 della gap-analysis: **RENTRI reale** (richiede credenziali
ambiente di test ufficiale + accreditamento, non completabile offline).

## 1. Tabella riassuntiva conteggi

| Categoria | Conteggio occorrenze | Note |
|-----------|---------------------|------|
| **BLOCCANTE** | 18 | Sicurezza/RBAC, isolamento multi-tenant, mock al posto di dati reali, compliance (audit/retention/firma) |
| **IMPORTANTE** | ~34 | Funzionalità incomplete non bloccanti: schema Prisma mancante, event bus, metriche, cache, notifiche |
| **COSMETICO** | ~12 | Falsi positivi (`xxxx` nei generatori UUID), refactor minori, naming, nice-to-have UI |
| **TOTALE marker reali (TODO/FIXME)** | ~64 | I `.bak` e i pattern `xxxx` UUID sono esclusi dal conteggio "reale" |

Note metodologiche:
- I file `*.ts.bak` (`destinatario`, `produttore`, `trasportatore` repository) contengono
  decine di TODO ma sono **backup non compilati**: vanno eliminati dal repo, non risolti.
- I match su `xxxxxxxx-xxxx-4xxx-...` (in `domain-event.interface.ts`, `cer-code.entity.ts`,
  `user.entity.ts`, `fir.aggregate.ts`) sono **template UUID v4**, non debito → cosmetico/ignorabili.
- Il pattern `metodo:`/`Metodo firma` nel frontend e in `rentri-api.client.ts` sono falsi positivi
  (la parola "metodo"/"method"), non TODO.

---

## 2. BLOCCANTI (path:riga + impatto)

### Sicurezza / RBAC / Autorizzazione

1. **`apps/backend/src/api/guards/permission.guard.ts:71,76`** — Il guard dei permessi NON interroga il DB in caso di cache miss (`TODO: implement in Phase 3` / `Query UserRoleRepository + PermissionRepository`).
   *Impatto:* l'enforcement dei permessi è incompleto; richieste possono passare o fallire in modo non deterministico → autorizzazione non affidabile.

2. **`apps/backend/src/auth/strategies/jwt.strategy.ts:52`** — `TODO: implement RBAC permissions`: il JWT viene costruito con permissions vuote.
   *Impatto:* nessun permesso reale propagato nel token → l'intero strato RBAC a valle lavora su dati assenti.

3. **`apps/backend/src/application/queries/handlers/get-user-permissions.handler.ts:50,102`** — `facilityIds: []` e `Implement temp permission lookup` non implementati.
   *Impatto:* lo scoping per facility e i permessi temporanei non vengono risolti → utenti possono vedere/non vedere risorse fuori dal proprio scope.

4. **`apps/backend/src/application/commands/handlers/assign-role.handler.ts:63`** — `TODO: Inject UserRepository and validate user exists and belongs to tenant`.
   *Impatto:* si può assegnare un ruolo a un utente inesistente o di un ALTRO tenant → escalation cross-tenant.

### Isolamento multi-tenant

5. **`apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts:6,32`** — Row-Level Security **disabilitata** (`RLS implementation currently disabled due to TypeScript type conflicts`); fallback a inclusione manuale di `tenantId`, non garantita.
   *Impatto:* viene a mancare la barriera DB-level di isolamento tenant; ogni query che dimentica `tenantId` espone dati cross-tenant. Requisito core ("Schema-per-tenant + RLS").

6. **`apps/backend/src/infrastructure/persistence/produttore-prisma.repository.ts:33,70,115`** — `Extract tenantId from request context` / `Filter by tenantId from context` non implementati.
   *Impatto:* le query sui produttori non sono filtrate per tenant → leak di dati anagrafici cross-tenant.

7. **`apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:153`** — `TODO: Schema uses tenantId or producerUserId` (filtro tenant ambiguo/non applicato sui FIR).
   *Impatto:* i Formulari (FIR), dato sensibile e regolato, rischiano di essere accessibili fuori dal tenant proprietario.

### Mock al posto di dati reali

8. **`apps/backend/src/application/analytics/analytics.service.ts:118,125,303,345`** — Il servizio analytics **ritorna dati mock** (zeri) perché `destinationType` e alcuni status non esistono nello schema Prisma.
   *Impatto:* la dashboard analytics mostra numeri finti; decisioni operative/compliance su dati non reali.

9. **`apps/backend/src/application/mud/mud-generator.service.ts:41`** — Generatore MUD usa campo `destinationType` inesistente nello schema.
   *Impatto:* il report MUD (dichiarazione ambientale obbligatoria) viene prodotto su dati incompleti/errati → rischio di non conformità normativa.

10. **`apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:202-215`** — Mapping FIR→dominio con campi hardcoded a stringa vuota (`producerName: ''`, `carrierPartitaIva: ''`, `wasteDescription: ''`, ecc.).
    *Impatto:* i dati di produttore/trasportatore/destinatario e descrizione rifiuto non vengono valorizzati → FIR incompleti e non validi a fini legali.

### Compliance (audit trail / firma / retention)

11. **`apps/backend/src/application/signatures/signature-audit.handler.ts:53,104,149,196,202,251,262`** — Il modello `auditLog` non esiste; si usa `activityLog` come ripiego; alert e accodamento RENTRI post-firma sono solo log testuali (`TODO: Alert should be created...`).
    *Impatto:* l'audit trail delle firme digitali e la sincronizzazione RENTRI conseguente non sono garantiti → catena di custodia/compliance D.M. 59/2023 a rischio.

12. **`apps/backend/src/application/signatures/signature-audit.handler.ts:59`** — `userId: signerFiscalCode // TODO: should be the actual user ID, not fiscal code`.
    *Impatto:* l'audit registra il codice fiscale al posto dell'ID utente → integrità/correttezza del dato di audit compromessa e possibile esposizione di dato personale.

13. **`apps/backend/src/api/audit/audit.controller.ts:148,181,265,300`** — Endpoint di audit non collegati al repository (`Inject PermissionAuditLogRepository`, `validateChainIntegrity` non implementato).
    *Impatto:* l'API di audit/verifica integrità della catena non funziona → impossibile dimostrare l'inalterabilità dei log richiesta in compliance.

14. **`apps/backend/src/infrastructure/jobs/archive-audit-logs.job.ts:15`** + **`cleanup-old-permission-requests.job.ts:88`** + **`permission-audit-log.repository.ts:597`** + **`role-change-history.repository.ts:637`** — Archiviazione/retention a lungo termine (S3, "10-year retention", "3 years cold storage") **non implementata**.
    *Impatto:* la conservazione decennale dei dati richiesta dalla normativa rifiuti non è garantita; i job di cleanup possono eliminare dati prima dell'archiviazione → perdita irreversibile.

15. **`apps/backend/src/application/commands/handlers/assign-role.handler.ts:132,266`** + **`revoke-role.handler.ts:87,141,151`** — Le modifiche di ruolo non vengono persistite nell'audit log (`Use AuditLogService to persist audit entry`).
    *Impatto:* assegnazioni/revoche di privilegi non tracciate → nessuna evidenza forense di chi ha cambiato i permessi (requisito di accountability).

---

## 3. IMPORTANTI (raggruppati per area)

Funzionalità incomplete che NON bloccano correttezza/sicurezza immediata ma vanno chiuse.

### Schema Prisma incompleto (driver principale del debito)
Molti TODO derivano dallo schema Prisma non allineato al dominio:
- `analytics.service.ts` / `mud-generator.service.ts` — campo `destinationType` mancante.
- `notification.service.ts:277,292` — tipo `FIR_COMPLETED` mancante (fallback `RENTRI_SYNC_SUCCESS`).
- `signature-audit.handler.ts` — modelli `auditLog`, `rENTRISyncQueue`, `alert` mancanti.
- `rentri-sync-log.repository.ts:25,51,68,82,139,164,174` — modello `rENTRISyncLog` mancante (repository tutto stub/commentato).
- `cer-prisma.repository.ts:16-58` — tabella CER codes non esiste (tutti i metodi sono stub).
- `user.repository.ts:40,47,71,214,228,254` — campi `isActive` e attributi SPID assenti dal modello User.
- `deadline-checker.service.ts:169-196` — entità Register/Authorization non a schema.
- `fir-prisma.repository.ts` (numerosi) — disallineamento nomi campo dominio↔schema (`numeroProgressivo`/`firNumber`, `anno`, `FIRStato`↔`FIRStatus`).

### Event bus / domain events (non collegato)
- `presa-in-carico-fir.use-case.ts:39`, `emetti-fir.use-case.ts:45`, `conferma-consegna-fir.use-case.ts:38` — `event bus integration` mancante.
- `assign-task.handler.ts:75`, `reassign-task.handler.ts:65`, `assign-role.handler.ts:132` — emissione eventi per notifiche non implementata.

### Metriche / monitoring
- `rentri-sync.job.ts:113,256,324,356` — 4 metriche RENTRI assenti in `MetricsService`.
- `track-duration.decorator.ts:38,75` — registrazione su Prometheus (histogram/counter) non collegata.

### Cache / job permessi
- `warm-permission-cache.job.ts:15` — pre-load permessi utenti attivi non implementato.
- `switch-tenant-context.handler.ts:159` — cache warming non implementato su `RoleCacheService`.
- `expire-temp-permissions.job.ts:77,80` — invalidazione cache (Redis pub/sub) e notifiche assenti.
- `notification-escalation.service.ts:305,325` — escalation basata su cache Redis non implementata.

### PDF / RENTRI
- `pdf-generation.job.ts:220` — merge PDF con `pdf-lib` non implementato.
- `rentri-sync.controller.ts:188` — `correlationId` dal DTO non passato allo use case.

### Frontend (UX non bloccante)
- `permissions/services/tenant-switch.service.ts:129,153`, `csv-export-button.component.ts:90`, `tenant-selector.component.ts:402` — notifiche errore (toast) non mostrate.
- `tenant-selector.component.ts:432,441`, `custom-role-builder.component.ts:407` — dati recuperati da metadata mock invece che da API.
- `my-assignments.component.ts:982,998` — navigazione dettaglio e "start pickup" via API non implementati.

---

## 4. COSMETICI (solo conteggio + esempi)

Conteggio: ~12 occorrenze. Sono per lo più **falsi positivi** o nice-to-have:
- Template UUID v4 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` in `domain-event.interface.ts:95`, `cer-code.entity.ts:113`, `user.entity.ts:185`, `fir.aggregate.ts:230` — non sono debito (generatori UUID).
- `digital-signature.service.spec.ts:166` — stringa `XXXXXXXX` usata per simulare firma manomessa in un test.
- `audit-metadata.vo.ts:77` — `Geolocation not implemented yet` (campo opzionale).
- `get-user-permissions.handler.ts:50` (commento `Cache facility IDs too`) — ottimizzazione cache.
- Frontend: parole "Metodo firma"/"Metodo di firma" — falsi positivi su `XXX`/match parziali.

**Azione consigliata trasversale:** rimuovere i 4 file `*.ts.bak`
(`destinatario-prisma.repository.ts.bak`, `produttore-prisma.repository.ts.bak`,
`trasportatore-prisma.repository.ts.bak`) dal repository: contengono ~25 TODO orfani
non compilati che inquinano qualsiasi futura scansione.

---

## 5. Raccomandazione `fix-function.sql`

**File:** `apps/backend/prisma/fix-function.sql`
**Verdetto: (a) RIDONDANTE — rimuovere il file.**

### Analisi
`fix-function.sql` fa `DROP` + `CREATE OR REPLACE` della funzione Postgres
`seed_default_roles_for_tenant(UUID, UUID)`, con il fix che include le colonne
`created_at, updated_at` (valorizzate `CURRENT_TIMESTAMP`) negli `INSERT INTO roles`.
Questo fix serve perché la tabella `roles` definisce
`"updated_at" TIMESTAMP(3) NOT NULL` **senza default**
(migration `20251102094445_roles_permissions_system/migration.sql:13`): un INSERT che
omette `updated_at` fallirebbe.

Verifica incrociata:
- La funzione **NON è definita in nessuna migration** (`migrations/**` non contiene
  `seed_default_roles_for_tenant` né `CREATE FUNCTION`). Quindi non è un caso "fix già
  nella migration".
- La funzione **è già definita, già corretta**, in due punti del codebase che includono
  entrambi `created_at, updated_at` con `CURRENT_TIMESTAMP`:
  - `apps/backend/prisma/seeds/001_default_roles_permissions.sql:122-155` (versione canonica del seed).
  - `apps/backend/prisma/seed-test-user.ts:100-128` (ricreata a runtime via `$executeRawUnsafe`).
- Il contenuto di `fix-function.sql` è **sostanzialmente identico** alla definizione già
  presente nel seed: stesse colonne, stessi valori, stessa firma. Non aggiunge nulla.

Conclusione: il fix è già incorporato nei seed ufficiali; `fix-function.sql` è un patch
ad-hoc duplicato, residuo di debug. Mantenerlo crea due fonti di verità per la stessa
funzione (rischio di drift futuro).

### Raccomandazione concreta
1. **Eliminare** `apps/backend/prisma/fix-function.sql` (è già `?? untracked` in git, quindi
   basta non committarlo / rimuoverlo dal working tree). Nessuna modifica applicata in
   questa fase, solo raccomandazione.
2. **(Opzionale, miglioria robustezza)** Se in futuro si vuole che la funzione viva in una
   migration versionata anziché solo nei seed, creare una nuova migration Prisma:
   `apps/backend/prisma/migrations/<timestamp>_seed_default_roles_function/migration.sql`
   incorporando la versione **già corretta** dal seed (con `created_at, updated_at`).
   In alternativa, considerare di aggiungere `DEFAULT CURRENT_TIMESTAMP` alla colonna
   `roles.updated_at` (e analoghe), così l'INSERT non dipende dall'esplicitare il campo.
   Questa parte resta a discrezione: il fix funzionale è già coperto dai seed.
