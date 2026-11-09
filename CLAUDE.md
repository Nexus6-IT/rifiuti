# rifiuti Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-10-30

## Active Technologies
- TypeScript 5.2+ (Backend: Node.js 20 LTS, Frontend: Angular 17) (001-production-ready-app)
- NestJS 10.3, Prisma 5.8, PostgreSQL 16, Redis 7 (001-production-ready-app)
- Angular 17 (standalone components), PrimeNG 17, NgRx 17 (001-production-ready-app)
- passport-saml (SPID/CIE authentication) (001-production-ready-app)
- BullMQ (background jobs), Socket.IO (WebSocket real-time), PDFKit (PDF export) (001-production-ready-app)
- Winston (logging), AWS SES (email) (001-production-ready-app)
- **Nessuno storage a oggetti**: `S3Service` e il job `pdf-generation` sono stati rimossi il 2026-09-09 perche' inerti (ne' produttore ne' consumatore). I PDF si generano al momento della richiesta e si scrivono nella risposta HTTP, senza coda e senza cache. Se servira' archiviazione documentale, va progettata come funzionalita', non ripristinata da qui.
- [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION] (002-roles-permissions-system)
- [if applicable, e.g., PostgreSQL, CoreData, files or N/A] (002-roles-permissions-system)

## Project Structure
```
apps/
  backend/         # NestJS API
    src/
      domain/      # DDD entities (TDD 100% coverage)
      application/ # Use cases (CQRS commands/queries)
      infrastructure/ # Repositories, external APIs
      api/         # REST controllers
  frontend/        # Angular 17
    src/app/
      core/        # Auth, tenant context
      features/    # Dashboard, FIR, notifications, admin
libs/              # Shared libraries (future)
specs/             # Feature specifications
```

## Commands
npm test; npm run lint; npm run test:watch; npm run start:dev

## Code Style
TypeScript 5.2+ (Backend: Node.js 20 LTS, Frontend: Angular 17): Follow standard conventions
- ESLint + Prettier (auto-format on save)
- Test-Driven Development (TDD) mandatory
- Domain-Driven Design (DDD) for business logic
- Multi-tenant: schema unico `public`, isolamento applicativo per `tenant_id` (estensione Prisma in `prisma-rls.extension.ts`). La RLS PostgreSQL vera NON esiste ancora: è in pianificazione (Fase 1)

## Recent Changes
- 002-roles-permissions-system: Added [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]
- 001-production-ready-app: Added RENTRI integration, SPID/CIE auth, digital signatures, analytics dashboard, notifications, MUD reporting, backups (2025-10-30)
- 001-production-ready-app: Added TypeScript 5.2+ (Backend: Node.js 20 LTS, Frontend: Angular 17) (2025-10-18)

<!-- MANUAL ADDITIONS START -->
## Moduli commerciali

- **Moduli commerciali chiusi nel backend.** Ogni controller nuovo dichiara il suo modulo con
  `@RichiedeModulo('<chiave>')` (classe o metodo; con piu' chiavi ne basta una) oppure sta in
  `BASE` di `api/controller-moduli.spec.ts` con un motivo scritto; una rotta pubblica dentro un
  controller di modulo va marcata `@SenzaModulo('<motivo>')`. Il controller va aggiunto a
  `MAPPA_MODULI` o `BASE` nello stesso commit: altrimenti la spec fallisce. Lato frontend la rotta
  nuova ha `canActivate: [moduloGuard]` e `data: { modulo }` (spec `rotte-moduli.spec.ts`). Un
  componente di una pagina di base (registro, FIR, dashboard) che chiama API di un modulo deve
  stare dietro `ff.has('<modulo>')`: senza, l'azienda TRIAL riceve 403.
<!-- MANUAL ADDITIONS END -->
