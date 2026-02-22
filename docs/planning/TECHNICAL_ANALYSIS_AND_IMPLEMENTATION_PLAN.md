# TECHNICAL ANALYSIS & IMPLEMENTATION PLAN - WasteFlow

**Data:** 2025-10-30
**Versione:** 1.0
**Approccio:** Full-Stack Production-Ready Analysis
**Scope:** Backend (NestJS) + Frontend (Angular 17) + Database + Infrastructure

---

## EXECUTIVE SUMMARY

### Stato Attuale
Il progetto WasteFlow ha completato con successo:
- **Domain Layer**: 100% implementato con TDD (85%+ coverage)
- **Application Layer**: CQRS pattern implementato (CreateFIR, EmettiFIR, PresaInCarico, ConfermaConsegna)
- **Database Schema**: Completo con multi-tenancy, audit log, backup
- **Infrastructure**: Moduli base (Analytics, Notifications, MUD, Backup, PDF, Monitoring)

### Gap Critici Identificati
1. **Backend**: Prisma repositories non implementati, SPID auth stub, RENTRI integration missing
2. **Frontend**: Angular 17 base setup, componenti parziali, state management assente
3. **Real-time**: WebSocket/SSE non implementato
4. **IoT**: Pipeline dati bilance/sensori mancante
5. **Advanced Features**: Route optimization, geospatial queries, PWA offline

### Implementation Priority
**FASE 1 (Mesi 1-2)**: Infrastructure completamento + Backend MVP
**FASE 2 (Mesi 3-4)**: Frontend Angular completo + Real-time
**FASE 3 (Mesi 5-6)**: Advanced features + Performance optimization

---

## 1. CODEBASE ANALYSIS

### 1.1 Struttura Attuale del Progetto

```
C:\Progetti\rifiuti\
├── apps/
│   ├── backend/               ✅ NestJS 10.3, TypeScript 5.3
│   │   ├── src/
│   │   │   ├── domain/        ✅ DDD entities, aggregates, value objects
│   │   │   ├── application/   ✅ Use cases, CQRS commands/queries
│   │   │   ├── api/           ⚠️  Controllers parziali (FIR, Health, Registry)
│   │   │   ├── infrastructure/⚠️  Prisma module base, monitoring skeleton
│   │   │   ├── auth/          ⚠️  SPID strategy stub, JWT guards basic
│   │   │   └── core/          ✅ Logger, Metrics, Result pattern
│   │   ├── prisma/
│   │   │   └── schema.prisma  ✅ Schema completo multi-tenant
│   │   └── test/              ✅ Unit tests 85%+, e2e parziali
│   └── frontend/              ⚠️  Angular 17 setup base
│       ├── src/app/
│       │   ├── core/          ⚠️  Services parziali, layout components
│       │   ├── features/      ⚠️  FIR, Registry, Dashboard components base
│       │   └── shared/        ⚠️  Models, components comuni
│       └── package.json       ⚠️  PrimeNG 17, Chart.js, XLSX
├── documentazione/            ✅ Architettura, analisi, requisiti completi
└── package.json               ✅ Monorepo workspace structure
```

**Legend:**
- ✅ Completo e production-ready
- ⚠️  Parziale o da refactoring
- ❌ Mancante o stub

---

### 1.2 Backend - Analisi Dettagliata

#### ✅ **PUNTI DI FORZA**

**Domain Layer (Eccellente - 100% Coverage)**
```typescript
// Esempio: FIR Aggregate Root
apps/backend/src/domain/fir/aggregates/fir.aggregate.ts
- State machine completa: BOZZA → EMESSO → IN_TRANSITO → CONSEGNATO
- Business rules validate: tolleranza peso ±10%, firma sequenza
- Domain events: FIREmessoEvent, FIRPresaInCaricoEvent, FIRConsegnatoEvent
- 25+ test cases, 100% coverage
```

**Application Layer (CQRS Pattern)**
```typescript
apps/backend/src/application/fir/
├── commands/
│   ├── create-fir.command.ts
│   ├── emetti-fir.command.ts
│   ├── presa-in-carico-fir.command.ts
│   └── conferma-consegna-fir.command.ts
├── queries/
│   ├── get-fir-by-id.handler.ts    ✅ Implementato
│   └── list-firs.handler.ts         ✅ Implementato
└── use-cases/
    ├── create-fir.use-case.ts       ✅ TDD 100%
    ├── emetti-fir.use-case.ts       ✅ TDD 100%
    ├── presa-in-carico-fir.use-case.ts  ✅ TDD 100%
    └── conferma-consegna-fir.use-case.ts ✅ TDD 100%
```

**Database Schema (Production-Ready)**
```prisma
// apps/backend/prisma/schema.prisma
- Multi-tenancy completo: Tenant, User, UserTenant junction
- FIR domain: FIR, FIRSignature con RENTRI sync status
- Registry: Produttore, Trasportatore, Destinatario
- Compliance: MUDReport, Notification, ActivityLog
- Backup: BackupSchedule, BackupHistory
- CER Catalog: CERCode con full-text search preparato
- Indexes ottimizzati: tenant_id, status, date ranges
```

#### ❌ **GAP CRITICI**

**1. Prisma Repositories - MANCANTI**
```typescript
// ATTUALE: Interfacce definite, implementazione mancante
apps/backend/src/domain/fir/repositories/fir-repository.interface.ts
apps/backend/src/domain/cer/repositories/cer-repository.interface.ts

// RICHIESTO: Implementazioni concrete
apps/backend/src/infrastructure/persistence/repositories/
├── fir-prisma.repository.ts           ❌ DA IMPLEMENTARE
├── cer-prisma.repository.ts           ❌ DA IMPLEMENTARE
├── produttore-prisma.repository.ts    ❌ DA IMPLEMENTARE
├── trasportatore-prisma.repository.ts ❌ DA IMPLEMENTARE
└── destinatario-prisma.repository.ts  ❌ DA IMPLEMENTARE
```

**Effort:** 1 settimana (5 repositories + integration tests)

**2. SPID Authentication - STUB**
```typescript
// ATTUALE: Skeleton con TODO
apps/backend/src/auth/strategies/spid.strategy.ts
- passport-saml configurato ma entryPoint mock
- Validazione SAML response non implementata
- Mapping attributi SPID → User entity mancante

// RICHIESTO:
- Metadata XML Service Provider completo
- Certificati firma richieste SAML (generazione + storage)
- Integrazione SPID Hub demo environment
- Callback handler con create/update User
```

**Effort:** 2 settimane (setup SPID demo, testing, certificati)

**3. RENTRI Integration - MANCANTE**
```typescript
// ATTUALE: Modulo skeleton
apps/backend/src/application/rentri/

// RICHIESTO:
apps/backend/src/infrastructure/integrations/rentri/
├── rentri-api.client.ts               ❌ OAuth2 + REST client
├── rentri-sync.service.ts             ❌ Queue orchestration
├── rentri-webhook.handler.ts          ❌ Incoming notifications
└── rentri-mapper.service.ts           ❌ Domain ↔ RENTRI DTO mapping
```

**Effort:** 3 settimane (API client, retry logic, error handling, testing)

**4. Background Jobs (BullMQ) - PARZIALE**
```typescript
// ATTUALE: @nestjs/bullmq installato, non configurato
apps/backend/package.json: "@nestjs/bullmq": "^10.0.1"

// RICHIESTO:
apps/backend/src/infrastructure/queue/
├── queue.module.ts                    ❌ BullMQ config
├── processors/
│   ├── rentri-sync.processor.ts      ❌ RENTRI sync jobs
│   ├── email.processor.ts            ❌ Email notifications
│   ├── pdf-generation.processor.ts   ❌ PDF async generation
│   └── mud-report.processor.ts       ❌ MUD compilation
└── producers/
    └── job-producer.service.ts        ❌ Enqueue helper
```

**Effort:** 1.5 settimane (setup Redis queue, 4 processors, monitoring)

**5. API Versioning - MANCANTE**
```typescript
// ATTUALE: Single version /api/v1
apps/backend/src/main.ts: app.setGlobalPrefix('api/v1')

// RICHIESTO:
- Header-based versioning: X-API-Version: 1 | 2
- Decorator @Version('1') per endpoint
- Versioned DTOs: CreateFIRDtoV1, CreateFIRDtoV2
- Deprecation warnings in response headers
```

**Effort:** 1 settimana (setup versioning, refactor endpoints)

**6. Rate Limiting & Throttling - MANCANTE**
```typescript
// RICHIESTO:
apps/backend/src/core/guards/
├── rate-limit.guard.ts                ❌ Redis-based sliding window
└── throttle.guard.ts                  ❌ Per-user throttling

// Config:
- Public endpoints: 100 req/min per IP
- Authenticated: 500 req/min per user (PROFESSIONAL), 2000 (ENTERPRISE)
- RENTRI webhook: No limit (whitelist IP RENTRI)
```

**Effort:** 3 giorni (guard implementation, Redis storage, testing)

**7. Comprehensive Logging - PARZIALE**
```typescript
// ATTUALE: Pino logger basic
apps/backend/src/core/logger/logger.module.ts

// RICHIESTO:
- Structured JSON logs: timestamp, level, context, correlationId, tenantId
- Log levels per environment: DEBUG (dev), INFO (staging), WARN (prod)
- Sensitive data masking: password, email, partitaIVA (GDPR)
- Integration CloudWatch/Datadog
```

**Effort:** 4 giorni (log interceptor, masking, transport config)

**8. Health Checks & Metrics - PARZIALE**
```typescript
// ATTUALE: Health controller basic
apps/backend/src/api/health/health.controller.ts: GET /health

// RICHIESTO:
GET /health/live      - Kubernetes liveness probe
GET /health/ready     - Readiness (DB, Redis, RENTRI reachable)
GET /metrics          - Prometheus format (prom-client already installed)
  - http_request_duration_seconds (histogram)
  - fir_created_total (counter)
  - rentri_sync_errors_total (counter)
  - db_connection_pool_size (gauge)
```

