# WasteFlow - Riepilogo Completo Funzionalita

> ⚠️ **STATO REALE (2026-06): MVP parziale ~50%, NON production-ready.** Vedi [planning/ANALISI_E_PIANO_2026-06.md](./planning/ANALISI_E_PIANO_2026-06.md). Le affermazioni "239/239 task completati / production-ready / coverage 80-85%" in questo documento sono **aspirazionali**. Correzioni chiave: RENTRI è **mock-only** (nessuna API governativa reale); il **multi-tenant è da consolidare** (il contesto tenant non viene estratto dal JWT → rischio data-leak); MUD è **stub** (recupero/smaltimento a zero); SPID/CIE è **dev-only**; l'**app mobile è assente**; la **coverage reale è bassa** (backend ~14%, frontend ~2%) e la **CI/CD è assente**. Dove questo documento dichiara "Completo/Completato/production-ready", leggere come visione, salvo i punti già segnati come parziali nella §10 (analisi del codice sorgente), che è la parte più vicina alla realtà.

Documento ottimizzato per context injection in agenti LLM.
Ultimo aggiornamento: 2026-02-22 (banner di stato reale aggiunto 2026-06-05)

---

## 1. Panoramica Progetto

**WasteFlow** e una piattaforma SaaS B2B per la gestione digitale dei rifiuti destinata ad aziende italiane. Integra nativamente il sistema RENTRI (Registro Elettronico Nazionale Tracciabilita Rifiuti).

- **Mercato target**: 150.000+ aziende italiane obbligate RENTRI, focus su 80.000+ micro-PMI sottosservite
- **Value proposition**: Trasformare la compliance ambientale da costo burocratico a vantaggio competitivo
- **Differenziatori**: AI-powered simplicity, mobile-first, marketplace B2B, pricing trasparente
- **Stato implementazione**: ⚠️ **MVP parziale ~50%, NON production-ready** (la cifra "239/239 task completati" è di documentazione, non di codice). Architettura DDD/CQRS solida, ma integrazioni chiave mockate o incomplete: RENTRI mock-only, multi-tenant da consolidare, MUD stub, test bassi (~14% backend / ~2% frontend), CI/CD assente. Vedi [planning/ANALISI_E_PIANO_2026-06.md](./planning/ANALISI_E_PIANO_2026-06.md).
- **Licenza**: MIT

---

## 2. Stack Tecnologico

### Backend
| Tecnologia | Versione | Utilizzo |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| NestJS | 10.3 | Framework API |
| TypeScript | 5.2+ | Linguaggio |
| Prisma | 5.8 | ORM type-safe |
| PostgreSQL | 16 | Database principale (Row-Level Security) |
| Redis | 7 | Cache + code BullMQ |
| BullMQ | - | Background jobs (sync RENTRI, email, PDF, MUD) |
| passport-saml | - | Autenticazione SPID/CIE |
| Nodemailer | - | Invio email |
| pdfmake | - | Generazione PDF |
| Jest | - | Testing (TDD) |

### Frontend
| Tecnologia | Versione | Utilizzo |
|---|---|---|
| Angular | 17 | Framework (standalone components) |
| PrimeNG | 17 | Libreria UI |
| Chart.js | - | Grafici analytics (via PrimeNG) |
| Angular Signals | - | State management |
| Reactive Forms | - | Gestione form |

### Infrastruttura
| Tecnologia | Utilizzo |
|---|---|
| Docker Compose | Containerizzazione |
| AWS (ECS Fargate, RDS, ElastiCache, S3, CloudFront) | Cloud hosting |
| Terraform | Infrastructure as Code |
| GitHub Actions | CI/CD |
| Prometheus + Grafana | Monitoring |
| Keycloak 23 | Identity provider SPID/CIE |

---

## 3. Architettura

