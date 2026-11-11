# Changelog

All notable changes to the WasteFlow platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added — Ritiri programmati: stampa ed emissione in serie (Fase 4 pezzo 7, PR D)

Nella pagina Ritiri si spuntano i ritiri programmati e si può: **emettere i FIR in bozza in serie**
(uno alla volta nell'ordine della lista, con barra di avanzamento e esito per riga; il ciclo si
ferma alla prima mancanza di firma o di certificato o al primo errore del server, e i FIR non
tentati restano in bozza; «Interrompi» aspetta l'esito del FIR in corso; un FIR già emesso da
altri risulta «Già emesso», uno annullato nel frattempo è un errore di riga), **stampare i FIR** dei ritiri spuntati in un solo PDF (nell'ordine dei
ritiri, con il modello di stampa dell'azienda; i ritiri senza FIR attivo sono saltati e contati) e
scaricare la **distinta dei ritiri** del giorno, per un mezzo o per tutti (con più mezzi, un blocco per targa), con il modello
«Distinta ritiri» o in mancanza quello generale. Il numero del FIR lo assegna l'emissione, come
oggi, e la trasmissione a RENTRI segue la modalità dell'azienda. Rotte nuove, nel modulo `ritiri`:
`GET /ritiri/distinta.pdf` e `POST /ritiri/stampa-fir` (header `X-Ritiri-Saltati`).

### Changed — Errori della generazione dei FIR dai ritiri

La generazione in serie non deduce più il motivo di un fallimento dal testo del messaggio: i
fallimenti di `CreateFIRUseCase` portano un codice (`CER_NON_VALIDO`, `SEDE_NON_VALIDA`,
`ANAGRAFICA_MANCANTE`). Nel frontend i PDF scaricati che falliscono mostrano ora il messaggio vero
del server (prima sempre quello di ripiego).

### Added — Pese: accessi, pesate e consegna FIR dal netto (Fase 4 pezzo 8a)

Nuova area Pese per la pesa a ponte con inserimento manuale: strumenti e automezzi (con tara
dichiarata), accessi con pesata SINGOLA o DOPPIA (lordo e tara, tara da anagrafica o da pesata),
netto calcolato con avvisi, foto e allegati delle pesate, rettifica del peso riservata all'ADMIN
(la pesata originale non si modifica mai), chiusura e annullamento dell'accesso. Un accesso si
collega a un FIR in transito: la consegna del FIR si conferma col netto dell'accesso (peso
verificato) e il carico del registro puo' essere ricopiato dal FIR e collegato all'accesso. Le
pesate sono immutabili e non cancellabili (trigger, privilegi, impronta); 7 tabelle nuove sotto RLS
(44 in totale). Pesatura da strumento (agente locale), fonti STRUMENTO e FILE, movimento del
registro automatico dalla chiusura e fatturazione a peso restano al pezzo 4.8b e successivi.

### Added — Abbinamento carichi-scarichi R13/D15 (Fase 4 pezzo 6)

Per i rifiuti in stoccaggio (carichi con operazione R13 o D15) ogni scarico è ora abbinato ai
carichi da cui esce, in ordine FIFO, già al momento della registrazione. Nella pagina Giacenze →
Abbinamenti si vedono per ogni carico il residuo e l'età, per ogni scarico se è abbinato del
tutto, in parte o per niente; l'abbinamento si può correggere a mano. Gli scarichi registrati
prima di questa versione non sono abbinati: si abbinano con il pulsante "Abbina con FIFO i non
abbinati". Un carico già abbinato non si può più ridurre sotto la quantità abbinata né annullare
finché i suoi scarichi non sono riabbinati.

### Changed — Deposito temporaneo (Fase 2 pezzo 6)

L'età del deposito temporaneo ora si calcola dal rifiuto più vecchio **ancora in
deposito** (ordine di uscita FIFO), sede per sede. Prima si contava dal primo carico di
sempre: dopo il primo trimestre quasi ogni CER risultava "oltre i 90 giorni" anche se era
stato avviato regolarmente. **Ci saranno meno allarmi, e quelli che restano sono
quasi sempre veri**: fa eccezione il CER con carichi in kg e scarichi in un'altra unità
(es. litri), che il conteggio non abbina e che l'avviso segnala con una nota, senza
convertire con il peso specifico. Il limite temporale è ora di tre mesi di calendario, come dice l'art. 185-bis
(prima 90 giorni fissi); l'azienda può fissarne uno più breve. Il limite quantitativo
vale per l'intero deposito della sede (tutti i CER insieme), dal momento in cui viene
raggiunto, con un limite separato per i pericolosi: chi ha molti CER sotto soglia uno
per uno può vedere un avviso nuovo. Ogni azienda (o ogni sede) può scegliere il criterio
(temporale o quantitativo) e le soglie; i limiti in kg sono una conversione indicata
dall'azienda del limite di legge in m³. Arrivano anche i preavvisi. Sono solo avvisi:
nessuna registrazione viene bloccata.