**Effort:** 3 giorni (health indicators, metrics collectors)

---

### 1.3 Frontend - Analisi Dettagliata

#### ⚠️ **PUNTI DI FORZA PARZIALI**

**Setup Base Angular 17**
```typescript
// apps/frontend/package.json
{
  "@angular/core": "^17.0.0",
  "primeng": "^17.0.0",        ✅ UI library
  "chart.js": "^4.4.0",        ✅ Charts
  "xlsx": "^0.18.5"            ✅ Export Excel
}

// apps/frontend/src/app/app.config.ts
- Standalone components approach ✅
- provideRouter, provideAnimations ✅
```

**Components Esistenti (Parziali)**
```typescript
apps/frontend/src/app/features/
├── fir/
│   ├── fir-list.component.ts              ⚠️  Basic table, no pagination
│   ├── fir-list-enhanced.component.ts     ⚠️  Advanced filters sketch
│   ├── signature-dialog.component.ts      ⚠️  Firma stub
│   └── rentri-sync-badge.component.ts     ⚠️  Status indicator
├── registry/
│   ├── produttori-list.component.ts       ⚠️  CRUD parziale
│   ├── trasportatori-list.component.ts    ⚠️  CRUD parziale
│   └── destinatari-list.component.ts      ⚠️  CRUD parziale
├── dashboard/
│   └── dashboard.component.ts             ⚠️  Empty component
└── cer/
    └── cer-search.component.ts            ⚠️  Search sketch
```

#### ❌ **GAP CRITICI FRONTEND**

**1. State Management - ASSENTE**
```typescript
// RICHIESTO: NgRx o Akita per state globale
apps/frontend/src/app/store/
├── actions/
│   ├── fir.actions.ts                     ❌ Create, Update, Delete, Load
│   └── auth.actions.ts                    ❌ Login, Logout, RefreshToken
├── reducers/
│   ├── fir.reducer.ts                     ❌ FIR state slice
│   ├── auth.reducer.ts                    ❌ Auth state slice
│   └── index.ts                           ❌ Root reducer
├── effects/
│   ├── fir.effects.ts                     ❌ API calls side effects
│   └── rentri-sync.effects.ts             ❌ Real-time sync
└── selectors/
    └── fir.selectors.ts                   ❌ Memoized queries
```

**Effort:** 2 settimane (NgRx setup, store slices, effects, selectors)

**2. Form Management - PARZIALE**
```typescript
// RICHIESTO: Reactive Forms complessi con validazione
apps/frontend/src/app/features/fir/
├── fir-create-wizard/
│   ├── step1-produttore.component.ts      ❌ Wizard multi-step
│   ├── step2-rifiuto.component.ts         ❌ CER autocomplete
│   ├── step3-trasporto.component.ts       ❌ Trasportatore selector
│   ├── step4-destinatario.component.ts    ❌ Validazione autorizzazioni
│   └── step5-review.component.ts          ❌ Summary + submit
└── validators/
    ├── partita-iva.validator.ts           ❌ Custom validator
    ├── cer-code.validator.ts              ❌ Format validation
    └── quantita.validator.ts              ❌ Range + unit validation
```

**Effort:** 2 settimane (wizard components, validators, UX flow)

**3. Real-time Map Integration - MANCANTE**
```typescript
// RICHIESTO: Leaflet o Mapbox per tracking trasporti
apps/frontend/src/app/features/maps/
├── transport-map.component.ts             ❌ Mappa real-time
├── route-optimization.component.ts        ❌ Visualizzazione percorsi
└── services/
    └── geolocation.service.ts             ❌ GPS tracking
```

**Librerie:**
```json
{
  "leaflet": "^1.9.4",
  "@asymmetrik/ngx-leaflet": "^17.0.0",
  "leaflet-routing-machine": "^3.2.12"
}
```

**Effort:** 1.5 settimane (map integration, markers, routes)

**4. Progressive Web App (PWA) - MANCANTE**
```typescript
// RICHIESTO: Service Workers + Offline support
apps/frontend/
├── ngsw-config.json                       ❌ Service worker config
├── src/
│   ├── manifest.webmanifest               ❌ PWA manifest
│   └── app/
│       └── core/services/
│           ├── offline.service.ts         ❌ Network detection
│           └── indexeddb.service.ts       ❌ Local storage
```

**Features:**
- Offline FIR creation (sync quando online)
- Cache API responses
- Background sync
- Push notifications

**Effort:** 2 settimane (service worker, offline storage, sync)

**5. Internationalization (i18n) - MANCANTE**
```typescript
// RICHIESTO: @angular/localize
apps/frontend/src/assets/i18n/
├── it.json                                ❌ Italiano (default)
├── en.json                                ❌ Inglese
└── de.json                                ❌ Tedesco (per espansione)

// Implementazione:
- Pipe translate in templates
- Date/currency format locale-aware
- Dynamic language switching
```

**Effort:** 1 settimana (setup i18n, traduzioni, testing)

**6. Performance Optimization - MANCANTE**
```typescript
// RICHIESTO: OnPush strategy, trackBy, lazy loading
apps/frontend/src/app/features/fir/fir-list.component.ts

// ATTUALE:
@Component({
  changeDetection: ChangeDetectionStrategy.Default  ❌
})

// RICHIESTO:
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush   ✅
})

trackByFirId(index: number, item: FIR): string {
  return item.id
}
```

**Lazy Loading Routes:**
```typescript
// RICHIESTO:
const routes: Routes = [
  {
    path: 'fir',
    loadChildren: () => import('./features/fir/fir.module').then(m => m.FirModule)
  },
  // ...
]
```

**Effort:** 1 settimana (refactor components OnPush, lazy routes, bundle analysis)

**7. Chart/Analytics Library - PARZIALE**
```typescript
// ATTUALE: Chart.js installato, non usato
apps/frontend/package.json: "chart.js": "^4.4.0"

// RICHIESTO:
apps/frontend/src/app/features/dashboard/
├── charts/
│   ├── fir-per-month.component.ts         ❌ Line chart
│   ├── waste-by-cer.component.ts          ❌ Pie chart
│   ├── rentri-sync-status.component.ts    ❌ Donut chart
│   └── transport-timeline.component.ts    ❌ Gantt chart
```

**Effort:** 1 settimana (chart components, data formatting)

---

### 1.4 Database - Analisi

#### ✅ **ECCELLENTE - Schema Completo**

**Schema Features:**
- ✅ Multi-tenancy: Row-Level Security prepared
- ✅ ACID transactions: PostgreSQL 16
- ✅ Indexes ottimizzati: tenant_id, status, dates
- ✅ Audit log: ActivityLog immutable
- ✅ Soft delete: User.deletedAt per GDPR
- ✅ JSON fields: FIR.attachmentUrls, User.notificationPreferences

#### ⚠️ **MISSING FEATURES**

**1. PostGIS Extension - Geospatial**
```sql
-- RICHIESTO: Per route optimization, trasportatori vicini
-- apps/backend/prisma/migrations/add_postgis.sql

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE trasportatori ADD COLUMN location GEOGRAPHY(POINT, 4326);
ALTER TABLE destinatari ADD COLUMN location GEOGRAPHY(POINT, 4326);

CREATE INDEX idx_trasportatori_location ON trasportatori USING GIST(location);
CREATE INDEX idx_destinatari_location ON destinatari USING GIST(location);

-- Query esempio:
-- SELECT * FROM trasportatori
-- WHERE ST_DWithin(location, ST_MakePoint(9.19, 45.46)::geography, 50000) -- 50km radius
-- ORDER BY ST_Distance(location, ST_MakePoint(9.19, 45.46)::geography)
-- LIMIT 10;
```

**Effort:** 2 giorni (migration, seed coordinates, testing)

**2. Full-Text Search CER Codes**
```sql
-- RICHIESTO: Per search veloce catalogo CER
-- apps/backend/prisma/migrations/add_cer_fulltext.sql

ALTER TABLE cer_codes ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('italian', coalesce(code, '') || ' ' || coalesce(description, ''))
  ) STORED;

CREATE INDEX idx_cer_search ON cer_codes USING GIN(search_vector);

-- Query esempio:
-- SELECT * FROM cer_codes
-- WHERE search_vector @@ to_tsquery('italian', 'plastica & imballaggio')
-- ORDER BY ts_rank(search_vector, to_tsquery('italian', 'plastica & imballaggio')) DESC
-- LIMIT 20;
```

**Effort:** 1 giorno (migration, index, API integration)

**3. Partitioning per Performance**
```sql
-- RICHIESTO: Quando >1M FIR, partizionare per anno
-- apps/backend/prisma/migrations/partition_fir_by_year.sql

CREATE TABLE firs_2025 PARTITION OF firs
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE fir_signatures_2025 PARTITION OF fir_signatures
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- Maintenance job: creare partizioni anno futuro ogni Dicembre
```

**Effort:** 1 settimana (quando necessario, >1M records)

**4. Database Seeding - PARZIALE**
```typescript
// ATTUALE: Seed script parziale
apps/backend/prisma/seed.ts

// RICHIESTO:
- ✅ CER codes import (842 codici ISPRA)
- ❌ Test tenants (3-5 aziende demo)
- ❌ Test users (ADMIN, OPERATOR, VIEWER per ogni tenant)
- ❌ Sample FIRs (50 FIR con diversi stati)
- ❌ Sample registry movements
```

**Effort:** 2 giorni (seed completo, faker data)

---

## 2. GAP ANALYSIS - FEATURE PRIORITIZATION

### 2.1 Backend Features - Priority Matrix

