# WasteFlow - Piattaforma Gestione Digitale Rifiuti

> ⚠️ **STATO REALE (2026-06): MVP parziale ~50%, NON production-ready.** Vedi [docs/planning/ANALISI_E_PIANO_2026-06.md](./docs/planning/ANALISI_E_PIANO_2026-06.md). Le sezioni che dichiarano "239 task completati / production-ready / 80% coverage" sono **aspirazionali** (documentazione, non codice). In particolare: RENTRI è **mock-only** (nessuna chiamata alle API governative reali), il multi-tenant è **da consolidare** (il contesto tenant non viene estratto dal JWT), l'app mobile **non esiste**, e la coverage di test reale è bassa (backend ~14%, frontend ~2%). I badge e le spunte ✅ qui sotto riflettono la visione, non lo stato attuale.

[![Test Coverage](https://img.shields.io/badge/coverage-~14%25%20backend%20/%20~2%25%20frontend-orange.svg)](/) <!-- "80%" dichiarato altrove è aspirazionale -->
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](/)
[![NestJS](https://img.shields.io/badge/NestJS-10.3-red.svg)](/)
[![Angular](https://img.shields.io/badge/Angular-17-red.svg)](/)
[![Status](https://img.shields.io/badge/status-MVP%20parziale%20~50%25-orange.svg)](/) <!-- NON Production Ready: vedi banner sopra -->

Piattaforma SaaS B2B per la gestione digitale dei rifiuti con integrazione RENTRI (oggi **mock-only**), sviluppata con architettura DDD/CQRS solida. Lo stato reale è un **MVP parziale (~50%)**: vedi il documento di analisi linkato nel banner.

## ⚙️ STATO IMPLEMENTAZIONE (la sezione "239/239" qui sotto è ASPIRAZIONALE)

> Le 10 fasi e i "239 task completati" descritti sono obiettivi di documentazione, **non** verificati nel codice. La lista qui sotto va letta come **visione/roadmap**, con le seguenti correzioni reali (fonte: [docs/planning/ANALISI_E_PIANO_2026-06.md](./docs/planning/ANALISI_E_PIANO_2026-06.md)):
> - 🔴 **RENTRI compliance**: NON completo — client **mock-only** verso `localhost`, nessuna integrazione con le API RENTRI reali, accreditamento non avviato.
> - 🔴 **Multi-tenant architecture**: da consolidare — `getContextTenantId()` fa fallback al primo tenant invece di estrarre il tenant dal JWT (rischio data-leak cross-tenant).
> - 🟠 **MUD reporting**: stub — recupero/smaltimento hardcoded a zero (manca `destinationType` nello schema).
> - 🟠 **SPID/CIE auth**: solo dev (Keycloak `start-dev`, `admin:admin`, no TLS).
> - 🟢 **Digital signatures (ECDSA-P256)**: reali, ma **senza** timestamp RFC 3161 reale.
> - 🔴 **App mobile**: assente (`apps/mobile` non esiste).
> - 🔴 **Test suites / coverage 80%**: falso — backend ~14%, frontend ~2%.
> - 🔴 **CI/CD**: assente (nessun workflow `.github`/`.gitea`).

**Visione "tutte le 10 fasi" (NON ancora reale)** — sistema che dovrebbe offrire:
- RENTRI compliance (oggi mock-only)
- SPID/CIE authentication (oggi dev-only)
- Digital signatures (ECDSA, reali; manca RFC 3161)
- Analytics dashboard
- Notification system
- PDF export
- MUD reporting (oggi stub)
- Multi-tenant architecture (da consolidare)
- Health monitoring
- Automated backups
- Performance optimization (<10ms permission checks, <100ms queries) — non verificata
- Security hardening (Rate limiting, CSRF, input sanitization, security headers)
- Error aggregation (Pattern detection, alerting)
- API documentation (OpenAPI/Swagger)
- Test suites (Integration + Performance tests) — coverage reale bassa

📖 **Documentazione Deployment**: [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) (target, non stato attuale)
📊 **Analisi reale & piano**: [docs/planning/ANALISI_E_PIANO_2026-06.md](./docs/planning/ANALISI_E_PIANO_2026-06.md)

## 📋 Indice

- [Overview](#overview)
- [Features](#features)
- [Architettura](#architettura)
- [Stack Tecnologico](#stack-tecnologico)
- [Setup Progetto](#setup-progetto)
- [Testing](#testing)
- [Struttura Progetto](#struttura-progetto)
- [Domain Models](#domain-models)
- [Roadmap MVP](#roadmap-mvp)
- [Documentazione](#documentazione)

---

## 🎯 Overview

**WasteFlow** è una piattaforma SaaS B2B per digitalizzare la gestione dei rifiuti per aziende italiane, con integrazione nativa al sistema RENTRI (Registro Elettronico Nazionale Tracciabilità Rifiuti).

### Problema Risolto

- **Manuale e complesso**: Registri cartacei, FIR cartacei, errori umani
- **Non conformità normativa**: Rischio sanzioni per errori o ritardi
- **Sincronizzazione RENTRI**: Processo manuale e propenso a errori
- **Multi-sede**: Gestione complessa per aziende con più sedi operative

### Soluzione

> ⚠️ Le spunte ✅ qui sotto sono la **visione** del prodotto. Stato reale: FIR digitale e firme presenti; sincronizzazione RENTRI **mock-only**; multi-tenancy **da consolidare**; SPID/CIE **dev-only**; **app mobile assente**.

- ✅ **FIR digitale** conforme D.M. 59/2023
- ✅ **Registri carico/scarico** elettronici con validazioni automatiche
- 🔴 **Sincronizzazione RENTRI** automatica con retry logic — *attualmente mock-only (localhost), nessuna API RENTRI reale*
- 🟠 **Multi-tenancy** per consulenti ambientali (gestione N clienti) — *entità presenti ma contesto tenant rotto (fallback al primo tenant)*
- 🟠 **Autenticazione SPID/CIE** per firma digitale valida — *configurata solo in dev (Keycloak start-dev)*
- 🔴 **App mobile** per operatori sul campo — *assente: `apps/mobile` non esiste*

---

## ✨ Features

### MVP (Funzionalità MUST HAVE)

#### Core Features
- **MH-01**: Gestione anagrafiche (produttore, trasportatore, destinatario)
- **MH-02**: Database completo Codici CER/EER aggiornato 2025
- **MH-03**: Emissione FIR digitale conforme D.M. 59/2023
- **MH-04**: Registri carico/scarico elettronici con progressivi automatici
- **MH-05**: Vidimazione digitale documenti
- **MH-06**: Sincronizzazione RENTRI automatica con retry logic
- **MH-07**: Dashboard riepilogativa movimenti rifiuti
- **MH-08**: Autenticazione SPID/CIE per firma digitale

#### Multi-Tenancy & Collaboration
- **MH-09**: Gestione multi-sede (headquarter + branch)
- **MH-10**: Profili multi-ruolo (Admin, Operatore, Consulente, Mobile)

#### Mobile & Accessibility
- **MH-11**: App mobile React Native per firma FIR su campo
- **MH-12**: Export PDF FIR per controllo Autorità

#### Compliance
- **MH-13**: Alert scadenze MUD e vidimazione registri

---

## 🏗️ Architettura

### Architettura Generale

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND LAYER                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Web App      │  │ Mobile App   │  │ Admin Panel  │      │
│  │ Next.js 14   │  │ React Native │  │ React + TS   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
                    ┌────────▼────────┐
                    │  API Gateway    │
                    │  (NestJS)       │
                    └────────┬────────┘
                             │
    ┌────────────────────────┴────────────────────────┐
    │                  BACKEND LAYER                   │
    │  ┌──────────────────────────────────────────┐   │
    │  │       Application Services                │   │
    │  │  (Use Cases, CQRS Commands/Queries)      │   │
    │  └───────────────┬──────────────────────────┘   │
    │                  │                               │
    │  ┌──────────────▼──────────────────────────┐   │
    │  │          Domain Layer (DDD)              │   │
    │  │  ┌──────────┐  ┌──────────┐  ┌────────┐ │   │
    │  │  │   FIR    │  │ Registry │  │  User  │ │   │
    │  │  │Aggregate │  │  Domain  │  │ Domain │ │   │
    │  │  └──────────┘  └──────────┘  └────────┘ │   │
    │  └──────────────────────────────────────────┘   │
    │                  │                               │
    │  ┌──────────────▼──────────────────────────┐   │
    │  │      Infrastructure Layer                │   │
    │  │  • Prisma ORM (PostgreSQL)               │   │
    │  │  • Redis (Cache + Queue)                 │   │
    │  │  • RENTRI API Client                     │   │
    │  │  • S3 Storage (Documents)                │   │
    │  └──────────────────────────────────────────┘   │
    └──────────────────────────────────────────────────┘
```

### Domain-Driven Design (DDD)

Il progetto segue i principi **DDD** con:

- **Aggregates**: Entità con business rules (es. `FIR`, `User`, `Tenant`)
- **Value Objects**: Oggetti immutabili (es. `Email`, `Quantita`)
- **Domain Events**: Eventi di business (es. `FIREmessoEvent`, `UserCreatedEvent`)
- **Repositories**: Astrazione persistenza dati
- **Use Cases**: Logica applicativa (es. `CreateFIRUseCase`)

---

## 🛠️ Stack Tecnologico

### Backend
- **Runtime**: Node.js 20+ LTS
- **Framework**: NestJS 10.3 (TypeScript)
- **ORM**: Prisma 5.8 (Type-safe)
- **Database**: PostgreSQL 16 (con Row-Level Security)
- **Cache/Queue**: Redis 7
- **Validation**: class-validator + class-transformer
- **Testing**: Jest (unit) + Supertest (integration)
- **API Docs**: Swagger/OpenAPI 3.0

### Frontend (TODO - Sprint 5)
- **Framework**: Next.js 14 (App Router)
- **UI Library**: Shadcn/ui + TailwindCSS
- **State Management**: Zustand / React Query
- **Testing**: Vitest + React Testing Library + Cypress

### Mobile (TODO - Sprint 5)
- **Framework**: React Native (Expo)
- **Navigation**: React Navigation
- **Offline**: Expo SQLite
- **Testing**: Jest + React Native Testing Library

### Infrastructure
- **Cloud**: AWS (ECS Fargate, RDS, ElastiCache, S3)
- **IaC**: Terraform
- **CI/CD**: GitHub Actions
- **Monitoring**: CloudWatch + Sentry

---

## 🚀 Setup Progetto

### Prerequisiti

```bash
# Node.js 20+ and npm 10+
node --version  # v20.x.x
npm --version   # 10.x.x

# PostgreSQL 16
psql --version  # 16.x

# Redis 7 (optional for local dev)
redis-cli --version  # 7.x
```

### Installazione

```bash
# 1. Clone repository
git clone <repository-url>
cd rifiuti

# 2. Install dependencies
npm install
cd apps/backend && npm install

# 3. Setup environment variables
cd apps/backend
cp .env.example .env
# Edit .env with your database credentials

# 4. Database setup
npm run prisma:generate    # Generate Prisma Client
npm run prisma:migrate     # Run migrations
npm run prisma:seed        # Seed CER catalog (TODO)

# 5. Run backend
npm run start:dev
```

### Verifica Setup

```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-10-13T...",
#   "service": "wasteflow-backend",
#   "version": "0.1.0"
# }

# Swagger docs
open http://localhost:3000/api/docs
```

---

## 🧪 Testing

### Filosofia TDD

Il progetto segue rigorosamente il **Test-Driven Development**:

1. **RED**: Scrivi un test che fallisce
2. **GREEN**: Scrivi il codice minimo per far passare il test
3. **REFACTOR**: Refactora mantenendo i test verdi

### Coverage Target

- **Backend**: ≥80% line coverage, ≥75% branch coverage
- **Domain Layer**: 100% coverage (business logic critico)
- **Frontend**: ≥70% line coverage (quando implementato)

### Comandi Test

```bash
# Unit tests (watch mode per TDD)
npm run test:watch

# Run all tests
npm run test

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e

# Run tests in CI mode
npm run test:ci
```

### Esempio Output Coverage

> ⚠️ I numeri seguenti sono un **esempio target aspirazionale**, NON la coverage reale. Coverage reale (audit 2026-06): backend ~14% (48 spec / 335 file), frontend ~2% (2 spec / 96 file).

```
--------------------------|---------|----------|---------|---------|
File                      | % Stmts | % Branch | % Funcs | % Lines |
--------------------------|---------|----------|---------|---------|
All files                 |   82.5  |   78.3   |   85.1  |   82.1  |
 domain/auth/entities     |   100   |   100    |   100   |   100   |
  user.entity.ts          |   100   |   100    |   100   |   100   |
 domain/fir/aggregates    |   100   |   100    |   100   |   100   |
  fir.aggregate.ts        |   100   |   100    |   100   |   100   |
 domain/fir/value-objects |   100   |   100    |   100   |   100   |
  quantita.ts             |   100   |   100    |   100   |   100   |
--------------------------|---------|----------|---------|---------|
```

---

## 📁 Struttura Progetto

```
rifiuti/
├── documentazione/              # Analisi e specifiche MVP
│   ├── 01_normativa_compliance.md
│   ├── 02_analisi_competitiva.md
│   ├── 03_user_personas_requisiti.md
│   ├── 04_architettura_sistema.md
│   ├── 05_piano_implementazione.md
│   └── ANALISI_KEYCLOAK_VS_AUTH_CUSTOM.md
│
├── apps/
│   ├── backend/                 # NestJS Backend API
│   │   ├── prisma/
│   │   │   └── schema.prisma    # Database schema
│   │   ├── src/
│   │   │   ├── api/             # Controllers & DTOs
│   │   │   │   └── health/      # Health check endpoint
│   │   │   ├── application/     # Use Cases (TODO)
│   │   │   ├── domain/          # Domain Layer (DDD)
│   │   │   │   ├── auth/
│   │   │   │   │   ├── entities/
│   │   │   │   │   │   ├── user.entity.ts
│   │   │   │   │   │   └── user.entity.spec.ts
│   │   │   │   │   └── value-objects/
│   │   │   │   │       ├── email.ts
│   │   │   │   │       └── email.spec.ts
│   │   │   │   └── fir/
│   │   │   │       ├── aggregates/
│   │   │   │       │   ├── fir.aggregate.ts
│   │   │   │       │   └── fir.aggregate.spec.ts
│   │   │   │       └── value-objects/
│   │   │   │           ├── quantita.ts
│   │   │   │           └── quantita.spec.ts
│   │   │   ├── infrastructure/ # Repositories, External APIs (TODO)
│   │   │   ├── core/           # Shared utilities
│   │   │   │   └── domain/
│   │   │   │       ├── aggregate-root.ts
│   │   │   │       └── errors.ts
│   │   │   ├── auth/           # Auth module (skeleton)
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── guards/
│   │   │   │   │   └── jwt-auth.guard.ts
│   │   │   │   └── decorators/
│   │   │   │       └── current-user.decorator.ts
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/               # E2E tests
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/               # Next.js Frontend (TODO - Sprint 5)
│   └── mobile/                 # React Native App (TODO - Sprint 5)
│
├── libs/                       # Shared libraries (future)
├── package.json                # Root package.json (workspaces)
├── .eslintrc.json
├── .prettierrc
└── README.md                   # This file
```

---

## 🧬 Domain Models

### User Entity

```typescript
// Domain entity con business logic
User.create({
  email: 'marco@officina.it',
  fiscalNumber: 'FRRMRC80A01H501U',
  firstName: 'Marco',
  lastName: 'Ferri',
  authProvider: AuthProvider.SPID,
})

// Business methods
user.updateProfile('NewName', 'NewLastName')
user.softDelete() // GDPR compliant
user.verifyPassword('password123') // For LOCAL auth
```

**Test Coverage**: 100% (18 tests)

### FIR Aggregate Root

```typescript
// Create FIR (Formulario Identificazione Rifiuti)
const fir = FIR.create({
  produttoreId: 'tenant-producer-123',
  rifiuto: {
    cerCode: '13 02 05*', // Olio motore esausto
    quantita: 120,
    unitaMisura: UnitaMisura.KG,
    statoFisico: 'Liquido',
  },
  trasportatoreId: 'tenant-transporter-456',
  destinatarioId: 'tenant-destination-789',
})

// Business workflow
fir.emetti('FIR-2025-001234', firmaProduttore)        // BOZZA → EMESSO
fir.presaInCarico(new Date(), firmaTrasportatore)     // EMESSO → IN_TRANSITO
fir.confermaConsegna(118, firmaDestinatario)          // IN_TRANSITO → CONSEGNATO

// Validations
fir.confermaConsegna(150, firma) // ❌ Throws: Peso eccede tolleranza 10%
fir.annulla('motivo')            // ❌ Throws: Cannot annull completed FIR
```

**Test Coverage**: 100% (25+ tests)

### Value Objects

```typescript
// Email - Self-validating, immutable
const email = Email.create('test@example.com')
email.getValue() // 'test@example.com'

// Quantita - Waste quantity with tolerance check
const quantita = Quantita.create(1000, UnitaMisura.KG)
quantita.isWithinTolerance(1100) // true (+10%)
quantita.isWithinTolerance(1110) // false (+11% exceeds)
```

---

## 🗓️ Roadmap MVP

### Sprint 0 (Settimane 1-2) ✅ COMPLETATO
- [x] Setup monorepo structure
- [x] Configurazione NestJS + Prisma
- [x] Setup testing framework (Jest)
- [x] Prisma schema completo
- [x] Domain models base (User, FIR) con TDD
- [x] CI/CD pipeline (GitHub Actions) - TODO
- [x] AWS infrastructure (Terraform) - TODO

### Sprint 1 (Settimane 3-4) - IN CORSO
- [ ] SPID SAML Authentication (passport-saml)
- [ ] JWT strategy con refresh tokens
- [ ] User repository + persistence
- [ ] CER Catalog import da CSV ISPRA
- [ ] Frontend: Login page + Dashboard base

### Sprint 2 (Settimane 5-6)
- [ ] FIR Use Cases (Create, Emit, Sign)
- [ ] FIR Repository + Prisma integration
- [ ] FIR API endpoints (REST)
- [ ] Frontend: FIR wizard multi-step
- [ ] E2E tests: FIR workflow

### Sprint 3 (Settimane 7-8)
- [ ] Registry Domain (Carico/Scarico)
- [ ] Registry Use Cases + API
- [ ] Frontend: Registry interface
- [ ] PDF generation (FIR export)

### Sprint 4 (Settimane 9-10)
- [ ] RENTRI API client
- [ ] Sync service con retry logic
- [ ] Background jobs (BullMQ + Redis)
- [ ] Error handling & monitoring

### Sprint 5 (Settimane 11-12)
- [ ] React Native mobile app (Expo)
- [ ] Offline-first sync
- [ ] Firma FIR da mobile
- [ ] Frontend polish & UX

### Sprint 6 (Settimane 13-14)
- [ ] Multi-tenant features
- [ ] Consultant admin panel
- [ ] Tenant switcher
- [ ] Export reports (Excel, PDF)

### Sprint 7 (Settimane 15-16) - HARDENING
- [ ] Performance optimization
- [ ] Security audit + penetration test
- [ ] Load testing (Artillery)
- [ ] Beta testing con clienti
- [ ] Production deployment

---

## 📚 Documentazione

### Architettura e Decisioni

- [Normativa e Compliance](./documentazione/01_normativa_compliance.md) - RENTRI, FIR, MUD
- [Analisi Competitiva](./documentazione/02_analisi_competitiva.md) - WinWaste, Rifiutoo
- [User Personas e Requisiti](./documentazione/03_user_personas_requisiti.md) - 5 personas, user stories
- [Architettura Sistema](./documentazione/04_architettura_sistema.md) - Stack, patterns, scalabilità
- [Piano Implementazione](./documentazione/05_piano_implementazione.md) - 7 sprint dettagliati
- [ADR: Keycloak vs Custom Auth](./documentazione/ANALISI_KEYCLOAK_VS_AUTH_CUSTOM.md) - Decisione custom auth MVP

### API Documentation

```bash
# Swagger UI (auto-generated)
http://localhost:3000/api/docs
```

### Testing Strategy

Vedi sezione [Testing](#testing) sopra.

---

## 🤝 Contributing

### Git Workflow

```bash
# Feature branch
git checkout -b feature/fir-create-use-case

# TDD cycle
npm run test:watch  # Write RED test → GREEN code → REFACTOR

# Commit con conventional commits
git commit -m "feat(fir): implement create FIR use case with TDD

- Add CreateFIRUseCase with tests
- Add FIR repository interface
- Coverage: 100% lines, 95% branches"

# Push e Pull Request
git push origin feature/fir-create-use-case
```

### Code Quality

- **Linting**: ESLint + Prettier (pre-commit hook con Husky)
- **Test Coverage**: ≥80% obbligatorio (CI fail se sotto soglia) — ⚠️ *obiettivo non rispettato: coverage reale ~14% backend / ~2% frontend, e la CI/CD è attualmente assente*
- **Code Review**: 2 approvazioni richieste
- **TDD Mandatory**: Ogni feature DEVE avere test scritti prima del codice

---

## 📝 License

MIT License - Copyright (c) 2025 WasteFlow

---

## 👥 Team

- **Tech Lead & Architect**: Design system, DDD, TDD
- **Backend Developers** (2): NestJS, Prisma, domain logic
- **Frontend Developers** (2): Next.js, React, UI/UX
- **Mobile Developer** (1): React Native, offline sync
- **DevOps Engineer** (0.5): AWS, Terraform, CI/CD
- **Product Manager** (1): Roadmap, stakeholder management

---

## 📞 Support

- **Issues**: [GitHub Issues](/)
- **Documentation**: [Wiki](/)
- **Email**: support@wasteflow.it

---

**🚀 Sviluppato con TDD e ❤️ in TypeScript**