### Pattern Architetturali
- **Domain-Driven Design (DDD)**: Aggregates, Value Objects, Domain Events, Repository Pattern
- **CQRS**: Commands e Queries separati con handler dedicati
- **Clean Architecture**: Domain -> Application -> Infrastructure -> API (dipendenze verso l'interno)
- **Multi-tenancy**: Schema-per-tenant + Row-Level Security PostgreSQL
- **Result Pattern**: Error handling funzionale senza eccezioni
- **Event-Driven**: Domain events per disaccoppiamento tra moduli

### Struttura Progetto
```
apps/
  backend/src/
    domain/          # Entita DDD, aggregates, value objects (100% test coverage)
    application/     # Use cases, CQRS commands/queries
    infrastructure/  # Prisma repositories, client API esterni
    api/             # REST controllers, DTO, Swagger
    auth/            # SPID/CIE strategy, JWT guards
    core/            # Logger, metrics, result pattern
  frontend/src/app/
    core/            # Auth service, layout, interceptors
    features/        # Dashboard, FIR, registry, notifications, admin, permissions
    shared/          # Componenti comuni, modelli
```

---

## 4. Funzionalita per Dominio

### 4.1 Autenticazione e Autorizzazione

**Autenticazione SPID/CIE** (Priorita P1 - Completata)
- Login tramite SPID (SAML 2.0) e CIE (identita digitale italiana)
- Livello SPID 2+ per firma digitale legalmente valida
- Creazione automatica utente da attributi SPID (codice fiscale, email, nome)
- Gestione sessione con JWT (1h scadenza) + refresh token (7 giorni, rotazione)
- Redis per session management
- Supporto MFA

**Sistema Ruoli e Permessi** (10 fasi completate, 248 task)
- RBAC con 5 ruoli predefiniti: SUPER_ADMIN, ADMIN, OPERATOR, VIEWER, CONSULTANT
- Ruoli custom enterprise con matrice permessi granulare (resource:action:scope)
- ABAC Policy Engine (<2ms P99) con 10 operatori logici
- Isolamento tenant enforced a tutti i livelli
- Cache permessi Redis con invalidazione distribuita pub/sub
- Permessi temporanei con workflow approvazione (richiesta -> approvazione admin -> auto-revoca)
- Audit trail completo con retention 10 anni (requisito D.Lgs. 152/2006)
- Rate limiting per tenant (Redis sliding window)
- CSRF protection, input sanitization, security headers

**Multi-Tenant**
- Schema-per-tenant + Row-Level Security PostgreSQL
- Tenant selector nel header per consulenti (gestione N clienti)
- Dashboard aggregata "Tutti i clienti" per consulenti
- Isolamento dati garantito a livello DB, API e cache
- Tenant context nel JWT
- Onboarding, settings, billing per tenant

### 4.2 Gestione Rifiuti Core

**FIR Digitale** (Formulario Identificazione Rifiuti) - Conforme D.M. 59/2023
- Aggregate Root DDD con state machine: BOZZA -> EMESSO -> IN_TRANSITO -> CONSEGNATO
- Creazione FIR con validazione CER, quantita, parti coinvolte
- Workflow firma a 3 stadi: Produttore -> Trasportatore -> Destinatario
- Validazione peso con tolleranza +/-10%
- Annullamento con business rules
- Domain events per ogni transizione di stato
- API REST completa: CRUD + transizioni stato + ricerca con paginazione
- 25+ test cases, 100% coverage

**Firme Digitali** (ECDSA-SHA256)
- Firma crittografica ECDSA P-256 con timestamp RFC 3161
- Workflow firma a 3 stadi (produttore, trasportatore, destinatario)
- Verifica firma indipendente
- Pagina pubblica di verifica
- QR code per scansione e verifica rapida da autorita
- Firma tramite SPID OTP

**Codici CER/EER**
- Database completo 842 codici CER aggiornato 2025
- Import da CSV ISPRA con skip duplicati
- Ricerca full-text con keyword e filtri
- Auto-detection rifiuti pericolosi (asterisco)
- Estrazione categoria automatica
- Statistiche pericolosi vs non-pericolosi
- (Pianificato) AI CER Suggestion con GPT-4: descrizione -> codice CER suggerito

**Registri Carico/Scarico**
- Registri elettronici con progressivi automatici
- Vidimazione digitale documenti
- Conforme a D.Lgs. 152/2006

**Sincronizzazione RENTRI**
- Client API RENTRI con OAuth2
- Sync automatica bidirezionale
- Retry logic con exponential backoff (fino a 3 tentativi)
- BullMQ queue per batch giornaliero
- Graceful degradation se RENTRI non disponibile (coda locale)
- Monitoring proattivo con alert per fallimenti
- Mock RENTRI server per sviluppo
- 99.5% success rate target

**Report MUD** (Modello Unico Dichiarazione Ambientale)
- Generazione automatica report annuale da dati FIR e registri
- Aggregazione dati per anno, categoria, tipo operazione
- Classificazione rifiuti per tipo
- Breakdown recupero vs smaltimento
- Template MUD per tipo rifiuto
- Export PDF e Excel
- Alert scadenze (deadline 30 aprile)

### 4.3 Gestione Contratti (Modulo Avanzato)

- Anagrafica contratti produttore-trasportatore-smaltitore
- 8 modelli pricing: flat rate, pay-per-lift, pay-by-weight, pay-by-volume, zone-based, tiered volume, minimum guarantee, hybrid
- Template personalizzabili con drag-drop builder
- Workflow approvazione multi-step
- Auto-compilazione FIR da contratto attivo (-60% tempo compilazione)
- Alert scadenze smart multi-canale (60/30/7 giorni)
- Versioning e audit trail
- Billing automatico da volume/peso (Stripe)
- Firma digitale integrata (InfoCert/DocuSign)
- Analytics: costo/kg, benchmark vendor, risparmio potenziale
- (Pianificato) AI contract optimization e raccomandazioni rinnovo
- (Pianificato) Integrazione marketplace: preventivo -> contratto in 2 click

### 4.4 Dashboard e Analytics

**Dashboard KPI Real-Time**
- 6 card KPI: totale rifiuti (kg) mese, FIR attivi, sync RENTRI pendenti, rifiuti per categoria, trend costi, scadenze imminenti
- Grafici interattivi (Chart.js via PrimeNG)
- Filtro per sede produttiva
- Aggiornamento near real-time (<5 secondi)
- Drill-down da KPI a dettaglio con tabella dati
- Filtro periodo personalizzato
- Responsive: cards impilate su mobile, grafici touch-scrollable
- Export CSV

**Metriche Calcolate**
- Statistiche FIR (per stato, periodo, sede)
- Analisi rifiuti (per CER, per tipo, per quantita)
- Compliance scoring
- Trend e previsioni
- (Pianificato) Carbon footprint tracking
- (Pianificato) Circular economy KPI
- (Pianificato) Predictive waste forecasting (ML)

### 4.5 Sistema Notifiche

**Notifiche In-App**
- Notification entity con tipi multipli
- Bell icon con contatore non letti
- Polling real-time
- Mark as read con animazione
- Categorizzazione visiva per tipo

**Notifiche Email**
- Integrazione Nodemailer (AWS SES ready)
- Template email per tutti i tipi notifica
- Alert scadenze MUD (30/15/7 giorni prima)
- Alert vidimazione registri
- Alert scadenza autorizzazioni trasportatori
- Alert sync RENTRI fallita

**Preferenze Notifica**
- Configurazione per utente: email, in-app, o entrambi
- (Pianificato) Push notifications mobile
- Event-driven trigger automatici

### 4.6 Gestione Documenti

**Export PDF**
- Generazione PDF FIR con pdfmake
- Header aziendale, numerazione progressiva, dettagli parti, sezione firme
- QR code per verifica da autorita
- Export singolo e batch (PDF multi-pagina)
- Report MUD in PDF
- (Pianificato) Allegati (foto, certificati analisi) come appendice
- (Pianificato) Template letterhead personalizzabile per azienda

### 4.7 Anagrafiche

**Gestione Soggetti**
- Produttori: dati aziendali, sede legale, codice fiscale/P.IVA
- Trasportatori: autorizzazioni, scadenze, veicoli, certificazioni ADR
- Destinatari: impianti, autorizzazioni
- Form con sezioni visive raggruppate
- Validazione dati
- Mobile card view + desktop table view
- Bulk actions, empty states, skeleton loading

### 4.8 Assegnazione Task (Flotta Trasportatori)

- Auto-assegnazione FIR a autisti basata su: certificazione ADR, zona geografica, capacita veicolo
- Vista "My Assignments" mobile-first con ordinamento GPS proximity
- Haversine distance calculation
- IndexedDB per caching offline
- Auto-refresh ogni 30 secondi
- Riassegnazione automatica se autista non disponibile
- Load balancing tra autisti qualificati

### 4.9 Amministrazione

**Gestione Utenti e Ruoli**
- Invito utenti con ruolo specifico (link scadenza 48h)
- Protezione ultimo admin per tenant
- Ruoli custom con permission matrix builder (fino a 100 permessi)
- Blocco nomi ruoli sistema
- Cache invalidation immediata su modifica ruoli

**Monitoring e Health**
- Health check endpoints (app, DB, Redis, RENTRI, BullMQ)
- Prometheus metrics: latenza permessi, cache hit ratio, audit writes, ABAC evaluations
- Grafana dashboard con 8 pannelli e allarmi
- Error rate tracking e aggregazione pattern
- Winston logging
- (Pianificato) Sentry integration

**Backup**
- PostgreSQL automated backups
- Point-in-time recovery (PITR)
- Backup encryption
- Retention 30 giorni
- Script ripristino
- Monitoring e alert backup

---

## 5. UI/UX

### Design System
- CSS custom properties (design tokens): colori brand, tipografia, spacing, shadows, z-index
- Font: Inter con scala xs-4xl
- Palette: Primary Green (#2E7D32), Secondary Orange (#FF6F00), Accent Blue (#0277BD)
- Spacing system 8px base
- PrimeNG theme: Lara Light Green

### Responsive Design
- Mobile-first approach
- Breakpoints: 576px, 768px, 1024px, 1440px
- Sidebar collassabile mobile con hamburger menu
- Card view mobile + table view desktop per liste
- Touch target minimo 44px (60px per autisti con guanti)

### Accessibilita (WCAG 2.1 AA)
- Contrasto colori 4.5:1 testo, 3:1 componenti UI
- Navigazione keyboard completa
- Skip-to-main-content link
- ARIA labels e landmarks semantici
- Focus ring visibile ad alto contrasto
- Screen reader support
- Testo leggibile a 200% zoom

### Componenti Riutilizzabili
- SkeletonLoader (card, table, stat, list)
- EmptyState con azione
- ErrorState con retry e supporto
- Layout con sidebar, header sticky, notification bell
- StatCard con trend e sparklines

---

## 6. Compliance Normativa

> ⚠️ Colonna "Stato" rivista 2026-06: molti "Completo" erano aspirazionali. Stato reale qui sotto.

| Normativa | Stato (reale 2026-06) |
|---|---|
| RENTRI (D.M. 59/2023) - Registro Elettronico Nazionale | 🔴 Mock-only (client verso localhost, nessuna API governativa reale, accreditamento non avviato) |
| D.Lgs. 152/2006 - Codice Ambiente | 🟠 Parziale |
| SPID Livello 2+ per firma digitale (CAD) | 🟠 Dev-only (Keycloak start-dev, no TLS) |
| RFC 3161 timestamp tokens | 🔴 Non implementato (firma ECDSA reale ma senza timestamp RFC 3161) |
| ECDSA-SHA256 firme crittografiche | 🟢 Reale (crypto Node P-256) |
| MUD reporting annuale | 🟠 Stub (recupero/smaltimento hardcoded a zero, manca `destinationType`) |
| Codici CER/EER classificazione rifiuti | 🟢 Presente (catalogo 842 codici) |
| GDPR (soft delete, data isolation, audit, encryption) | 🟠 Parziale (isolamento tenant non garantito: contesto rotto) |
| WCAG 2.1 AA accessibilita | 🟠 Parziale |

---

## 7. Stato Implementazione

> ⚠️ La lista "Fasi Completate (10/10)" e le "Metriche Codice" (coverage 85%+) sono **aspirazionali**. La fotografia veritiera è la §10 (analisi del codice sorgente) e [planning/ANALISI_E_PIANO_2026-06.md](./planning/ANALISI_E_PIANO_2026-06.md). Coverage reale: backend ~14%, frontend ~2%. Le metriche di performance non sono verificate.

### Fasi Completate (10/10) — *dichiarate, non verificate*
1. **Setup** (8 task): Docker, PostgreSQL, Redis, Keycloak, ambiente sviluppo
2. **Fondamenta** (21 task): NestJS, Prisma, Angular+PrimeNG, servizi core, auth guards
3. **Sync RENTRI** (27 task): Client API, BullMQ queue, retry logic, validazione, mock server
4. **Auth SPID** (29 task): Keycloak SPID/CIE, SAML 2.0, JWT, guards, componenti login
5. **Firme Digitali** (22 task): ECDSA-SHA256, workflow 3 stadi, verifica, QR code, RFC 3161
6. **Dashboard Analytics** (21 task): Metriche, grafici, export CSV, real-time
7. **Notifiche** (27 task): Email, in-app, preferenze, trigger event-driven
8. **Task Assignment** (frontend mobile-first per autisti)
9. **Permessi Temporanei** (27 task): Richiesta, approvazione, auto-revoca, audit
10. **Polish** (18 task): ABAC engine, Prometheus/Grafana, k6 load test, security hardening

### Metriche Codice
- **Test coverage**: ⚠️ dichiarato 85%+, **reale ~14% backend / ~2% frontend** (vedi §10)
- **Test cases**: ~48 spec backend, 2 spec frontend
- **Approccio**: TDD dichiarato; nella pratica copertura bassa
- **Performance**: target permission check <10ms, query <100ms, API p95 <200ms — *non verificati*

### Da Completare / Pianificato
- Prisma repositories concreti (parzialmente implementati)
- Frontend Angular: componenti avanzati (phase 2-4 UI/UX)
- App mobile Flutter/React Native (offline-first, firma touch, GPS tracking)
- AI features (CER suggestion GPT-4, assistente normativo, contract optimization)
- Marketplace B2B trasportatori
- Integrazioni ERP (Fatture in Cloud, TeamSystem, Zucchetti, SAP)
- IoT (bilance, sensori)
- PWA citizen app
- Dark mode
- i18n multilingua

---

## 8. Integrazioni Esterne

> ⚠️ Stato rivisto 2026-06: "Completato" su RENTRI/SPID/Keycloak è aspirazionale.

| Sistema | Stato | Protocollo |
|---|---|---|
| RENTRI (Registro Nazionale) | 🔴 Mock-only (no API reali) | REST + OAuth2 |
| SPID/CIE (Identita Digitale) | 🟠 Dev-only | SAML 2.0 |
| Keycloak | 🟠 Dev-only (start-dev, no TLS) | OIDC/SAML |
| AWS SES (Email) | Ready | SMTP |
| AWS S3 (Storage documenti) | Ready | SDK |
| Stripe (Pagamenti) | Pianificato | API REST |
| InfoCert/DocuSign (Firma digitale) | Pianificato | API REST |
| OpenAI GPT-4 (AI features) | Pianificato | API REST |
| Fatture in Cloud, TeamSystem (ERP) | Pianificato | API REST |
| Prometheus/Grafana (Monitoring) | Completato | Metrics endpoint |

---

## 9. Modello di Business

| Tier | Prezzo/mese | FIR inclusi | Target |
|---|---|---|---|
| FREE | 0 | 10 | Micro-imprese, trial |
| PRO | 49 | 100 | PMI |
| BUSINESS | 149 | 500 | Medie imprese |
| ENTERPRISE | Custom | Illimitati | Multi-site, white-label |

Add-ons: Mobile app inclusa, AI (PRO+), API (BUSINESS+), marketplace (commissione 10%), ERP (+29/mese), white-label (+499/mese).

---

## 10. Stato Attuale dell'Implementazione Software (Analisi Codice Sorgente)

> Analisi effettuata il 2026-02-22 tramite team di agenti LLM sul codice sorgente effettivo.

### Backend (apps/backend/src/)

| Metrica | Valore |
|---------|--------|
| File TypeScript totali | 335 |
| File produzione (.ts) | 292 |
| File test (.spec.ts) | 43 |
| Rapporto file con test | ~14.7% |

**Domain Layer (80 file)** - MATURO
- 3 Aggregati principali: FIR (state machine completa), User, RentriSyncLog
- Value Objects: Email, Quantita, FiscalCode, PartitaIva, CerCode, Indirizzo, SpidAttributes
- Entita Registry: Produttore, Trasportatore, Destinatario con repository interfaces
- Sistema IAM completo: Role, Permission, UserRole, ConsultantTenantAssociation, PermissionAuditLog, RoleChangeHistory, ResourceOwnership, TemporaryPermissionGrant
- ABAC Policy Engine: AbacPolicy entity + AbacPolicyEvaluator service
- Domain Events: FirSigned, FirSyncedToRentri, UserCreated
- Test coverage domain: ALTO (13 file test, copertura critica)

**Application Layer (102 file)** - PRODUCTION-READY
- FIR Use Cases CQRS: CreateFIR, EmettiFIR, PresaInCaricoFIR, ConfermaConsegna (comandi) + GetById, ListFirs (query)
- Registry: 15 use case CRUD (5 per entita x 3 entita)
- Auth: HandleSpidCallback, RefreshToken, GetSessionInfo, CheckSpidAuthStatus
- RENTRI: SyncFirToRentri, TriggerBatchSync, GetSyncStatus
- Firme Digitali: ApplySignature, VerifySignatures, SignatureAudit
- IAM: AssignRole, RevokeRole, CreateCustomRole, UpdateCustomRole, DeleteCustomRole, SwitchTenantContext, AssignTask, ReassignTask
- Permessi Temporanei: Request, Approve, Reject, Revoke
- Query IAM: GetUserPermissions, GetConsultantTenants, GetAuditTrail, GetAggregatedDashboard, ReconstructHistoricalPermissions
- Analytics: AnalyticsService, GetDashboard use case
- Notifiche: NotificationService, DeadlineChecker, NotificationEscalation
- MUD: MudGeneratorService
- Test coverage: 15 file test su percorsi critici

**API Layer (58 file)** - COMPLETO
- Controller FIR (v1 + v2), CER, Registry, Health, Auth (SPID), Digital Signatures
- Controller IAM: Roles, Permissions, Audit, TempPermissions, TaskAssignment
- Controller Dashboard, Notifications, MUD, PDF Export
- DTO con validazione class-validator
- Swagger/OpenAPI documentazione
- Guards: JwtAuth, SpidLevel, Permission, RateLimit, CSRF
- 6 file test

**Infrastructure (50+ file)** - IMPLEMENTATO
- Prisma repositories per tutte le entita
- RENTRI API client con retry
- PDF service (pdfmake)
- Email service (Nodemailer)
- BullMQ queue processors
- Redis cache service
- S3 storage service
- Keycloak integration

### Frontend (apps/frontend/src/)

| Metrica | Valore |
|---------|--------|
| File TypeScript totali | 96 |
| File test (.spec.ts) | 2 |
| Moduli feature | 8 |
| Componenti totali | ~45 |

**Core (26 file)** - COMPLETO
- Guards: auth.guard.ts, offline-high-risk.guard.ts
- Interceptors: auth (JWT), loading, error
- Layout: header, notification-bell, offline-indicator, tenant-selector
- Servizi: auth, dashboard, export, signature, qrcode, toast, error-handler, loading, connection-monitor, permission-sync-queue
- State (NgRx Signals): permission.store, role.store, offline-permission.store, temp-permission.store
- Cache permessi con TTL 5 min, formato resource:action:scope

**Features Implementate:**
1. **Auth** (4 componenti): Login, SPID Login, SPID Callback, SPID Reauth Modal
2. **Dashboard** (2 componenti): Dashboard analytics con KPI, grafici Chart.js, export CSV
3. **FIR** (7 componenti): Lista FIR con filtri, Firma digitale dialog, Status firma, Badge sync RENTRI, Log sync
4. **CER** (1 componente): Ricerca catalogo CER
5. **Registry** (4 componenti): Liste Produttori, Trasportatori, Destinatari (versioni enhanced)
6. **Notifications** (1 componente): Centro notifiche
7. **Verify** (1 componente): Verifica firme digitali
8. **Permissions** (29 file - modulo piu complesso): Role management, Custom role builder, Permission discovery, Audit trail viewer, Consultant dashboard, My grants, Pending grants, My assignments, Permission denied

**Shared (9 file):**
- Componenti: layout, loading, skeleton-loader, empty-state, error-state
- Modelli: fir.model, cer.model, registry.model

**Routes configurate:** 20+ route con lazy loading, auth guard, nested routing per permissions

**PrimeNG utilizzato estensivamente:** Table, Chart, Card, Dialog, Button, InputText, Dropdown, Tag, Calendar, Checkbox, ConfirmDialog, SplitButton, ProgressBar, Tooltip, Skeleton, Divider

### Valutazione Complessiva

| Area | Maturita | Note |
|------|----------|------|
| Domain Layer | Alto | DDD completo, buona copertura test |
| Application Layer | Alto | CQRS implementato, use case completi |
| API Layer | Alto | REST completa, Swagger, guards |
| Infrastructure | Medio-Alto | Tutti i servizi implementati, alcuni da integrare |
| Frontend Core | Alto | Auth, state management, layout completi |
| Frontend Features | Medio-Alto | Tutti i moduli presenti, test frontend quasi assenti |
| Test Backend | Medio | 43 file test su 292 produzione (~15%) |
| Test Frontend | Basso | Solo 2 file test su 96 (~2%) |

**Punti di forza:** Architettura DDD/CQRS solida, sistema IAM completo con ABAC, workflow FIR completo, integrazioni RENTRI/SPID/firme digitali.
**Aree di miglioramento:** Test coverage frontend, test integration/e2e, documentazione inline.

---

## 11. Comandi Sviluppo

```bash
npm install                  # Installazione dipendenze root
cd apps/backend && npm install  # Dipendenze backend
npm run start:dev            # Avvio sviluppo
npm test                     # Esegui test
npm run test:watch           # Test in watch mode (TDD)
npm run test:cov             # Report coverage
npm run lint                 # Linting
npm run prisma:generate      # Genera Prisma client
npm run prisma:migrate       # Esegui migrazioni DB
```

Health check: `GET /health`
Swagger docs: `GET /api/docs`
API base: `/api/v1/`

---

## 12. Repository

| Remote | URL |
|--------|-----|
| origin | http://github.local/Graziano/Wasteflow.git |
| github | https://github.com/Nexus6-IT/rifiuti.git |

Branch principale: `master`
Branch sviluppo: `develop`