| Feature | Priority | Effort | Impact | Status |
|---------|----------|--------|--------|--------|
| **Prisma Repositories** | P0 (Blocker) | 1w | HIGH | ❌ Mancante |
| **SPID Authentication** | P0 (Blocker) | 2w | HIGH | ⚠️  Stub |
| **RENTRI Integration** | P0 (MVP) | 3w | HIGH | ❌ Mancante |
| **Background Jobs (BullMQ)** | P1 (MVP) | 1.5w | MEDIUM | ⚠️  Config mancante |
| **Rate Limiting** | P1 (MVP) | 3d | MEDIUM | ❌ Mancante |
| **Comprehensive Logging** | P1 (MVP) | 4d | MEDIUM | ⚠️  Parziale |
| **Health Checks & Metrics** | P1 (MVP) | 3d | MEDIUM | ⚠️  Parziale |
| **API Versioning** | P2 (Post-MVP) | 1w | LOW | ❌ Mancante |
| **WebSocket/SSE** | P2 (Post-MVP) | 2w | MEDIUM | ❌ Mancante |
| **IoT Data Pipeline** | P3 (Advanced) | 3w | LOW | ❌ Mancante |
| **Route Optimization** | P3 (Advanced) | 2w | LOW | ❌ Mancante |

**Legend:**
- **P0**: Blocker per MVP, deve essere fatto
- **P1**: Importante per MVP, può essere semplificato
- **P2**: Post-MVP, entro 6 mesi
- **P3**: Advanced features, 12+ mesi

---

### 2.2 Frontend Features - Priority Matrix

| Feature | Priority | Effort | Impact | Status |
|---------|----------|--------|--------|--------|
| **State Management (NgRx)** | P0 (Blocker) | 2w | HIGH | ❌ Mancante |
| **Form Management (Wizard)** | P0 (Blocker) | 2w | HIGH | ⚠️  Parziale |
| **FIR CRUD Completo** | P0 (MVP) | 1.5w | HIGH | ⚠️  Parziale |
| **Registry CRUD Completo** | P1 (MVP) | 1w | MEDIUM | ⚠️  Parziale |
| **Dashboard Charts** | P1 (MVP) | 1w | MEDIUM | ❌ Mancante |
| **PWA Offline** | P2 (Post-MVP) | 2w | HIGH | ❌ Mancante |
| **Real-time Maps** | P2 (Post-MVP) | 1.5w | MEDIUM | ❌ Mancante |
| **i18n** | P2 (Post-MVP) | 1w | LOW | ❌ Mancante |
| **Performance OnPush** | P1 (MVP) | 1w | MEDIUM | ❌ Mancante |
| **Lazy Loading** | P1 (MVP) | 3d | MEDIUM | ⚠️  Parziale |

---

### 2.3 Database Features - Priority Matrix

| Feature | Priority | Effort | Impact | Status |
|---------|----------|--------|--------|--------|
| **Database Seeding** | P0 (Blocker) | 2d | HIGH | ⚠️  Parziale |
| **Full-Text Search CER** | P1 (MVP) | 1d | MEDIUM | ❌ Mancante |
| **PostGIS Extension** | P2 (Post-MVP) | 2d | LOW | ❌ Mancante |
| **Partitioning** | P3 (Scale) | 1w | LOW | ❌ Futuro |

---

## 3. IMPLEMENTATION PLAN

### FASE 1: MVP FOUNDATION (Settimane 1-8)

#### Sprint 1-2: Backend Infrastructure (2 settimane)

**Obiettivo:** Completare layer persistence e authentication

**Tasks:**
1. **Prisma Repositories Implementation** (5 giorni)
   ```typescript
   // apps/backend/src/infrastructure/persistence/repositories/fir-prisma.repository.ts
   @Injectable()
   export class FIRPrismaRepository implements IFIRRepository {
     constructor(private prisma: PrismaService) {}

     async save(fir: FIR): Promise<void> {
       const data = this.toPrisma(fir)
       await this.prisma.fIR.upsert({
         where: { id: fir.id },
         create: data,
         update: data
       })
     }

     async findById(id: string): Promise<FIR | null> {
       const record = await this.prisma.fIR.findUnique({ where: { id } })
       return record ? this.toDomain(record) : null
     }

     private toPrisma(fir: FIR): Prisma.FIRCreateInput { /* mapper */ }
     private toDomain(record: PrismaFIR): FIR { /* mapper */ }
   }
   ```

2. **SPID Authentication Complete** (5 giorni)
   - Setup SPID Hub demo environment
   - Generate certificati X.509 (openssl)
   - Implement SPIDStrategy validate()
   - Create User on first login
   - Integration tests

3. **Database Seeding** (2 giorni)
   - CER codes import (842 records)
   - 5 test tenants
   - 15 test users (3 per tenant)
   - 50 sample FIRs
   - 100 registry movements

**Deliverable:** Backend può creare FIR con persistenza + SPID login funzionante

---

#### Sprint 3-4: RENTRI Integration & Background Jobs (2 settimane)

**Obiettivo:** Integrazione RENTRI + queue asincrona

**Tasks:**
1. **RENTRI API Client** (4 giorni)
   ```typescript
   // apps/backend/src/infrastructure/integrations/rentri/rentri-api.client.ts
   @Injectable()
   export class RENTRIApiClient {
     private accessToken: string

     async authenticate(): Promise<void> {
       const response = await this.httpService.post('/oauth/token', {
         grant_type: 'client_credentials',
         client_id: this.config.RENTRI_CLIENT_ID,
         client_secret: this.config.RENTRI_CLIENT_SECRET
       })
       this.accessToken = response.data.access_token
     }

     async creaFIR(fir: FIRPayload): Promise<RENTRIResponse> {
       return this.httpService.post('/api/fir', fir, {
         headers: { Authorization: `Bearer ${this.accessToken}` }
       })
     }

     async verificaStatoFIR(numeroFIR: string): Promise<FIRStato> { /* ... */ }
   }
   ```

2. **BullMQ Queue Setup** (3 giorni)
   ```typescript
   // apps/backend/src/infrastructure/queue/queue.module.ts
   @Module({
     imports: [
       BullModule.forRoot({
         connection: {
           host: process.env.REDIS_HOST,
           port: parseInt(process.env.REDIS_PORT)
         }
       }),
       BullModule.registerQueue(
         { name: 'rentri-sync' },
         { name: 'email' },
         { name: 'pdf-generation' },
         { name: 'mud-report' }
       )
     ]
   })
   ```

3. **RENTRI Sync Processor** (3 giorni)
   ```typescript
   // apps/backend/src/infrastructure/queue/processors/rentri-sync.processor.ts
   @Processor('rentri-sync')
   export class RENTRISyncProcessor {
     @Process('sync-fir')
     async syncFIR(job: Job<{ firId: string }>) {
       const fir = await this.firRepository.findById(job.data.firId)

       try {
         await this.rentriClient.creaFIR(fir)
         fir.markAsSynced()
       } catch (error) {
         if (error.isRecoverable) {
           throw error // BullMQ retry automatico
         } else {
           fir.markAsPermanentlyFailed(error.message)
         }
       }

       await this.firRepository.save(fir)
     }
   }
   ```

**Deliverable:** FIR emessi vengono sincronizzati automaticamente a RENTRI (demo)

---

#### Sprint 5-6: Frontend Foundation (2 settimane)

**Obiettivo:** NgRx state + Form wizard + CRUD completo

**Tasks:**
1. **NgRx Store Setup** (3 giorni)
   ```typescript
   // apps/frontend/src/app/store/actions/fir.actions.ts
   export const loadFIRs = createAction('[FIR List] Load FIRs')
   export const loadFIRsSuccess = createAction(
     '[FIR API] Load FIRs Success',
     props<{ firs: FIR[] }>()
   )
   export const createFIR = createAction(
     '[FIR Create] Create FIR',
     props<{ fir: CreateFIRDto }>()
   )

   // apps/frontend/src/app/store/reducers/fir.reducer.ts
   export interface FIRState {
     firs: FIR[]
     selectedFIR: FIR | null
     loading: boolean
     error: string | null
   }

   export const firReducer = createReducer(
     initialState,
     on(loadFIRs, state => ({ ...state, loading: true })),
     on(loadFIRsSuccess, (state, { firs }) => ({
       ...state,
       firs,
       loading: false
     }))
   )

   // apps/frontend/src/app/store/effects/fir.effects.ts
   @Injectable()
   export class FIREffects {
     loadFIRs$ = createEffect(() =>
       this.actions$.pipe(
         ofType(loadFIRs),
         switchMap(() =>
           this.firService.getFIRs().pipe(
             map(firs => loadFIRsSuccess({ firs })),
             catchError(error => of(loadFIRsFailure({ error })))
           )
         )
       )
     )
   }
   ```

2. **FIR Wizard Multi-Step** (4 giorni)
   ```typescript
   // apps/frontend/src/app/features/fir/fir-create-wizard/fir-wizard.component.ts
   @Component({
     selector: 'app-fir-wizard',
     template: `
       <p-steps [model]="steps" [(activeIndex)]="activeIndex"></p-steps>

       <div [ngSwitch]="activeIndex">
         <app-step1-produttore *ngSwitchCase="0" [form]="form"></app-step1-produttore>
         <app-step2-rifiuto *ngSwitchCase="1" [form]="form"></app-step2-rifiuto>
         <app-step3-trasporto *ngSwitchCase="2" [form]="form"></app-step3-trasporto>
         <app-step4-destinatario *ngSwitchCase="3" [form]="form"></app-step4-destinatario>
         <app-step5-review *ngSwitchCase="4" [form]="form"></app-step5-review>
       </div>

       <div class="wizard-actions">
         <button pButton (click)="prevStep()" [disabled]="activeIndex === 0">Indietro</button>
         <button pButton (click)="nextStep()" *ngIf="activeIndex < 4">Avanti</button>
         <button pButton (click)="submit()" *ngIf="activeIndex === 4" [disabled]="form.invalid">Crea FIR</button>
       </div>
     `
   })
   export class FIRWizardComponent {
     steps = [
       { label: 'Produttore' },
       { label: 'Rifiuto' },
       { label: 'Trasporto' },
       { label: 'Destinatario' },
       { label: 'Riepilogo' }
     ]
     activeIndex = 0
     form = this.fb.group({
       produttore: this.fb.group({
         partitaIVA: ['', [Validators.required, partitaIVAValidator]],
         ragioneSociale: ['', Validators.required]
       }),
       rifiuto: this.fb.group({
         cerCode: ['', [Validators.required, cerCodeValidator]],
         quantita: [null, [Validators.required, Validators.min(0)]],
         unitaMisura: ['KG', Validators.required]
       }),
       // ...
     })
   }
   ```

