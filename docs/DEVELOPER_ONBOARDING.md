# WasteFlow Developer Onboarding Guide

**Welcome to the WasteFlow team!** 🎉

This guide will help you get up to speed with our codebase, development practices, and workflows.

---

## Table of Contents

1. [First Day Setup](#first-day-setup)
2. [Codebase Overview](#codebase-overview)
3. [Development Workflow](#development-workflow)
4. [Architecture & Patterns](#architecture--patterns)
5. [Testing Guidelines](#testing-guidelines)
6. [Code Style & Standards](#code-style--standards)
7. [Common Tasks](#common-tasks)
8. [Debugging Tips](#debugging-tips)
9. [Resources](#resources)

---

## First Day Setup

### Prerequisites

Install the following tools:

```bash
# Node.js 20 LTS (via nvm recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Verify installation
node --version  # Should be v20.x.x
npm --version   # Should be 10.x.x

# Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop

# PostgreSQL client (psql)
# macOS: brew install postgresql@16
# Ubuntu: sudo apt-get install postgresql-client-16
# Windows: Download from postgresql.org

# Redis client (optional, for debugging)
# macOS: brew install redis
# Ubuntu: sudo apt-get install redis-tools

# VS Code (recommended IDE)
# Download from: https://code.visualstudio.com/

# Git
git --version  # Should be >= 2.x
```

### Repository Setup

```bash
# 1. Clone repository
git clone git@github.com:wasteflow/wasteflow.git
cd wasteflow

# 2. Install dependencies
npm install

# 3. Setup environment
cp apps/backend/.env.example apps/backend/.env

# Edit .env with your local configuration
# Ask team lead for development database credentials if needed

# 4. Start infrastructure
docker-compose up -d

# Verify services are running
docker-compose ps
# Should see: postgres, redis, mailhog

# 5. Setup database
cd apps/backend
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:seed

# 6. Start development server
npm run start:dev

# Backend should be running on http://localhost:3000
# Open http://localhost:3000/health to verify
```

### VS Code Setup

Install recommended extensions:

```bash
# Open VS Code
code .

# Install extensions (will prompt automatically if .vscode/extensions.json exists)
# Or install manually:
# - ESLint
# - Prettier
# - Prisma
# - GitLens
# - REST Client
# - Docker
```

Configure settings:

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "jest.autoRun": "off"
}
```

### Verify Setup

```bash
# Run tests to verify everything works
npm test

# Expected output:
# PASS  src/domain/auth/entities/user.entity.spec.ts
# PASS  src/domain/fir/aggregates/fir.aggregate.spec.ts
# ...
# Tests:       142 passed, 142 total
# Time:        5.231 s
```

---

## Codebase Overview

### Project Structure

```
wasteflow/
├── apps/
│   ├── backend/                    # NestJS API (Your main focus)
│   │   ├── src/
│   │   │   ├── api/               # 📍 HTTP layer
│   │   │   │   ├── controllers/   # REST endpoints
│   │   │   │   ├── middleware/    # Request/response processing
│   │   │   │   ├── filters/       # Exception handling
│   │   │   │   └── guards/        # Authorization
│   │   │   ├── application/       # 📍 Use cases (CQRS)
│   │   │   │   ├── commands/      # State-changing operations
│   │   │   │   ├── queries/       # Read operations
│   │   │   │   └── events/        # Domain events
│   │   │   ├── domain/            # 📍 Business logic (DDD)
│   │   │   │   ├── fir/           # FIR aggregate
│   │   │   │   ├── identity-access/ # Users, roles, permissions
│   │   │   │   └── notifications/  # Notification domain
│   │   │   └── infrastructure/    # 📍 External concerns
│   │   │       ├── database/      # Prisma repositories
│   │   │       ├── caching/       # Redis caching
│   │   │       ├── logging/       # Winston logging
│   │   │       └── integrations/  # External APIs (RENTRI, etc.)
│   │   ├── prisma/
│   │   │   ├── schema.prisma      # Database schema
│   │   │   └── migrations/        # SQL migrations
│   │   └── test/                   # Integration tests
│   │
│   └── frontend/                   # Angular 17 (TODO for frontend devs)
│
├── docs/                           # Documentation
│   ├── OPERATIONS_RUNBOOK.md
│   ├── DEPLOYMENT_GUIDE.md
│   └── DEVELOPER_ONBOARDING.md (this file)
│
└── infrastructure/                 # Terraform IaC
```

### Key Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API Framework | NestJS 10.3 | Dependency injection, modularity |
| Database | PostgreSQL 16 | Primary data store |
| ORM | Prisma 5.8 | Type-safe database access |
| Cache | Redis 7 | Performance optimization |
| Queue | BullMQ | Background jobs |
| Testing | Jest | Unit & integration tests |
| API Docs | Swagger/OpenAPI | Auto-generated docs |
| Logging | Winston | Structured logging |

---

## Development Workflow

### Daily Workflow

```bash
# 1. Start your day - pull latest changes
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/add-fir-export

# 3. Start infrastructure
docker-compose up -d

# 4. Run backend in watch mode
cd apps/backend
npm run start:dev

# 5. Open separate terminal for tests
npm run test:watch

# 6. Make changes following TDD cycle:
# RED → Write failing test
# GREEN → Write minimal code to pass
# REFACTOR → Improve code quality

# 7. Commit frequently with conventional commits
git add .
git commit -m "feat(fir): add PDF export functionality

- Implement FIR PDF generation use case
- Add PDFService with template rendering
- Add tests for PDF generation
- Coverage: 95% lines, 90% branches"

# 8. Push and create PR
git push origin feature/add-fir-export
gh pr create --title "Add FIR PDF export" --body "Implements #123"
```

### Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) format:

```bash
# Format: <type>(<scope>): <subject>

# Types:
feat:     # New feature
fix:      # Bug fix
docs:     # Documentation only
style:    # Code style (formatting, no logic change)
refactor: # Code refactoring (no feature/fix)
test:     # Adding/updating tests
chore:    # Maintenance (deps, config, etc.)
perf:     # Performance improvement

# Examples:
git commit -m "feat(auth): implement SPID authentication"
git commit -m "fix(fir): correct quantity tolerance calculation"
git commit -m "docs(api): update OpenAPI spec for FIR endpoints"
git commit -m "refactor(domain): simplify FIR state machine"
git commit -m "test(fir): add integration tests for FIR workflow"
git commit -m "perf(db): add index on fir.tenant_id"
```

### Pull Request Process

1. **Create PR** with descriptive title and body
2. **Link issue**: "Closes #123" or "Fixes #456"
3. **Add reviewers**: At least 2 team members
4. **Wait for CI**: All tests must pass
5. **Address feedback**: Respond to comments, make changes
6. **Get approval**: 2+ approvals required
7. **Squash and merge**: Keep main branch clean

**PR Template**:
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests pass locally
```

---

## Architecture & Patterns

### Domain-Driven Design (DDD)

We follow **DDD principles** to model complex business logic:

#### Aggregates

Aggregates are clusters of domain objects with a single root entity:

```typescript
// apps/backend/src/domain/fir/fir.aggregate.ts

export class FIR extends AggregateRoot {
  private _status: FIRStatus;
  private _numeroProgressivo: string;
  private _cerCode: string;
  private _quantity: number;

  // Factory method for creation
  static create(props: CreateFIRProps): FIR {
    const fir = new FIR();
    fir._status = FIRStatus.BOZZA;
    // ... validation and initialization
    return fir;
  }

  // Business methods (state transitions)
  emetti(numeroProgressivo: string, firma: DigitalSignature): void {
    if (this._status !== FIRStatus.BOZZA) {
      throw new InvalidStateTransitionError('Can only emit FIR from BOZZA state');
    }
    this._status = FIRStatus.EMESSO;
    this._numeroProgressivo = numeroProgressivo;
    // Emit domain event
    this.addDomainEvent(new FIREmessoEvent(this.id, numeroProgressivo));
  }

  presaInCarico(date: Date, firma: DigitalSignature): void {
    if (this._status !== FIRStatus.EMESSO) {
      throw new InvalidStateTransitionError('Can only take charge from EMESSO state');
    }
    this._status = FIRStatus.IN_TRANSITO;
    this.addDomainEvent(new FIRPresaInCaricoEvent(this.id));
  }
}
```

#### Value Objects

Value Objects are immutable, self-validating:

```typescript
// apps/backend/src/domain/fir/value-objects/quantita.ts

export class Quantita {
  private readonly _value: number;
  private readonly _unita: UnitaMisura;

  private constructor(value: number, unita: UnitaMisura) {
    this._value = value;
    this._unita = unita;
  }

  static create(value: number, unita: UnitaMisura): Quantita {
    if (value <= 0) {
      throw new InvalidQuantitaError('Quantity must be positive');
    }
    return new Quantita(value, unita);
  }

  isWithinTolerance(actual: number): boolean {
    const tolerance = 0.10; // 10%
    const minAcceptable = this._value * (1 - tolerance);
    const maxAcceptable = this._value * (1 + tolerance);
    return actual >= minAcceptable && actual <= maxAcceptable;
  }

  getValue(): number {
    return this._value;
  }
}
```

### CQRS (Command Query Responsibility Segregation)

**Commands** change state, **Queries** read state:

```typescript
// apps/backend/src/application/commands/emetti-fir.command.ts

export class EmettiFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly numeroProgressivo: string,
    public readonly firma: DigitalSignature,
    public readonly userId: string,
  ) {}
}

// apps/backend/src/application/commands/handlers/emetti-fir.handler.ts

@CommandHandler(EmettiFIRCommand)
export class EmettiFIRCommandHandler {
  constructor(private readonly firRepository: FIRRepository) {}

  async execute(command: EmettiFIRCommand): Promise<void> {
    // Load aggregate
    const fir = await this.firRepository.findById(command.firId);

    // Execute business logic
    fir.emetti(command.numeroProgressivo, command.firma);

    // Persist
    await this.firRepository.save(fir);
  }
}
```

**Queries** are optimized for reads:

```typescript
// apps/backend/src/application/queries/list-firs.query.ts

export class ListFIRsQuery {
  constructor(
    public readonly tenantId: string,
    public readonly filters?: FIRFilters,
    public readonly pagination?: PaginationParams,
  ) {}
}

@QueryHandler(ListFIRsQuery)
export class ListFIRsQueryHandler {
  constructor(private readonly firRepository: FIRRepository) {}

  async execute(query: ListFIRsQuery): Promise<PaginatedResult<FIR>> {
    return this.firRepository.findMany(
      query.tenantId,
      query.filters,
      query.pagination,
    );
  }
}
```

### Repository Pattern

Repositories abstract data access:

```typescript
// apps/backend/src/domain/fir/fir.repository.ts

export interface FIRRepository {
  findById(id: string): Promise<FIR | null>;
  findByNumeroProgressivo(numero: string, tenantId: string): Promise<FIR | null>;
  findMany(tenantId: string, filters?: FIRFilters): Promise<FIR[]>;
  save(fir: FIR): Promise<void>;
  delete(id: string): Promise<void>;
}

// apps/backend/src/infrastructure/database/repositories/fir.repository.impl.ts

@Injectable()
export class PrismaFIRRepository implements FIRRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<FIR | null> {
    const record = await this.prisma.fIR.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async save(fir: FIR): Promise<void> {
    const data = this.toPersistence(fir);
    await this.prisma.fIR.upsert({
      where: { id: fir.id },
      update: data,
      create: data,
    });
  }

  private toDomain(record: PrismaFIR): FIR {
    // Map Prisma model to domain entity
  }

  private toPersistence(fir: FIR): PrismaFIRCreateInput {
    // Map domain entity to Prisma model
  }
}
```

---

## Testing Guidelines

### Test-Driven Development (TDD)

**TDD is mandatory** for all domain logic. Follow the RED-GREEN-REFACTOR cycle:

```typescript
// 1. RED: Write failing test
describe('FIR.emetti', () => {
  it('should transition from BOZZA to EMESSO', () => {
    const fir = FIR.create({ /* props */ });

    fir.emetti('FIR-2025-001', mockSignature);

    expect(fir.status).toBe(FIRStatus.EMESSO);
    expect(fir.numeroProgressivo).toBe('FIR-2025-001');
  });
});

// 2. GREEN: Write minimal code to pass
emetti(numeroProgressivo: string, firma: DigitalSignature): void {
  this._status = FIRStatus.EMESSO;
  this._numeroProgressivo = numeroProgressivo;
}

// 3. REFACTOR: Add validation, error handling
emetti(numeroProgressivo: string, firma: DigitalSignature): void {
  if (this._status !== FIRStatus.BOZZA) {
    throw new InvalidStateTransitionError('Cannot emit from current state');
  }
  if (!firma.isValid()) {
    throw new InvalidSignatureError('Invalid digital signature');
  }
  this._status = FIRStatus.EMESSO;
  this._numeroProgressivo = numeroProgressivo;
  this.addDomainEvent(new FIREmessoEvent(this.id));
}
```

### Testing Pyramid

```
        ┌─────────┐
        │   E2E   │  5% - Full system tests
        ├─────────┤
        │Integration│ 15% - API + Database
        ├─────────────┤
        │    Unit     │ 80% - Business logic
        └─────────────┘
```

**Coverage Targets**:
- Domain layer: **100%** (strictly enforced)
- Application layer: ≥90%
- Infrastructure layer: ≥70%
- Overall: ≥80%

### Unit Test Example

```typescript
// apps/backend/src/domain/auth/value-objects/email.spec.ts

describe('Email Value Object', () => {
  describe('create', () => {
    it('should create email with valid address', () => {
      const email = Email.create('test@example.com');

      expect(email.getValue()).toBe('test@example.com');
    });

    it('should throw error for invalid email format', () => {
      expect(() => Email.create('invalid-email')).toThrow(InvalidEmailError);
    });

    it('should normalize email to lowercase', () => {
      const email = Email.create('Test@Example.COM');

      expect(email.getValue()).toBe('test@example.com');
    });
  });

  describe('equals', () => {
    it('should return true for same email addresses', () => {
      const email1 = Email.create('test@example.com');
      const email2 = Email.create('test@example.com');

      expect(email1.equals(email2)).toBe(true);
    });
  });
});
```

### Integration Test Example

```typescript
// apps/backend/test/integration/fir.e2e-spec.ts

describe('FIR API (e2e)', () => {
  let app: INestApplication;
  let testData: TestData;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await cleanDatabase();
    testData = await seedTestData();
  });

  describe('POST /api/v1/fir', () => {
    it('should create FIR with valid data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/fir')
        .set('Authorization', `Bearer ${testData.adminToken}`)
        .send({
          cerCode: '170904',
          quantity: 5000,
          unit: 'kg',
          producerFacilityId: testData.facility.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
    });
  });
});
```

---

## Code Style & Standards

### TypeScript Best Practices

```typescript
// ✅ Good: Strong typing
interface CreateFIRDto {
  cerCode: string;
  quantity: number;
  unit: UnitaMisura;
  producerFacilityId: string;
}

function createFIR(dto: CreateFIRDto): FIR {
  return FIR.create(dto);
}

// ❌ Bad: Any types
function createFIR(dto: any): any {
  return FIR.create(dto);
}

// ✅ Good: Explicit return types
async findById(id: string): Promise<FIR | null> {
  // ...
}

// ❌ Bad: Implicit return types
async findById(id: string) {
  // TypeScript infers, but harder to read
}

// ✅ Good: Use strict null checks
function processUser(user: User | null): void {
  if (!user) {
    throw new UserNotFoundError();
  }
  // user is now User (not null)
  console.log(user.email);
}

// ❌ Bad: Unsafe null access
function processUser(user: User): void {
  console.log(user!.email); // Dangerous!
}
```

### Error Handling

```typescript
// ✅ Good: Custom domain errors
export class InvalidFIRStatusError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFIRStatusError';
  }
}

// Usage
if (fir.status !== FIRStatus.BOZZA) {
  throw new InvalidFIRStatusError('Cannot emit FIR from current status');
}

// ✅ Good: Try-catch for external calls
async syncToRentri(fir: FIR): Promise<void> {
  try {
    await this.rentriClient.sync(fir);
  } catch (error) {
    this.logger.error('RENTRI sync failed', error);
    throw new RentriSyncError('Failed to sync FIR to RENTRI', error);
  }
}
```

### Naming Conventions

```typescript
// Classes: PascalCase
export class FIRRepository { }
export class UserService { }

// Interfaces: PascalCase with "I" prefix (optional)
export interface FIRRepository { }
export interface IEmailService { }

// Functions/Methods: camelCase
function calculateTotal() { }
async function findUserById() { }

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_PAGE_SIZE = 50;

// Private fields: underscore prefix
class FIR {
  private _status: FIRStatus;
  private _numeroProgressivo: string;
}

// Enums: PascalCase
enum FIRStatus {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
}
```

---

## Common Tasks

### Adding a New Feature

**Example: Add FIR PDF export**

```bash
# 1. Create feature branch
git checkout -b feature/fir-pdf-export

# 2. Write domain tests (TDD - RED)
# apps/backend/src/domain/fir/services/pdf-generator.service.spec.ts
describe('PDFGeneratorService', () => {
  it('should generate PDF from FIR', () => {
    // Write test first
  });
});

# 3. Implement domain logic (TDD - GREEN)
# apps/backend/src/domain/fir/services/pdf-generator.service.ts
export class PDFGeneratorService {
  generate(fir: FIR): Buffer {
    // Minimal implementation
  }
}

# 4. Add use case
# apps/backend/src/application/commands/export-fir-pdf.command.ts
# apps/backend/src/application/commands/handlers/export-fir-pdf.handler.ts

# 5. Add API endpoint
# apps/backend/src/api/fir/fir.controller.ts
@Get(':id/export/pdf')
async exportPDF(@Param('id') id: string): Promise<StreamableFile> {
  const command = new ExportFIRPDFCommand(id);
  const pdf = await this.commandBus.execute(command);
  return new StreamableFile(pdf);
}

# 6. Add integration test
# apps/backend/test/integration/fir-export.e2e-spec.ts

# 7. Update documentation
# Update apps/backend/src/api/openapi.config.ts
# Update docs/API.md

# 8. Commit and push
git add .
git commit -m "feat(fir): add PDF export functionality"
git push origin feature/fir-pdf-export
```

### Running Database Migrations

```bash
# Create new migration
npm run prisma:migrate:dev --name add_fir_export_timestamp

# Apply migrations (development)
npm run prisma:migrate:dev

# Apply migrations (production)
npm run prisma:migrate:deploy

# Reset database (WARNING: deletes all data)
npm run prisma:migrate:reset

# View migration status
npm run prisma:migrate:status

# Generate Prisma Client after schema changes
npm run prisma:generate
```

### Debugging

```bash
# Run with debugger attached
npm run start:debug

# In VS Code, add breakpoint and attach debugger:
# Run > Start Debugging (F5)

# View logs
docker-compose logs -f backend

# Query database directly
psql $DATABASE_URL
# Or use Prisma Studio GUI
npm run prisma:studio
```

---

## Debugging Tips

### Common Issues

#### Issue: "Cannot find module '@prisma/client'"

**Solution**:
```bash
npm run prisma:generate
```

#### Issue: "Port 3000 already in use"

**Solution**:
```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9

# Or change port in .env
PORT=3001
```

#### Issue: Database connection failed

**Solution**:
```bash
# Check database is running
docker-compose ps

# Restart database
docker-compose restart postgres

# Verify connection string in .env
DATABASE_URL="postgresql://user:pass@localhost:5432/wasteflow_dev"
```

### Useful Commands

```bash
# View all running containers
docker-compose ps

# View logs
docker-compose logs -f

# Restart service
docker-compose restart backend

# Execute command in container
docker-compose exec postgres psql -U wasteflow

# Clear Redis cache
docker-compose exec redis redis-cli FLUSHALL

# View database schema
npm run prisma:studio
```

---

## Resources

### Internal Documentation

- [Operations Runbook](./OPERATIONS_RUNBOOK.md) - Production operations guide
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - How to deploy to production
- [API Documentation](http://localhost:3000/api/docs) - Swagger/OpenAPI docs

### External Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Domain-Driven Design](https://martinfowler.com/tags/domain%20driven%20design.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)

### Team Contacts

- Tech Lead: tech-lead@wasteflow.it
- Backend Team: backend@wasteflow.it
- DevOps: devops@wasteflow.it
- Slack: #engineering channel

---

## Next Steps

Now that you're set up, here are some good first tasks:

1. **Read the codebase**: Start with `apps/backend/src/domain/fir/fir.aggregate.ts`
2. **Run tests**: `npm run test:watch` and see how TDD works
3. **Pick a starter task**: Ask team lead for a "good first issue"
4. **Pair program**: Schedule pairing session with senior dev
5. **Review PRs**: Start reviewing others' code to learn patterns

**Welcome aboard! 🚀**

---

*Last updated: 2025-11-01*
*Questions? Ask in #engineering or DM the tech lead*