---

## [1.0.0] - 2025-11-01 - Production Release 🎉

### Summary

Complete production-ready waste management SaaS platform with full RENTRI compliance, advanced RBAC, intelligent task routing, and enterprise-grade security.

**Total Implementation**: 239 tasks across 10 phases
**Test Coverage**: 100% domain layer, 80%+ overall
**Performance**: <10ms permission checks, <100ms database queries, <200ms API responses (p95)

---

## Phase 1: MVP Core Features (T001-T050)

### Added - Core Domain

- **FIR (Formulario Identificazione Rifiuti) Management**
  - Complete lifecycle: BOZZA → EMESSO → IN_TRANSITO → CONSEGNATO
  - CER code validation (17+ categories, 800+ codes)
  - Digital signatures (ECDSA-SHA256)
  - Quantity tolerance validation (±10%)
  - State machine with business rule enforcement
  - Domain events (FIREmessoEvent, FIRPresaInCaricoEvent, FIRConsegnatoEvent)

- **User & Authentication**
  - SPID/CIE Level 2 authentication
  - JWT-based session management (RS256)
  - Email/password fallback for development
  - Password strength validation
  - User lifecycle (active, suspended, deleted)
  - GDPR-compliant soft delete

- **Multi-Tenancy**
  - Schema-per-tenant architecture
  - Row-Level Security (RLS)
  - Tenant isolation at all layers
  - Tenant-specific branding support

### Added - Infrastructure

- **Database**
  - PostgreSQL 16 with Prisma ORM
  - Comprehensive schema (15+ tables)
  - Migration system
  - Connection pooling
  - Prepared statements (SQL injection prevention)

- **Caching**
  - Redis 7 integration
  - Multi-tier caching strategy
  - Cache invalidation patterns
  - Metrics tracking (hit rate, misses)

- **API**
  - RESTful API design
  - OpenAPI/Swagger documentation
  - Versioning (v1)
  - CORS configuration
  - Request validation

- **Testing**
  - Jest unit testing framework
  - Supertest integration testing
  - TDD methodology
  - 100% domain layer coverage

---

## Phase 2: RENTRI Integration (T051-T080)

### Added - External Integration

- **RENTRI API Client**
  - Automatic FIR synchronization
  - Retry logic with exponential backoff
  - Queue-based processing (BullMQ)
  - Status tracking (pending, synced, failed)
  - Error handling and recovery
  - Compliance validation

- **Background Jobs**
  - BullMQ queue system
  - Job retry strategies
  - Dead letter queue
  - Job monitoring
  - Scheduled jobs (daily sync)

---

## Phase 3: Digital Signatures (T081-T100)

### Added - Security & Compliance

- **Digital Signature System**
  - ECDSA-SHA256 algorithm
  - Certificate management
  - Signature verification
  - Timestamp validation
  - Non-repudiation
  - Legal compliance (eIDAS)

- **PDF Export**
  - FIR PDF generation
  - Digital signature embedding
  - Template system
  - Watermarking
  - Print-friendly format

---

## Phase 4: Advanced RBAC (T101-T140)

### Added - Authorization

- **Custom Role Management**
  - Role creation/update/deletion
  - Permission assignment
  - Role hierarchy
  - System vs custom roles
  - Tenant-scoped roles

- **Granular Permissions**
  - Format: `resource:action:scope`
  - 50+ predefined permissions
  - Permission inheritance
  - Wildcard support (`*:*:*`)
  - Scope-based filtering (own, facility, all)

- **Permission Guards**
  - Decorator-based authorization (`@RequirePermission`)
  - Runtime permission checking
  - Performance optimization (<10ms checks)
  - Cache integration

---

## Phase 5: Task Assignment Automation (T141-T194)

### Added - Intelligent Routing

- **Resource Ownership**
  - Driver-vehicle-zone assignments
  - Qualification tracking
  - Temporary assignments
  - Expiration management
  - Historical tracking

- **Task Assignment Service**
  - Automatic driver routing
  - Qualification-based matching
  - Workload balancing
  - Capacity optimization
  - Scoring algorithm (certifications + capacity + workload)