3. **FIR List Enhanced** (2 giorni)
   ```html
   <!-- apps/frontend/src/app/features/fir/fir-list-enhanced.component.html -->
   <p-table
     [value]="firs$ | async"
     [lazy]="true"
     [paginator]="true"
     [rows]="20"
     [totalRecords]="totalRecords$ | async"
     (onLazyLoad)="loadFIRsLazy($event)"
     [loading]="loading$ | async"
     dataKey="id"
   >
     <ng-template pTemplate="header">
       <tr>
         <th pSortableColumn="firNumber">Numero FIR</th>
         <th pSortableColumn="status">Stato</th>
         <th pSortableColumn="transportDate">Data Trasporto</th>
         <th>Azioni</th>
       </tr>
       <tr>
         <th><input pInputText type="text" (input)="filterFIRNumber($event)"></th>
         <th><p-dropdown [options]="statuses" (onChange)="filterStatus($event)"></p-dropdown></th>
         <th><p-calendar (onSelect)="filterDate($event)"></p-calendar></th>
         <th></th>
       </tr>
     </ng-template>

     <ng-template pTemplate="body" let-fir>
       <tr>
         <td>{{ fir.firNumber }}</td>
         <td><app-status-badge [status]="fir.status"></app-status-badge></td>
         <td>{{ fir.transportDate | date:'dd/MM/yyyy' }}</td>
         <td>
           <button pButton icon="pi pi-eye" (click)="viewFIR(fir)"></button>
           <button pButton icon="pi pi-pencil" (click)="editFIR(fir)" [disabled]="!canEdit(fir)"></button>
           <button pButton icon="pi pi-file-pdf" (click)="downloadPDF(fir)"></button>
         </td>
       </tr>
     </ng-template>
   </p-table>
   ```

**Deliverable:** Frontend può creare FIR wizard, visualizzare lista con filters

---

#### Sprint 7-8: API Completo & Dashboard (2 settimane)

**Obiettivo:** REST API completo + Dashboard analytics

**Tasks:**
1. **API Endpoints Completi** (4 giorni)
   ```typescript
   // apps/backend/src/api/fir/fir.controller.ts
   @Controller('fir')
   @UseGuards(JwtAuthGuard, PermissionsGuard)
   export class FIRController {
     @Get()
     @Permissions('fir:read')
     async list(@Query() dto: ListFIRsDto, @Req() req): Promise<PaginatedFIRResponse> {
       const { tenantId } = req.user
       return this.listFIRsHandler.execute(
         new ListFIRsQuery(tenantId, dto.page, dto.limit, dto.filters)
       )
     }

     @Get(':id')
     @Permissions('fir:read')
     async findOne(@Param('id') id: string): Promise<FIRResponseDto> {
       const fir = await this.getFIRHandler.execute(new GetFIRByIdQuery(id))
       if (!fir) throw new NotFoundException()
       return this.mapper.toDto(fir)
     }

     @Patch(':id')
     @Permissions('fir:update')
     async update(
       @Param('id') id: string,
       @Body() dto: UpdateFIRDto
     ): Promise<FIRResponseDto> {
       const fir = await this.updateFIRHandler.execute(
         new UpdateFIRCommand(id, dto)
       )
       return this.mapper.toDto(fir)
     }

     @Post(':id/emetti')
     @Permissions('fir:update')
     async emetti(@Param('id') id: string): Promise<FIRResponseDto> {
       const fir = await this.emettiFIRHandler.execute(new EmettiFIRCommand(id))
       return this.mapper.toDto(fir)
     }

     @Post(':id/presa-in-carico')
     @Permissions('fir:update')
     async presaInCarico(
       @Param('id') id: string,
       @Body() dto: PresaInCaricoDto
     ): Promise<FIRResponseDto> { /* ... */ }

     @Post(':id/conferma-consegna')
     @Permissions('fir:update')
     async confermaConsegna(
       @Param('id') id: string,
       @Body() dto: ConfermaConsegnaDto
     ): Promise<FIRResponseDto> { /* ... */ }
   }
   ```

2. **Dashboard Analytics** (3 giorni)
   ```typescript
   // apps/frontend/src/app/features/dashboard/dashboard.component.ts
   export class DashboardComponent implements OnInit {
     // KPIs
     totalFIRs$: Observable<number>
     firsPendingSignature$: Observable<number>
     rentriSyncPending$: Observable<number>

     // Charts data
     firsPerMonthData$: Observable<ChartData>
     wasteByCategor yData$: Observable<ChartData>
     rentriSyncStatusData$: Observable<ChartData>

     ngOnInit() {
       this.loadKPIs()
       this.loadCharts()
     }

     private loadCharts() {
       this.firsPerMonthData$ = this.analyticsService.getFIRsPerMonth().pipe(
         map(data => ({
           labels: data.map(d => d.month),
           datasets: [{
             label: 'FIR Creati',
             data: data.map(d => d.count),
             borderColor: '#4CAF50',
             backgroundColor: 'rgba(76, 175, 80, 0.2)'
           }]
         }))
       )
     }
   }
   ```

3. **Rate Limiting & Health Checks** (3 giorni)
   ```typescript
   // apps/backend/src/core/guards/rate-limit.guard.ts
   @Injectable()
   export class RateLimitGuard implements CanActivate {
     constructor(private redis: RedisService) {}

     async canActivate(context: ExecutionContext): Promise<boolean> {
       const request = context.switchToHttp().getRequest()
       const key = `rate-limit:${request.ip}:${request.path}`

       const count = await this.redis.incr(key)
       if (count === 1) {
         await this.redis.expire(key, 60) // 1 minuto window
       }

       if (count > 100) { // 100 req/min
         throw new ThrottlerException('Too many requests')
       }

       return true
     }
   }

   // apps/backend/src/api/health/health.controller.ts
   @Controller('health')
   export class HealthController {
     @Get('live')
     live(): { status: string } {
       return { status: 'UP' }
     }

     @Get('ready')
     async ready(): Promise<{ status: string; checks: any }> {
       const dbCheck = await this.checkDatabase()
       const redisCheck = await this.checkRedis()
       const rentriCheck = await this.checkRENTRI()

       return {
         status: dbCheck && redisCheck ? 'UP' : 'DOWN',
         checks: { database: dbCheck, redis: redisCheck, rentri: rentriCheck }
       }
     }

     @Get('metrics')
     async metrics(): Promise<string> {
       return this.prometheusService.getMetrics()
     }
   }
   ```

**Deliverable:** MVP completo: FIR workflow + Dashboard + API production-ready

---

### FASE 2: ADVANCED FEATURES (Settimane 9-16)

#### Sprint 9-10: Real-Time & WebSockets (2 settimane)

**Obiettivo:** Real-time updates per tracking FIR

**Tasks:**
1. **WebSocket Gateway** (3 giorni)
   ```typescript
   // apps/backend/src/infrastructure/websocket/fir.gateway.ts
   @WebSocketGateway({
     namespace: '/fir',
     cors: { origin: process.env.FRONTEND_URL }
   })
   export class FIRGateway {
     @WebSocketServer()
     server: Server

     @SubscribeMessage('subscribe-fir')
     handleSubscribe(client: Socket, firId: string) {
       client.join(`fir:${firId}`)
     }

     emitFIRStatusChange(firId: string, status: FIRStatus) {
       this.server.to(`fir:${firId}`).emit('status-changed', { firId, status })
     }
   }

   // Integration in Use Case
   export class EmettiFIRUseCase {
     async execute(command: EmettiFIRCommand): Promise<FIR> {
       const fir = await this.firRepository.findById(command.firId)
       fir.emetti()
       await this.firRepository.save(fir)

       // Emit real-time event
       this.firGateway.emitFIRStatusChange(fir.id, fir.status)

       return fir
     }
   }
   ```

2. **Frontend WebSocket Service** (2 giorni)
   ```typescript
   // apps/frontend/src/app/core/services/websocket.service.ts
   @Injectable({ providedIn: 'root' })
   export class WebSocketService {
     private socket: Socket

     connect() {
       this.socket = io('ws://localhost:3000/fir', {
         auth: { token: this.authService.getAccessToken() }
       })
     }

     subscribeFIR(firId: string): Observable<FIRStatusUpdate> {
       this.socket.emit('subscribe-fir', firId)

       return fromEvent(this.socket, 'status-changed').pipe(
         filter((event: any) => event.firId === firId),
         map(event => event as FIRStatusUpdate)
       )
     }
   }

   // Usage in component
   export class FIRDetailComponent {
     ngOnInit() {
       this.wsService.subscribeFIR(this.firId).subscribe(update => {
         this.store.dispatch(updateFIRStatus({ firId: update.firId, status: update.status }))
         this.toastService.success(`FIR ${update.firId} stato aggiornato: ${update.status}`)
       })
     }
   }
   ```

