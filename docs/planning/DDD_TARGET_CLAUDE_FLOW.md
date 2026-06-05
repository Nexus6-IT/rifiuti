# WasteFlow → Architettura DDD "claude-flow v3" (adattata a NestJS)

> 2026-06-05 · Prodotto da swarm ruflo `swarm-1780648028091-uxxqsr` (system-architect + code-analyzer)
> Obiettivo (richiesta utente): "portare WasteFlow a claude-flow, così come se lo aspetta ruflo" →
> ristrutturare il backend secondo i principi DDD/microkernel/clean-architecture dello skill
> `v3-ddd-architecture`, **adattati al fatto che WasteFlow è un'app NestJS** (i moduli NestJS sono
> già il meccanismo di "plugin/DI" che il kernel claude-flow descrive — non si reimplementa un kernel custom).

---

## 0. Interpretazione e principio guida

Lo skill `v3-ddd-architecture` descrive l'architettura del *prodotto claude-flow stesso* (spezzare un god-object `orchestrator.ts` in `core/domains/` + kernel + plugin + domain event bus). WasteFlow **non ha quel god-object**: ha già i layer DDD. Quindi "portarlo a claude-flow" significa **adottare gli stessi principi** e portarli a uno stato pulito e coerente:

| Concetto claude-flow v3 | Resa idiomatica in WasteFlow/NestJS |
|---|---|
| `ClaudeFlowKernel` che carica i domini | `AppModule` che compone i **moduli di bounded context** NestJS |
| `DomainPlugin` (core/optional) | Moduli NestJS di contesto (core sempre attivi, opzionali feature-flagged) |
| `DomainEventBus` | `@nestjs/cqrs` `EventBus` **oppure** `EventEmitter2` (decisione aperta) |
| Clean Architecture (dipendenze verso l'interno) | regola: `domain` puro → `application` (port) → `infrastructure`/`api` (adapter) |
| Bounded context isolation | **un solo** albero di dominio per contesto, nessun doppione |
| London-School TDD sul domain | test puri sugli aggregati (il domain torna POJO) |

---

## 1. Problemi che bloccano il "DDD pulito" (dall'analisi)

Sintesi delle due analisi (dettaglio in `ANALISI_E_PIANO_2026-06.md` e `TODO_INVENTORY.md`):

1. **Due domain tree paralleli**: `src/domain/**` e `src/core/domain/**`, con aggregati duplicati (`fir.aggregate.ts` ×2, `user.entity.ts` ×2) e **due `PrismaService`**. → ambiguità su "quale versione è viva".
2. **Domain impuro** (viola "domain senza dipendenze esterne"): `bcrypt` in `user.entity.ts`; `@Injectable/@Inject/Logger` NestJS in `cer-catalog.service.ts` e `abac-policy-evaluator.service.ts`; ID generati con strategie miste (`crypto` vs `uuid`).
3. **Dependency inversion rotta**: use-case auth e command handler dipendono da classi **concrete** (`UserRepository`, `PrismaService`, `PermissionCacheService`) invece che da interfacce/port.
4. **Event bus mai realizzato**: gli aggregati accumulano domain events (`addDomainEvent`) ma **nessuno li pubblica** → audit/cache/notifiche fatti inline.
5. **Leaky abstraction / bug P0**: `getContextTenantId()=tenant.findFirst()` (cross-tenant leak), `permission.guard.ts:71` nega su cache-miss, `fir-prisma` `toDomain` usa `Object.assign` per reflection (rompe l'incapsulamento), MUD/analytics ritornano dati mock, **RLS disabilitato** in `prisma-rls.extension.ts`.
6. **God object**: `role-change-history.repository.ts` (691) e `permission-audit-log.repository.ts` (675) mescolano persistenza + export CSV + statistiche + archiviazione S3.
7. **Domain ↔ schema Prisma mai riconciliati**: 54 TODO di mapping (naming IT vs EN, campi mancanti `destinationType`/`isActive`/SPID, tabelle `CER`/`rENTRISyncLog` inesistenti).
8. **CQRS incoerente**: command che ritornano l'aggregato; due stili (use-case POJO vs `@Injectable` handler).

---

## 2. Architettura target (bounded context come moduli)

Struttura per contesto. Ogni contesto è un **modulo NestJS** auto-contenuto (`<context>.module.ts` = il "domain module/plugin" dello skill), con i 4 layer al suo interno o condivisi via `shared-kernel`.

```
apps/backend/src/
├── kernel/                      # composizione (≈ ClaudeFlowKernel)
│   ├── app.module.ts            # carica i moduli di contesto core + opzionali
│   └── shared-kernel/           # ex "core": AggregateRoot, Result, DomainEvent, VO condivisi
│       ├── domain/              # AggregateRoot, DomainEvent, DomainException, base VO
│       ├── ports/               # IEventPublisher, ICacheInvalidator, IPasswordHasher, IClock
│       └── application/         # Result<T>
│
├── contexts/                    # un bounded context per cartella (UN SOLO domain tree)
│   ├── waste-tracking/          # FIR (core)
│   │   ├── domain/              # fir.aggregate.ts (UNICO), VO, events, IFIRRepository
│   │   ├── application/         # use-case (command) + query handler
│   │   ├── infrastructure/      # fir-prisma.repository.ts (adapter)
│   │   ├── api/                 # fir.controller + DTO
│   │   └── waste-tracking.module.ts
│   ├── registry/                # Produttore/Trasportatore/Destinatario (core)
│   ├── identity-access/         # IAM RBAC+ABAC+Consultant multi-tenant (core)
│   ├── tenancy/                 # TenantContext, middleware, RLS, switch società (core)
│   ├── rentri-integration/      # sync RENTRI (core)
│   ├── compliance-reporting/    # MUD + analytics (core)
│   ├── digital-signatures/      # firme ECDSA (core)
│   ├── cer-catalog/             # catalogo CER (core)
│   ├── notifications/           # notifiche (opzionale)
│   └── document-generation/     # PDF/template (opzionale)
│
└── platform/                    # infrastruttura trasversale (adapter concreti)
    ├── persistence/             # UN SOLO PrismaService + RLS extension
    ├── auth/                    # Keycloak SAML, JWT strategy
    ├── messaging/               # EventBus (impl), EventEmitter
    ├── cache/  email/  storage/  jobs/  monitoring/
```

**Regola di dipendenza (clean architecture), verificabile in CI con eslint import rules:**
`domain` → (nulla) · `application` → `domain` + `ports` · `infrastructure`/`api` → `application` + `domain`. Mai il contrario.

### Comunicazione tra contesti = solo eventi/port
- I contesti **non** importano gli aggregati l'uno dell'altro. Comunicano via **domain events** sul bus (es. `FIRConsegnatoEvent` → `rentri-integration` reagisce con la sync) o via **port** applicativi.
- Esempio: oggi `FirConsegnatoHandler` esiste ma non è cablato → con l'event bus diventa il pattern standard cross-context.

---

## 3. Mappa contesti → moduli (core vs opzionali)

| Contesto | Tipo | Aggregate root | Note |
|---|---|---|---|
| waste-tracking (FIR) | core | `FIR` | state machine + invarianti peso ±10% |
| registry | core | Produttore/Trasportatore/Destinatario | anagrafiche |
| identity-access | core | Role, ABAC, ConsultantTenantAssociation | RBAC+ABAC, consulente multi-società |
| tenancy | core | (context service) | TenantContext via AsyncLocalStorage + RLS |
| rentri-integration | core | `RENTRISyncLog` | reagisce a eventi FIR |
| compliance-reporting | core | `MUDReport` (DA CREARE) | oggi solo service con mock |
| digital-signatures | core | (domain service) | ECDSA + RFC 3161 |
| cer-catalog | core | `CERCode` | dominio puro (togliere NestJS) |
| notifications | opzionale | `Notification` | event-driven |
| document-generation | opzionale | `CompanyTemplate` | PDF |

---

## 4. Piano di migrazione (incrementale, TDD-guidato)

Ordine pensato per **sicurezza prima, struttura dopo**, ogni passo verde in CI prima del successivo. Il test `tenant-isolation.spec.ts` (già RED) è la prima rete di sicurezza.

### P0 — Sicurezza & correttezza (sblocca tutto)
- **Tenancy context**: creare `TenantContext` (AsyncLocalStorage) popolato da `TenantContextMiddleware`; eliminare `getContextTenantId()/tenant.findFirst()` nei 3 repository; `tenantId` esplicito in ogni `where`. → `tenant-isolation.spec.ts` diventa GREEN.
- **Permission guard**: fallback DB su cache-miss (no `deny`/`[]`); togliere lo spread `request.body` per attributi ABAC.
- **Riattivare RLS** (`prisma-rls.extension.ts`) o garantire `tenantId` ovunque.

### P1 — Consolidamento strutturale (il cuore del "porting")
- **Unificare i due domain tree**: scegliere la versione viva di `FIR`/`User`, eliminare i doppioni, un solo `PrismaService`. Spostare `core/` → `kernel/shared-kernel/`.
- **Riorganizzare in `contexts/<bounded-context>/`** con `*.module.ts` per contesto; `AppModule` li compone.
- **Aggiungere eslint import-boundaries** per imporre la regola di dipendenza in CI.

### P2 — Purezza & inversione dipendenze
- Domain POJO: estrarre `bcrypt` dietro `IPasswordHasher` (port); togliere `@Injectable/@Inject/Logger` da `cer-catalog`/`abac-evaluator`; uniformare generazione ID.
- Use-case e handler dipendono da **interfacce** (`IUserRepository`, `ICacheInvalidator`, `IEventPublisher`) iniettate per token.
- `fir-prisma.toDomain`: vero `FIR.reconstitute(...)` al posto di `Object.assign` reflection.

### P3 — Event bus & CQRS coerente
- Introdurre **DomainEventBus** (decisione: `@nestjs/cqrs` o `EventEmitter2`) e dispatchare gli eventi accumulati; spostare audit/cache/notifiche negli **event handler**.
- Command ritornano `id`/`Result<void>`; uniformare lo stile (use-case vs handler).
- Cablare cross-context: `FIRConsegnatoEvent` → sync RENTRI; `UserCreatedEvent` → ecc.

### P4 — Riconciliazione domain↔schema & de-mock
- Allineare schema Prisma e dominio (naming unico, campi `destinationType`/`isActive`/SPID, tabelle CER/`rENTRISyncLog`); azzerare i 54 TODO.
- Creare aggregato `MUDReport`; rimuovere i mock di MUD/analytics.
- Spezzare i god-object dei repository audit (persistenza ≠ reporting/export/S3).

---

## 5. Success metrics (adattati da claude-flow v3)
- [ ] **Un solo domain tree** (zero doppioni di aggregati/`PrismaService`).
- [ ] **Domain purity 100%**: nessun import di NestJS/bcrypt/Prisma dentro `**/domain/**` (enforced in CI).
- [ ] **Bounded context come moduli**: ogni contesto è un modulo NestJS isolato; cross-context solo via eventi/port.
- [ ] **Dependency rule** verificata da lint import-boundaries.
- [ ] **Event bus attivo**: 0 `TODO: event bus`; domain events pubblicati e gestiti.
- [ ] **CQRS coerente**: command non ritornano aggregati; uno stile unico.
- [ ] **Nessun god object** >300-400 righe con responsabilità miste.
- [ ] **tenant-isolation.spec.ts GREEN** + RLS attivo.
- [ ] **0 dati mock** in MUD/analytics; 54 TODO mapping → 0.
- [ ] **Coverage domain** ≥90% (domain ora testabile perché POJO).

---

## 6. Rischio & approccio
Refactor strutturale su ~39k righe: **incrementale e TDD-guidato**, mai big-bang. Ogni fase deve restare verde in CI (creata in Fase 0). Lo swarm ruflo coordina; i domain events e il test di isolamento fanno da reti di sicurezza. La sequenza P0→P4 è anche un ordine di valore: si parte dalla sicurezza (cross-tenant) che è il fondamento del differenziatore "consulente multi-società".