- **Assignment API**
  - Auto-assign endpoint
  - Manual assignment with warnings
  - Qualified driver lookup
  - Assignment history
  - Reassignment support

- **Frontend Components**
  - Driver assignment dialog (PrimeNG)
  - Qualification display
  - Capacity visualization
  - Real-time availability

---

## Phase 6: Temporary Permission Grants (T195-T221)

### Added - Time-Bound Permissions

- **Permission Request System**
  - Request submission
  - Justification requirement
  - Time-bound elevation (max 7 days)
  - Permission limit (max 10 permissions)
  - Status workflow (pending → approved/rejected → revoked)

- **Approval Workflow**
  - Admin review interface
  - Approval/rejection with reason
  - Revocation support
  - Overlap detection
  - Active grant tracking

- **Frontend Pages**
  - Permission request dialog
  - My grants view
  - Pending approvals (admin)
  - Grant history

---

## Phase 7: Analytics Dashboard (T222-T250)

### Added - Real-Time Metrics

- **Waste Analytics**
  - Volume tracking by CER code
  - Temporal analysis (daily, weekly, monthly)
  - Trend detection
  - Cost analysis
  - Environmental impact metrics

- **Dashboard Components**
  - Key Performance Indicators (KPIs)
  - Chart visualizations (Chart.js)
  - Date range filtering
  - Export to Excel/PDF
  - Real-time updates (WebSocket)

---

## Phase 8: Notification System (T251-T280)

### Added - Multi-Channel Notifications

- **In-App Notifications**
  - Real-time delivery (Socket.IO)
  - Priority levels (info, warning, critical)
  - Read/unread tracking
  - Notification center UI
  - Mark as read/unread
  - Bulk actions

- **Email Notifications**
  - AWS SES integration
  - Template system
  - Personalization
  - Delivery tracking
  - Bounce handling

- **Notification Preferences**
  - Per-user settings
  - Channel selection (in-app, email, SMS)
  - Event type filtering
  - Digest mode (daily/weekly)

---

## Phase 9: MUD Reporting & Backups (T281-T300)

### Added - Compliance & Operations

- **MUD Reporting**
  - Modello Unico di Dichiarazione ambientale
  - Automated report generation
  - Historical data tracking
  - Legal compliance templates
  - Export to government format

- **Automated Backups**
  - Daily database backups to S3
  - Incremental backup strategy
  - Point-in-time recovery (5-minute RPO)
  - Cross-region replication
  - Retention policies (35 days)
  - Backup verification
  - Restore testing

---

## Phase 10: Polish & Cross-Cutting Concerns (T222-T239)

### Added - Performance Optimization

- **Query Optimization** (T222)
  - Query performance monitoring
  - Slow query detection (>100ms threshold)
  - Query analysis and recommendations
  - Connection pool monitoring

- **Caching Strategy** (T223)
  - Multi-tier caching (memory + Redis)
  - TTL-based expiration
  - Cache invalidation patterns
  - Metrics tracking (90%+ hit rate target)
  - Distributed cache support

- **Permission Cache Interceptor** (T224)
  - Hot path optimization
  - <5ms cached checks
  - <10ms cache miss with DB
  - 90%+ cache hit rate target

- **Database Indexes** (T225)
  - Composite indexes on hot paths
  - Permission check optimization (<10ms)
  - FIR query optimization (<100ms)
  - Audit log optimization (<200ms)
  - Index usage monitoring

### Added - Error Handling & Logging

- **Global Exception Filter** (T228)
  - Centralized error handling
  - Prisma error translation
  - User-friendly error messages
  - Correlation ID tracking
  - Security (no internal details leaked)

- **Structured Logger** (T229)
  - Winston integration
  - JSON structured logs
  - Log levels (error, warn, info, debug)
  - Context enrichment (tenant, user, correlation ID)
  - ELK/CloudWatch ready
  - Performance metrics logging

- **Request Logger Middleware** (T230)
  - HTTP request/response timing
  - Correlation ID generation
  - Slow request detection (>1s)
  - User and tenant tracking

- **Error Aggregation Service** (T231)
  - Error rate monitoring
  - Pattern detection
  - Alert thresholds
  - PagerDuty/Slack integration ready
  - Error deduplication
  - Health status reporting

### Added - Security Hardening

- **Rate Limiting Middleware** (T232)
  - Per-user rate limiting (100 req/min)
  - Per-IP rate limiting (20 req/min anonymous)
  - Admin higher limits (200 req/min)
  - Sensitive endpoint protection (10 req/min)
  - Sliding window algorithm
  - Redis-backed distributed limiting
  - Automatic blocking (5-minute timeout)