3. **Server-Sent Events Alternative** (2 giorni)
   ```typescript
   // apps/backend/src/api/fir/fir.controller.ts
   @Sse('fir/:id/events')
   firEvents(@Param('id') firId: string): Observable<MessageEvent> {
     return this.firEventsService.subscribeToFIR(firId).pipe(
       map(event => ({
         data: event,
         type: event.type
       }))
     )
   }

   // Frontend EventSource
   const eventSource = new EventSource(`/api/v1/fir/${firId}/events`)
   eventSource.onmessage = (event) => {
     const update = JSON.parse(event.data)
     this.store.dispatch(updateFIRStatus(update))
   }
   ```

**Deliverable:** Tracking real-time stato FIR senza refresh pagina

---

#### Sprint 11-12: PWA Offline & Maps (2 settimane)

**Obiettivo:** Progressive Web App + Mappe trasporti

**Tasks:**
1. **PWA Service Worker** (4 giorni)
   ```typescript
   // apps/frontend/ngsw-config.json
   {
     "index": "/index.html",
     "assetGroups": [
       {
         "name": "app",
         "installMode": "prefetch",
         "resources": {
           "files": ["/favicon.ico", "/index.html", "/*.css", "/*.js"]
         }
       },
       {
         "name": "assets",
         "installMode": "lazy",
         "resources": {
           "files": ["/assets/**", "/*.(eot|svg|cur|jpg|png|webp|gif|otf|ttf|woff|woff2)"]
         }
       }
     ],
     "dataGroups": [
       {
         "name": "api-performance",
         "urls": ["/api/v1/cer/**"],
         "cacheConfig": {
           "maxSize": 100,
           "maxAge": "7d",
           "strategy": "performance"
         }
       },
       {
         "name": "api-freshness",
         "urls": ["/api/v1/fir/**"],
         "cacheConfig": {
           "maxSize": 100,
           "maxAge": "1h",
           "strategy": "freshness"
         }
       }
     ]
   }

   // apps/frontend/src/app/core/services/offline.service.ts
   @Injectable({ providedIn: 'root' })
   export class OfflineService {
     isOnline$ = fromEvent(window, 'online').pipe(
       map(() => true),
       startWith(navigator.onLine)
     )

     isOffline$ = fromEvent(window, 'offline').pipe(
       map(() => false),
       startWith(!navigator.onLine)
     )

     // Offline queue
     async queueOperation(operation: OfflineOperation) {
       const db = await this.indexedDBService.getDB()
       await db.operations.add(operation)
     }

     async syncPendingOperations() {
       if (!navigator.onLine) return

       const db = await this.indexedDBService.getDB()
       const pending = await db.operations.where('status').equals('PENDING').toArray()

       for (const op of pending) {
         try {
           await this.executeOperation(op)
           await db.operations.update(op.id, { status: 'SYNCED' })
         } catch (error) {
           await db.operations.update(op.id, { status: 'ERROR', error: error.message })
         }
       }
     }
   }
   ```

2. **Maps Integration (Leaflet)** (3 giorni)
   ```typescript
   // apps/frontend/src/app/features/maps/transport-map.component.ts
   @Component({
     selector: 'app-transport-map',
     template: `
       <div leaflet
            [leafletOptions]="options"
            [leafletLayers]="markers"
            (leafletMapReady)="onMapReady($event)">
       </div>
     `
   })
   export class TransportMapComponent {
     options: L.MapOptions = {
       layers: [
         L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
           attribution: '© OpenStreetMap contributors'
         })
       ],
       zoom: 8,
       center: L.latLng(45.4642, 9.1900) // Milano
     }

     markers: L.Marker[] = []

     ngOnInit() {
       this.transportService.getActiveFIRs().subscribe(firs => {
         this.markers = firs.map(fir => {
           const marker = L.marker([fir.currentLat, fir.currentLng])
           marker.bindPopup(`
             <b>FIR ${fir.firNumber}</b><br>
             Trasportatore: ${fir.carrierName}<br>
             Stato: ${fir.status}
           `)
           return marker
         })
       })
     }

     onMapReady(map: L.Map) {
       // Add route polyline
       const route = L.polyline([
         [produttore.lat, produttore.lng],
         [destinatario.lat, destinatario.lng]
       ], { color: 'blue' }).addTo(map)

       map.fitBounds(route.getBounds())
     }
   }
   ```

**Deliverable:** PWA installabile + Mappa tracking trasporti

---

#### Sprint 13-14: IoT Data Pipeline (2 settimane)

**Obiettivo:** Integrazione bilance/sensori per peso automatico

**Tasks:**
1. **MQTT Broker Setup** (2 giorni)
   ```typescript
   // apps/backend/src/infrastructure/iot/mqtt.module.ts
   @Module({
     imports: [
       MqttModule.forRoot({
         host: process.env.MQTT_BROKER_HOST,
         port: parseInt(process.env.MQTT_BROKER_PORT),
         clientId: 'wasteflow-backend',
         username: process.env.MQTT_USERNAME,
         password: process.env.MQTT_PASSWORD
       })
     ],
     providers: [IoTDataProcessor]
   })
   export class IoTModule {}
   ```

2. **IoT Data Processor** (3 giorni)
   ```typescript
   // apps/backend/src/infrastructure/iot/iot-data.processor.ts
   @Injectable()
   export class IoTDataProcessor {
     constructor(private mqttService: MqttService) {}

     @Subscribe('scale/+/weight') // Wildcard subscription
     async handleWeightData(topic: string, payload: Buffer) {
       const data = JSON.parse(payload.toString())
       const scaleId = topic.split('/')[1]

       // Validate data
       if (!this.isValidWeight(data)) {
         this.logger.warn(`Invalid weight data from scale ${scaleId}`)
         return
       }

       // Store in time-series database
       await this.influxDB.write({
         measurement: 'weight_reading',
         tags: { scaleId, location: data.location },
         fields: {
           weight: data.weight,
           unit: data.unit,
           temperature: data.temperature,
           humidity: data.humidity
         },
         timestamp: new Date()
       })

       // Check if weight matches pending FIR
       const pendingFIR = await this.findPendingFIRForScale(scaleId)
       if (pendingFIR && Math.abs(pendingFIR.expectedWeight - data.weight) < 5) {
         // Auto-update FIR weight
         await this.updateFIRWeight(pendingFIR.id, data.weight)

         // Emit event
         this.eventEmitter.emit('fir.weight-auto-updated', {
           firId: pendingFIR.id,
           weight: data.weight,
           scaleId
         })
       }
     }

     private isValidWeight(data: any): boolean {
       return (
         typeof data.weight === 'number' &&
         data.weight > 0 &&
         data.weight < 100000 && // Max 100 ton
         ['KG', 'LB', 'TON'].includes(data.unit)
       )
     }
   }
   ```

3. **Time-Series Data Storage** (2 giorni)
   ```typescript
   // InfluxDB for IoT metrics
   docker-compose.yml:
   services:
     influxdb:
       image: influxdb:2.7
       ports:
         - "8086:8086"
       volumes:
         - influxdb-data:/var/lib/influxdb2
       environment:
         - INFLUXDB_DB=wasteflow_iot
         - INFLUXDB_ADMIN_USER=admin
         - INFLUXDB_ADMIN_PASSWORD=${INFLUXDB_PASSWORD}

   // Query service
   @Injectable()
   export class IoTMetricsService {
     async getWeightHistory(scaleId: string, hours: number = 24): Promise<WeightReading[]> {
       const query = `
         from(bucket: "wasteflow_iot")
           |> range(start: -${hours}h)
           |> filter(fn: (r) => r._measurement == "weight_reading")
           |> filter(fn: (r) => r.scaleId == "${scaleId}")
           |> sort(columns: ["_time"], desc: false)
       `
       const result = await this.influxDB.query(query)
       return result.map(row => ({
         timestamp: row._time,
         weight: row.weight,
         temperature: row.temperature
       }))
     }
   }
   ```

**Deliverable:** Peso FIR aggiornato automaticamente da bilance IoT

---

#### Sprint 15-16: Route Optimization & Geospatial (2 settimane)

**Obiettivo:** Algoritmo ottimizzazione percorsi trasportatori

**Tasks:**
1. **PostGIS Migration** (1 giorno)
   ```sql
   -- apps/backend/prisma/migrations/add_postgis_geospatial.sql
   CREATE EXTENSION IF NOT EXISTS postgis;

   ALTER TABLE produttori ADD COLUMN location GEOGRAPHY(POINT, 4326);
   ALTER TABLE trasportatori ADD COLUMN location GEOGRAPHY(POINT, 4326);
   ALTER TABLE destinatari ADD COLUMN location GEOGRAPHY(POINT, 4326);

   CREATE INDEX idx_produttori_location ON produttori USING GIST(location);
   CREATE INDEX idx_trasportatori_location ON trasportatori USING GIST(location);
   CREATE INDEX idx_destinatari_location ON destinatari USING GIST(location);

   -- Seed coordinates (example)
   UPDATE produttori SET location = ST_SetSRID(ST_MakePoint(9.1900, 45.4642), 4326)::geography
   WHERE id = '...';
   ```

2. **Route Optimization Service** (5 giorni)
   ```typescript
   // apps/backend/src/application/logistics/route-optimization.service.ts
   @Injectable()
   export class RouteOptimizationService {
     // Traveling Salesman Problem (TSP) solver
     async optimizeRoute(
       startLocation: Location,
       stops: Location[],
       endLocation: Location
     ): Promise<OptimizedRoute> {
       // Use Google OR-Tools or custom greedy algorithm
       const solver = new ORToolsTSPSolver()

       // Calculate distance matrix
       const distanceMatrix = await this.calculateDistanceMatrix([
         startLocation,
         ...stops,
         endLocation
       ])

       // Solve TSP
       const solution = solver.solve(distanceMatrix)

       // Build optimized route
       const optimizedStops = solution.visitOrder.map(index => stops[index])

       return {
         stops: optimizedStops,
         totalDistance: solution.totalDistance,
         estimatedDuration: solution.estimatedDuration,
         polyline: await this.getRoutePolyline([startLocation, ...optimizedStops, endLocation])
       }
     }

     private async calculateDistanceMatrix(locations: Location[]): Promise<number[][]> {
       // Use PostGIS ST_Distance or external API (Google Distance Matrix)
       const matrix: number[][] = []

       for (let i = 0; i < locations.length; i++) {
         matrix[i] = []
         for (let j = 0; j < locations.length; j++) {
           if (i === j) {
             matrix[i][j] = 0
           } else {
             // PostGIS distance in meters
             const distance = await this.prisma.$queryRaw`
               SELECT ST_Distance(
                 ST_SetSRID(ST_MakePoint(${locations[i].lng}, ${locations[i].lat}), 4326)::geography,
                 ST_SetSRID(ST_MakePoint(${locations[j].lng}, ${locations[j].lat}), 4326)::geography
               ) as distance
             `
             matrix[i][j] = distance[0].distance
           }
         }
       }

       return matrix
     }
   }
   ```

3. **Trasportatori Nearby Search** (2 giorni)
   ```typescript
   // apps/backend/src/application/logistics/trasportatori-search.service.ts
   @Injectable()
   export class TrasportatoriSearchService {
     async findNearbyTrasportatori(
       location: Location,
       radiusKm: number = 50,
       limit: number = 10
     ): Promise<Trasportatore[]> {
       return this.prisma.$queryRaw`
         SELECT
           t.*,
           ST_Distance(
             t.location,
             ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography
           ) / 1000 as distance_km
         FROM trasportatori t
         WHERE ST_DWithin(
           t.location,
           ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography,
           ${radiusKm * 1000} -- meters
         )
         ORDER BY distance_km ASC
         LIMIT ${limit}
       `
     }
   }
   ```

**Deliverable:** Suggerimento trasportatori vicini + Route optimization

---

### FASE 3: PERFORMANCE & POLISH (Settimane 17-20)

#### Sprint 17-18: Performance Optimization (2 settimane)

**Tasks:**
1. **Frontend OnPush & Lazy Loading** (3 giorni)
2. **Database Query Optimization** (3 giorni)
   - EXPLAIN ANALYZE slow queries
   - Add missing indexes
   - Optimize N+1 queries
3. **Redis Caching Strategy** (2 giorni)
   - Cache CER catalog (7 days TTL)
   - Cache user profiles (30 min TTL)
   - Cache dashboard KPIs (15 min TTL)
4. **Bundle Size Optimization** (2 giorni)
   - Tree shaking
   - Code splitting
   - Image optimization (WebP)

---

#### Sprint 19-20: Testing & Documentation (2 settimane)

**Tasks:**
1. **E2E Tests** (5 giorni)
   - FIR workflow completo
   - RENTRI sync simulation
   - Authentication flow
2. **API Documentation** (3 giorni)
   - Swagger annotations complete
   - Postman collection
   - API changelog
3. **Performance Testing** (2 giorni)
   - Load testing (Artillery, k6)
   - Stress testing
   - Bottleneck analysis

---

## 4. ARCHITECTURE RECOMMENDATIONS

### 4.1 Backend Architecture Improvements

**Clean Architecture Layers (Current):**
```
✅ Domain Layer (Entities, Value Objects, Aggregates, Events)
✅ Application Layer (Use Cases, Commands, Queries, Handlers)
⚠️  Infrastructure Layer (Repositories implementations needed)
✅ API Layer (Controllers, DTOs, Guards)
```

**Recommended Additions:**

**1. Anti-Corruption Layer (ACL) for RENTRI**
```typescript
// apps/backend/src/infrastructure/integrations/rentri/rentri-acl.service.ts
@Injectable()
export class RENTRIAntiCorruptionLayer {
  // Translate domain model → RENTRI API format
  toDomain(rentriResponse: RENTRIFIRResponse): FIR {
    // Isolate RENTRI model from domain
  }

  toRENTRI(fir: FIR): RENTRIFIRPayload {
    // Map domain aggregate to RENTRI format
  }
}
```

**2. Domain Events with Event Sourcing (Optional)**
```typescript
// apps/backend/src/core/domain/event-sourcing/event-store.ts
@Injectable()
export class EventStore {
  async append(aggregateId: string, events: DomainEvent[]): Promise<void> {
    // Store events in separate table for audit + replay
  }

  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    // Rebuild aggregate from events
  }
}
```

**3. CQRS Read Models (Materialized Views)**
```sql
-- apps/backend/prisma/migrations/create_read_models.sql
CREATE MATERIALIZED VIEW fir_dashboard_stats AS
SELECT
  tenant_id,
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as total_firs,
  COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_firs,
  SUM(quantity) FILTER (WHERE unit = 'KG') as total_kg
FROM firs
GROUP BY tenant_id, month;

CREATE UNIQUE INDEX idx_fir_stats_tenant_month ON fir_dashboard_stats(tenant_id, month);

-- Refresh job ogni ora
CREATE OR REPLACE FUNCTION refresh_dashboard_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY fir_dashboard_stats;
END;
$$ LANGUAGE plpgsql;
```

---

### 4.2 Frontend Architecture Improvements

**Recommended Structure:**
```
apps/frontend/src/app/
├── core/                      ✅ Singleton services
│   ├── auth/                  ⚠️  Auth service, guards
│   ├── http/                  ⚠️  Interceptors
│   └── state/                 ❌ NgRx store root
├── shared/                    ⚠️  Reusable components, pipes, directives
│   ├── components/
│   ├── directives/
│   ├── pipes/
│   └── models/
├── features/                  ⚠️  Feature modules (lazy loaded)
│   ├── fir/
│   │   ├── components/
│   │   ├── services/
│   │   └── fir-routing.module.ts
│   ├── registry/
│   └── dashboard/
└── layout/                    ⚠️  App shell
    ├── header/
    ├── sidebar/
    └── footer/
```

**Smart vs Dumb Components Pattern:**
```typescript
// Smart Component (Container)
@Component({
  selector: 'app-fir-list-container',
  template: `
    <app-fir-list-presentation
      [firs]="firs$ | async"
      [loading]="loading$ | async"
      (createFIR)="onCreateFIR()"
      (deleteFIR)="onDeleteFIR($event)"
    ></app-fir-list-presentation>
  `
})
export class FIRListContainerComponent {
  firs$ = this.store.select(selectAllFIRs)
  loading$ = this.store.select(selectFIRsLoading)

  onCreateFIR() {
    this.router.navigate(['/fir/create'])
  }

  onDeleteFIR(firId: string) {
    this.store.dispatch(deleteFIR({ firId }))
  }
}

// Dumb Component (Presentation)
@Component({
  selector: 'app-fir-list-presentation',
  template: `<p-table [value]="firs" [loading]="loading">...</p-table>`,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FIRListPresentationComponent {
  @Input() firs: FIR[]
  @Input() loading: boolean
  @Output() createFIR = new EventEmitter()
  @Output() deleteFIR = new EventEmitter<string>()
}
```

---

### 4.3 Security Best Practices

**1. Content Security Policy (CSP)**
```typescript
// apps/backend/src/main.ts
import helmet from 'helmet'

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.wasteflow.it"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}))
```

**2. SQL Injection Prevention**
```typescript
// ✅ GOOD: Prisma parameterized queries
await prisma.fir.findMany({
  where: { tenantId: req.user.tenantId }
})

// ❌ BAD: Raw query without sanitization
await prisma.$queryRawUnsafe(`
  SELECT * FROM firs WHERE tenant_id = '${req.user.tenantId}'
`)

// ✅ GOOD: Raw query with parameterization
await prisma.$queryRaw`
  SELECT * FROM firs WHERE tenant_id = ${req.user.tenantId}
`
```

**3. XSS Prevention**
```typescript
// Frontend: Angular automatic sanitization
<div [innerHTML]="userContent | sanitize"></div>

// Custom sanitizer pipe
@Pipe({ name: 'sanitize' })
export class SanitizePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string): SafeHtml {
    return this.sanitizer.sanitize(SecurityContext.HTML, value)
  }
}
```

**4. CSRF Protection**
```typescript
// apps/backend/src/main.ts
import * as csurf from 'csurf'

app.use(csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  }
}))

// Frontend: Include CSRF token in requests
httpOptions = {
  headers: new HttpHeaders({
    'X-CSRF-Token': this.getCsrfToken()
  })
}
```

---

## 5. RECOMMENDED LIBRARIES & PACKAGES

### 5.1 Backend

```json
{
  "dependencies": {
    // ALREADY INSTALLED ✅
    "@nestjs/core": "^10.3.0",
    "@nestjs/bullmq": "^10.0.1",
    "@prisma/client": "^5.8.0",
    "ioredis": "^5.8.1",
    "passport-saml": "^3.2.4",

    // TO ADD ❌
    "@nestjs/websockets": "^10.3.0",        // Real-time WebSocket
    "@nestjs/platform-socket.io": "^10.3.0",
    "@nestjs/throttler": "^5.0.0",          // Rate limiting
    "@google-cloud/tasks": "^4.0.0",        // Cloud Tasks (alternative to BullMQ)
    "google-or-tools": "^9.8.0",            // Route optimization TSP solver
    "@influxdata/influxdb-client": "^1.33.0", // IoT time-series data
    "mqtt": "^5.3.0",                       // IoT MQTT protocol
    "winston": "^3.11.0",                   // Advanced logging
    "pino-pretty": "^10.3.0",               // Log formatting
    "helmet": "^7.1.0",                     // Security headers
    "compression": "^1.7.4",                // Response compression
    "@sentry/node": "^7.99.0"               // Error tracking
  }
}
```