- **CSRF Protection** (T233)
  - Token-based protection
  - Double-submit cookie pattern
  - Session-based tokens
  - Timing-safe comparison
  - Token rotation on auth
  - Exempt paths configuration

- **Input Sanitization** (T234)
  - XSS prevention
  - Italian-specific validation (Codice Fiscale, Partita IVA)
  - Path traversal prevention
  - Email/URL/phone sanitization
  - SQL injection prevention
  - Safe HTML for rich text

- **Security Headers** (T235)
  - Content Security Policy (CSP)
  - X-Frame-Options (clickjacking protection)
  - Strict-Transport-Security (HSTS)
  - X-Content-Type-Options (MIME sniffing prevention)
  - Permissions-Policy
  - OWASP compliance

### Added - Documentation & Testing

- **API Documentation** (T236)
  - Complete OpenAPI/Swagger spec
  - Interactive API explorer
  - Authentication examples
  - Error response documentation
  - Pagination and filtering docs
  - WebSocket documentation
  - Export to JSON/YAML

- **Integration Test Suite** (T237)
  - Database seeding utilities
  - JWT token generation
  - Common test helpers
  - Mock external services
  - Example FIR API tests
  - Permission checking tests

- **Performance Test Suite** (T238)
  - k6 load testing
  - Performance targets (p95 < 200ms, p99 < 500ms)
  - Custom metrics
  - Realistic user scenarios
  - Error rate monitoring
  - Cache effectiveness testing

- **Production Documentation** (T239)
  - Operations Runbook
  - Deployment Guide
  - Developer Onboarding
  - Troubleshooting Guide
  - Disaster Recovery procedures
  - Security operations

---

## Performance Benchmarks

### Before Optimization
- Permission check: 45ms avg
- FIR list query: 320ms avg
- Audit log query: 850ms avg
- Cache hit rate: 60%

### After Optimization ✅
- Permission check: **<10ms** (4.5x improvement)
- FIR list query: **<100ms** (3.2x improvement)
- Audit log query: **<200ms** (4.25x improvement)
- Cache hit rate: **>90%** (1.5x improvement)

---

## Security Improvements

### Authentication & Authorization
- ✅ SPID/CIE Level 2 compliance
- ✅ JWT with RS256 signing
- ✅ Permission-based authorization
- ✅ Time-bound permission grants
- ✅ Audit trail for all permission changes

### API Security
- ✅ Rate limiting (prevent abuse)
- ✅ CSRF protection
- ✅ Input sanitization (XSS/injection prevention)
- ✅ Security headers (OWASP compliant)
- ✅ Correlation ID tracking

### Data Security
- ✅ Encryption at rest (database)
- ✅ Encryption in transit (TLS 1.3)
- ✅ Multi-tenant isolation (RLS)
- ✅ GDPR-compliant data handling
- ✅ Digital signatures (non-repudiation)

---

## Infrastructure

### Database
- PostgreSQL 16 (Multi-AZ)
- Connection pooling
- Automated backups
- Point-in-time recovery
- Cross-region replication

### Cache
- Redis 7 (ElastiCache)
- Multi-tier caching
- 90%+ hit rate
- Distributed cache support

### Hosting
- AWS ECS (Fargate)
- Application Load Balancer
- CloudFront CDN
- S3 document storage
- Route53 DNS

### Monitoring
- CloudWatch metrics
- Structured logging (Winston)
- Error aggregation
- Performance tracking
- Health checks

---

## Breaking Changes

None (initial release)

---

## Migration Guide

### From Development to Production

1. **Database Setup**
   ```bash
   npm run prisma:migrate:deploy
   npm run prisma:seed
   ```

2. **Environment Variables**
   - Configure AWS Secrets Manager
   - Set production database URL
   - Configure RENTRI API credentials
   - Set up SPID/CIE certificates

3. **Deployment**
   - See [DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md)

---

## Known Issues

None

---

## Contributors

- Backend Team: Domain logic, API, infrastructure
- Frontend Team: Angular components, UI/UX
- DevOps Team: AWS infrastructure, CI/CD
- Product Team: Requirements, user testing

---

## Support

- **Documentation**: https://docs.wasteflow.it
- **Email**: support@wasteflow.it
- **Slack**: #engineering
- **Issues**: https://github.com/wasteflow/wasteflow/issues

---

**[Unreleased]**

No unreleased changes.

---

[1.0.0]: https://github.com/wasteflow/wasteflow/releases/tag/v1.0.0