### 5.2 Frontend

```json
{
  "dependencies": {
    // ALREADY INSTALLED ✅
    "@angular/core": "^17.0.0",
    "primeng": "^17.0.0",
    "chart.js": "^4.4.0",

    // TO ADD ❌
    "@ngrx/store": "^17.0.0",               // State management
    "@ngrx/effects": "^17.0.0",             // Side effects
    "@ngrx/store-devtools": "^17.0.0",      // Redux DevTools
    "@ngrx/entity": "^17.0.0",              // Entity adapter
    "@angular/service-worker": "^17.0.0",   // PWA support
    "@angular/pwa": "^17.0.0",
    "leaflet": "^1.9.4",                    // Maps
    "@asymmetrik/ngx-leaflet": "^17.0.0",
    "socket.io-client": "^4.6.0",           // WebSocket client
    "dexie": "^3.2.4",                      // IndexedDB wrapper
    "workbox-window": "^7.0.0",             // Service worker utilities
    "@ngx-translate/core": "^15.0.0",       // i18n
    "@ngx-translate/http-loader": "^8.0.0",
    "ng2-charts": "^5.0.0",                 // Chart.js wrapper
    "ngx-mask": "^16.0.0",                  // Input masking
    "date-fns": "^2.30.0"                   // Date utilities (already installed)
  }
}
```

---

## 6. TESTING STRATEGY

### 6.1 Backend Testing

**Coverage Target:** 80%+ (currently 85%)

**Unit Tests (Jest):**
```typescript
// apps/backend/src/application/fir/use-cases/create-fir.use-case.spec.ts
describe('CreateFIRUseCase', () => {
  let useCase: CreateFIRUseCase
  let firRepository: MockProxy<IFIRRepository>
  let cerRepository: MockProxy<ICERRepository>

  beforeEach(() => {
    firRepository = mock<IFIRRepository>()
    cerRepository = mock<ICERRepository>()
    useCase = new CreateFIRUseCase(firRepository, cerRepository)
  })

  it('should create FIR when CER code exists', async () => {
    // Arrange
    const command = new CreateFIRCommand({ /* ... */ })
    cerRepository.findByCode.mockResolvedValue(mockCER)

    // Act
    const result = await useCase.execute(command)

    // Assert
    expect(result.isSuccess).toBe(true)
    expect(firRepository.save).toHaveBeenCalledWith(expect.any(FIR))
  })

  it('should return failure when CER code not found', async () => {
    cerRepository.findByCode.mockResolvedValue(null)

    const result = await useCase.execute(command)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('CER code not found')
  })
})
```

**Integration Tests (Supertest + TestContainers):**
```typescript
// apps/backend/test/fir-workflow.e2e-spec.ts
describe('FIR Workflow (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let accessToken: string

  beforeAll(async () => {
    // Start PostgreSQL test container
    const container = await new PostgreSqlContainer().start()
    process.env.DATABASE_URL = container.getConnectionString()

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()

    // Authenticate test user
    accessToken = await authenticateTestUser(app)
  })

  it('should create, emit, and sync FIR to RENTRI', async () => {
    // 1. Create FIR
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/fir')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        produttoreId: 'test-produttore',
        rifiuto: { cerCode: '13 02 05*', quantita: 100, unitaMisura: 'KG' },
        // ...
      })
      .expect(201)

    const firId = createResponse.body.id

    // 2. Emit FIR
    await request(app.getHttpServer())
      .post(`/api/v1/fir/${firId}/emetti`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)

    // 3. Check RENTRI sync queued
    const fir = await prisma.fIR.findUnique({ where: { id: firId } })
    expect(fir.rentriSyncStatus).toBe('PENDING')

    // 4. Process background job
    await processQueue('rentri-sync')

    // 5. Verify synced
    const syncedFIR = await prisma.fIR.findUnique({ where: { id: firId } })
    expect(syncedFIR.rentriSyncStatus).toBe('SYNCED')
    expect(syncedFIR.rentriProtocolNumber).toBeDefined()
  })
})
```

---

### 6.2 Frontend Testing

**Unit Tests (Jasmine/Karma):**
```typescript
// apps/frontend/src/app/features/fir/fir-list.component.spec.ts
describe('FIRListComponent', () => {
  let component: FIRListComponent
  let fixture: ComponentFixture<FIRListComponent>
  let store: MockStore

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FIRListComponent],
      providers: [
        provideMockStore({
          initialState: {
            fir: {
              firs: [],
              loading: false
            }
          }
        })
      ]
    })

    fixture = TestBed.createComponent(FIRListComponent)
    component = fixture.componentInstance
    store = TestBed.inject(MockStore)
  })

  it('should dispatch loadFIRs action on init', () => {
    const dispatchSpy = spyOn(store, 'dispatch')

    component.ngOnInit()

    expect(dispatchSpy).toHaveBeenCalledWith(loadFIRs())
  })

  it('should display FIRs in table', () => {
    const mockFIRs = [
      { id: '1', firNumber: 'FIR-001', status: 'DRAFT' },
      { id: '2', firNumber: 'FIR-002', status: 'COMPLETED' }
    ]

    store.setState({
      fir: { firs: mockFIRs, loading: false }
    })
    fixture.detectChanges()

    const rows = fixture.nativeElement.querySelectorAll('p-table tbody tr')
    expect(rows.length).toBe(2)
  })
})
```

**E2E Tests (Cypress/Playwright):**
```typescript
// apps/frontend-e2e/src/e2e/fir-workflow.cy.ts
describe('FIR Creation Workflow', () => {
  beforeEach(() => {
    cy.login('operator@test.it', 'password')
  })

  it('should create FIR via wizard', () => {
    cy.visit('/fir/create')

    // Step 1: Produttore
    cy.get('[data-cy=produttore-partita-iva]').type('12345678901')
    cy.get('[data-cy=btn-next]').click()

    // Step 2: Rifiuto
    cy.get('[data-cy=cer-autocomplete]').type('plastica')
    cy.get('[data-cy=cer-option]').first().click()
    cy.get('[data-cy=quantita]').type('150')
    cy.get('[data-cy=btn-next]').click()

    // Step 3: Trasporto
    cy.get('[data-cy=trasportatore-select]').select('Trasporti Ecologici SRL')
    cy.get('[data-cy=vehicle-plate]').type('AB123CD')
    cy.get('[data-cy=btn-next]').click()

    // Step 4: Destinatario
    cy.get('[data-cy=destinatario-select]').select('Impianto Recupero SPA')
    cy.get('[data-cy=btn-next]').click()

    // Step 5: Review & Submit
    cy.get('[data-cy=btn-submit]').click()

    // Verify success
    cy.get('[data-cy=success-message]').should('contain', 'FIR creato con successo')
    cy.url().should('include', '/fir/')
  })
})
```

---

## 7. DEPLOYMENT STRATEGY

### 7.1 Infrastructure as Code (Terraform)

```hcl
# terraform/modules/ecs/main.tf
resource "aws_ecs_cluster" "main" {
  name = "wasteflow-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "wasteflow-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024

  container_definitions = jsonencode([{
    name  = "app"
    image = "${var.ecr_repository_url}:${var.app_version}"

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3000" }
    ]

    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = aws_secretsmanager_secret.db_url.arn
      },
      {
        name      = "JWT_SECRET"
        valueFrom = aws_secretsmanager_secret.jwt_secret.arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/wasteflow"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "wasteflow-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.environment == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnets
    security_groups = [aws_security_group.app.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }
}
```

---

### 7.2 CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AWS_REGION: eu-south-1
  ECR_REPOSITORY: wasteflow
  ECS_SERVICE: wasteflow-app
  ECS_CLUSTER: production

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: |
          cd apps/backend
          npm ci

      - name: Run unit tests
        run: |
          cd apps/backend
          npm run test:cov

      - name: Run E2E tests
        run: |
          cd apps/backend
          docker-compose -f docker-compose.test.yml up -d
          npm run test:e2e
          docker-compose -f docker-compose.test.yml down

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd apps/frontend
          npm ci

      - name: Lint
        run: |
          cd apps/frontend
          npm run lint

      - name: Run tests
        run: |
          cd apps/frontend
          npm run test:headless

  build-and-push:
    needs: [test-backend, test-frontend]
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.build.outputs.tag }}
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build and push Docker image
        id: build
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          echo "tag=$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Tag as latest
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster ${{ env.ECS_CLUSTER }} \
            --service ${{ env.ECS_SERVICE }} \
            --force-new-deployment \
            --region ${{ env.AWS_REGION }}

      - name: Wait for deployment
        run: |
          aws ecs wait services-stable \
            --cluster ${{ env.ECS_CLUSTER }} \
            --services ${{ env.ECS_SERVICE }} \
            --region ${{ env.AWS_REGION }}

      - name: Smoke test
        run: |
          sleep 30
          curl -f https://api.wasteflow.it/health || exit 1

      - name: Notify Slack
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'Deployment to production: ${{ job.status }}'
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## 8. COST ESTIMATION

### 8.1 AWS Infrastructure Costs (Monthly)

| Resource | MVP (100 users) | Growth (1K users) | Scale (10K users) |
|----------|-----------------|-------------------|-------------------|
| **ECS Fargate** (app servers) | 2 tasks x 0.5 vCPU x 1GB<br>~150€ | 4 tasks x 1 vCPU x 2GB<br>~400€ | 10 tasks x 2 vCPU x 4GB<br>~1,200€ |
| **RDS PostgreSQL** | db.t4g.medium (2 vCPU, 4GB)<br>~180€ | db.r6g.large (2 vCPU, 16GB)<br>~400€ | db.r6g.xlarge (4 vCPU, 32GB) + 2 replicas<br>~1,500€ |
| **ElastiCache Redis** | cache.t4g.small (1.5GB)<br>~40€ | cache.t4g.medium (3.2GB)<br>~80€ | cache.r6g.large (13GB) cluster<br>~300€ |
| **S3 Storage** | 100GB + 10K requests<br>~20€ | 500GB + 100K requests<br>~50€ | 2TB + 1M requests<br>~150€ |
| **CloudFront CDN** | 50GB transfer<br>~30€ | 200GB transfer<br>~80€ | 1TB transfer<br>~250€ |
| **API Gateway** | 1M requests<br>~50€ | 10M requests<br>~150€ | 100M requests<br>~500€ |
| **CloudWatch Logs** | 10GB<br>~30€ | 50GB<br>~100€ | 200GB<br>~300€ |
| **Secrets Manager** | 10 secrets<br>~10€ | 20 secrets<br>~20€ | 50 secrets<br>~50€ |
| **Backup (Snapshots)** | 50GB<br>~20€ | 200GB<br>~60€ | 1TB<br>~200€ |
| **TOTAL** | **~530€** | **~1,340€** | **~4,450€** |

**Note:** Prezzi stimati AWS eu-south-1 (Milano), subject to change

---

### 8.2 Third-Party Services

| Service | MVP | Growth | Scale |
|---------|-----|--------|-------|
| **Datadog Monitoring** | Free tier | ~200€ | ~600€ |
| **Sentry Error Tracking** | Free tier | ~50€ | ~150€ |
| **InfoCert Firma Digitale** | €0.30/firma x 500 = 150€ | €0.25/firma x 5K = 1,250€ | €0.20/firma x 50K = 10,000€ |
| **RENTRI Integration** | Free (demo) | Free | Free |
| **SPID Integration** | Free (AgID) | Free | Free |
| **SendGrid Email** | Free 100/day | ~20€ | ~100€ |
| **Twilio SMS** | ~50€ | ~200€ | ~1,000€ |
| **TOTAL** | **~200€** | **~1,720€** | **~11,850€** |

---

### 8.3 Total Cost of Ownership (TCO)

| Phase | Infrastructure | Third-Party | Team (5-8 FTE) | Total/Month |
|-------|----------------|-------------|-----------------|-------------|
| **MVP** (Mesi 1-4) | 530€ | 200€ | 35,000€ | **35,730€** |
| **Growth** (Mesi 5-12) | 1,340€ | 1,720€ | 50,000€ | **53,060€** |
| **Scale** (Anno 2) | 4,450€ | 11,850€ | 70,000€ | **86,300€** |

**Break-Even Analysis:**
- ARPU (Average Revenue Per User): €30/mese
- MVP (100 users): Revenue 3,000€ - Costs 730€ = **Margine 2,270€**
- Growth (1K users): Revenue 30,000€ - Costs 3,060€ = **Margine 26,940€**
- Scale (10K users): Revenue 300,000€ - Costs 16,300€ = **Margine 283,700€**

**Profitability Threshold:** ~250 utenti paganti

---

## 9. SUCCESS METRICS & KPIs

### 9.1 Technical Metrics

| Metric | Target MVP | Target Production |
|--------|-----------|-------------------|
| **API Response Time (P95)** | <2s | <500ms |
| **API Response Time (P99)** | <5s | <1s |
| **Error Rate** | <1% | <0.1% |
| **Uptime** | 99% | 99.9% |
| **Test Coverage** | 80%+ | 85%+ |
| **Security Vulnerabilities** | 0 critical | 0 high |
| **Lighthouse Score** | >80 | >90 |
| **Bundle Size (Frontend)** | <500KB | <300KB |
| **Database Query Time (P95)** | <100ms | <50ms |
| **RENTRI Sync Success Rate** | >90% | >99% |

---

### 9.2 Business Metrics

| Metric | Target MVP | Target Growth |
|--------|-----------|---------------|
| **User Activation Rate** (first FIR <7 days) | 60% | 80% |
| **FIR Created per User per Month** | 10 | 20 |
| **RENTRI Sync Delay** | <1 hour | <5 minutes |
| **Support Tickets per 100 Users** | <5 | <2 |
| **NPS (Net Promoter Score)** | >40 | >60 |

---

## 10. RISK MITIGATION

### 10.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **RENTRI API Downtime** | Medium | High | Graceful degradation, queue retry 24h, offline mode |
| **Database Performance Bottleneck** | Medium | High | Read replicas, materialized views, caching |
| **SPID Integration Issues** | Low | High | Fallback email/password auth (temporary) |
| **Scaling Beyond 10K Users** | Low | Medium | Database sharding plan, microservices extraction |
| **Security Breach** | Low | Critical | Penetration testing, SOC 2 audit, bug bounty |

---

### 10.2 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Key Developer Leaves** | Medium | High | Code documentation, pair programming, knowledge sharing |
| **AWS Region Outage** | Low | High | Multi-region backup plan, RTO 4h, RPO 1h |
| **Budget Overrun** | Medium | Medium | Cost monitoring alerts, reserved instances, rightsizing |
| **Regulatory Changes** | Low | High | Modular architecture, external compliance consultant |

---

## 11. NEXT STEPS - IMMEDIATE ACTIONS

### Week 1-2: Critical Infrastructure

**Priority 0 (Blockers):**
1. [ ] Implement Prisma repositories (5 days)
2. [ ] Complete SPID authentication (5 days)
3. [ ] Database seeding (2 days)

**Deliverable:** Backend fully functional with persistence

---

### Week 3-4: RENTRI Integration

**Priority 1 (MVP):**
1. [ ] RENTRI API client OAuth2 (3 days)
2. [ ] BullMQ queue setup (2 days)
3. [ ] RENTRI sync processor (3 days)
4. [ ] Integration tests (2 days)

**Deliverable:** FIR synced to RENTRI demo environment

---

### Week 5-6: Frontend Foundation

**Priority 1 (MVP):**
1. [ ] NgRx store setup (3 days)
2. [ ] FIR wizard multi-step (4 days)
3. [ ] FIR list enhanced (2 days)
4. [ ] Registry CRUD (2 days)

**Deliverable:** Frontend MVP completo

---

### Week 7-8: Polish & Testing

**Priority 1 (MVP):**
1. [ ] API endpoints completi (4 days)
2. [ ] Dashboard analytics (3 days)
3. [ ] E2E tests (3 days)

**Deliverable:** MVP production-ready

---

## 12. CONCLUSION

### 12.1 Riepilogo Gap

**Backend:**
- ❌ Prisma repositories (BLOCKER)
- ❌ SPID auth completo (BLOCKER)
- ❌ RENTRI integration (MVP)
- ❌ BullMQ config (MVP)
- ❌ Rate limiting (MVP)
- ⚠️  Logging completo (MVP)
- ⚠️  Health checks (MVP)

**Frontend:**
- ❌ NgRx state management (BLOCKER)
- ❌ Form wizard (BLOCKER)
- ⚠️  FIR CRUD completo (MVP)
- ❌ Dashboard charts (MVP)
- ❌ PWA offline (Post-MVP)
- ❌ Real-time maps (Post-MVP)

**Database:**
- ⚠️  Seeding completo (BLOCKER)
- ❌ Full-text search CER (MVP)
- ❌ PostGIS (Post-MVP)

---

### 12.2 Effort Summary

**FASE 1 (MVP Foundation): 8 settimane**
- Backend infrastructure: 4 settimane
- Frontend foundation: 4 settimane
- **Team:** 5 FTE (2 backend, 2 frontend, 1 DevOps)
- **Cost:** ~35,000€/mese team + 730€ infra

**FASE 2 (Advanced Features): 8 settimane**
- Real-time & WebSocket: 2 settimane
- PWA & Maps: 2 settimane
- IoT pipeline: 2 settimane
- Route optimization: 2 settimane
- **Team:** 7 FTE
- **Cost:** ~50,000€/mese team + 3,000€ infra

**FASE 3 (Performance & Polish): 4 settimane**
- Performance optimization: 2 settimane
- Testing & documentation: 2 settimane
- **Team:** 8 FTE

---

### 12.3 Raccomandazioni Finali

**1. Priorità Immediata:**
- Completare backend infrastructure (Prisma repos, SPID, RENTRI) in 4 settimane
- Parallelizzare frontend NgRx setup mentre backend in sviluppo

**2. Quality Gates:**
- Mantenere 80%+ test coverage
- Zero security vulnerabilities critiche
- Performance budgets: API <2s P95, Frontend <500KB bundle

**3. Architecture Principles:**
- Keep MVP simple, avoid over-engineering
- Prepare for scale (PostGIS, partitioning) ma implement quando necessario
- Modular architecture per future microservices extraction

**4. Success Criteria MVP:**
- 100 utenti attivi creano 1000 FIR/mese
- RENTRI sync success rate >90%
- User activation rate >60%
- NPS >40

---

**Document Prepared By:** Senior Full-Stack Architect
**Date:** 2025-10-30
**Version:** 1.0
**Next Review:** Ogni 2 settimane durante implementation

---

**APPENDIX: Quick Reference Commands**

```bash
# Backend Development
cd apps/backend
npm run start:dev          # Dev server con watch
npm run test:watch         # Tests in watch mode
npm run test:cov           # Coverage report
npm run prisma:studio      # DB GUI

# Frontend Development
cd apps/frontend
npm start                  # Dev server http://localhost:4200
npm run test               # Karma tests
npm run build:prod         # Production build

# Docker Local
docker-compose up -d       # Start PostgreSQL + Redis
docker-compose logs -f     # Follow logs

# Deployment
terraform plan             # Preview infrastructure changes
terraform apply            # Apply changes
gh workflow run deploy     # Trigger GitHub Actions deploy
```
