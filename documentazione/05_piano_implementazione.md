# PIANO DI IMPLEMENTAZIONE DETTAGLIATO - MVP WASTEFLOW
## Approccio TDD-Driven, 3.5 Mesi, Team 5-7 Developer

**Versione:** 1.0
**Data:** 13 Ottobre 2025
**Metodologia:** Test-Driven Development + Scrum (Sprint 2 settimane)
**Target:** 13 Funzionalita MUST HAVE, MVP Production-Ready

---

## EXECUTIVE SUMMARY

**Timeframe:** 14 settimane (8 sprint da 2 settimane, ultimo sprint ridotto)
**Team Composition:** 2 Backend + 2 Frontend + 1 Mobile + 1 DevOps (50%) + 1 PM
**Velocity Stimata:** 40 story points/sprint (team 5-7 dev)
**Approccio:** RED-GREEN-REFACTOR rigoroso, zero feature senza test

**Priorita Strategica:**
1. Sprint 0: Infrastruttura + Tooling TDD
2. Sprint 1-3: Core Domain (FIR + Registry) con coverage >80%
3. Sprint 4-5: RENTRI Integration + E2E flows
4. Sprint 6-7: Hardening, Performance, Security Audit

**Definition of Done Globale:**
- Unit test coverage ≥80% (backend), ≥70% (frontend)
- Integration test per ogni use case
- E2E test per flussi critici (Cypress/Playwright)
- Code review approvato da 2 dev
- API documentata OpenAPI 3.0
- Deployment staging OK + smoke test passato

---

## 1. ROADMAP SPRINT - VISTA SINTETICA

| Sprint | Settimane | Focus Funzionale | Story Points | Rischio | Dipendenze |
|--------|-----------|------------------|--------------|---------|------------|
| **0** | 1-2 | Setup Infra, CI/CD, Test Framework | 25 | ALTO | Nessuna |
| **1** | 3-4 | Auth SPID, Anagrafiche, CER Catalog | 42 | MEDIO | Sprint 0 |
| **2** | 5-6 | FIR Domain (Create, Sign, Track) | 45 | ALTO | Sprint 0,1 |
| **3** | 7-8 | Registry Domain (Carico/Scarico) | 40 | MEDIO | Sprint 2 |
| **4** | 9-10 | RENTRI Sync + Retry Logic | 38 | ALTO | Sprint 2,3 |
| **5** | 11-12 | Frontend Dashboard + FIR Wizard | 43 | MEDIO | Sprint 1,2 |
| **6** | 13-14 | Export PDF, Multi-tenant, Polish | 35 | BASSO | Sprint 2-5 |
| **7** | 15-16 | Performance Tuning, Security Audit, Beta | 32 | MEDIO | Tutti |

**Totale Story Points:** 300 (media 37.5/sprint, compatibile con velocity 40)

---

## 2. SPRINT 0 - FONDAMENTA E TOOLING (Settimane 1-2)

### OBIETTIVI SPRINT
- Infrastruttura AWS operativa
- Pipeline CI/CD con test automatici
- Framework testing configurato
- Boilerplate NestJS + Next.js + React Native
- Team allineato su best practice TDD

### TASK BREAKDOWN DETTAGLIATO

#### TASK 0.1: Setup Repository e Monorepo (M - 8 SP)
**Owner:** DevOps Engineer
**Description:** Configurare monorepo NX con workspace structure per backend, frontend, mobile.

**TDD Approach:**
```bash
# Test infrastruttura workspace
npm run test:workspaces  # Verifica build isolato di ogni package
```

**Acceptance Criteria:**
- [ ] Monorepo NX configurato con 3 workspaces: `apps/backend`, `apps/frontend`, `apps/mobile`
- [ ] Shared libraries: `libs/domain`, `libs/dtos`, `libs/utils`
- [ ] TypeScript strict mode abilitato
- [ ] ESLint + Prettier configurato con rules condivise
- [ ] Pre-commit hooks (Husky) per lint + test su staged files

**File coinvolti:**
- `nx.json`, `package.json`, `tsconfig.base.json`
- `.husky/pre-commit`, `.eslintrc.json`

**Rischi:** MEDIO - NX learning curve per team
**Mitigazione:** Workshop 2h su NX fundamentals

---

#### TASK 0.2: Setup AWS Infrastructure con Terraform (L - 13 SP)
**Owner:** DevOps Engineer
**Description:** Provisioning ambiente DEV con Terraform: VPC, RDS PostgreSQL, ElastiCache Redis, S3, ECS.

**TDD Approach:**
```hcl
# Terraform test con localstack
resource "null_resource" "infra_test" {
  provisioner "local-exec" {
    command = "pytest terraform_tests/"  # Verifica risorse create
  }
}
```

**Acceptance Criteria:**
- [ ] VPC con subnet pubbliche/private configurate
- [ ] RDS PostgreSQL 16 (db.t4g.medium) con backup automatici
- [ ] ElastiCache Redis 7 (cache.t4g.small)
- [ ] S3 bucket con encryption SSE-S3 abilitato
- [ ] ECS Cluster + ALB + Target Group
- [ ] Secrets Manager per credenziali DB/Redis
- [ ] CloudWatch log groups per ogni servizio
- [ ] Terraform state su S3 + DynamoDB lock

**File coinvolti:**
- `terraform/environments/dev/main.tf`
- `terraform/modules/vpc/`, `terraform/modules/rds/`

**Rischi:** ALTO - Costi AWS se mal dimensionato
**Mitigazione:** Budget alert a 500€/mese, terraform cost estimation pre-apply

---

#### TASK 0.3: CI/CD Pipeline con GitHub Actions (M - 8 SP)
**Owner:** DevOps Engineer + Backend Lead
**Description:** Pipeline multi-stage: lint, test, build, deploy staging.

**TDD Approach:**
```yaml
# .github/workflows/ci.yml - Job test obbligatorio
test:
  runs-on: ubuntu-latest
  steps:
    - run: npm run test:ci
    - run: npm run test:e2e
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        fail_ci_if_error: true  # FAIL se coverage <80%
```

**Acceptance Criteria:**
- [ ] Pipeline triggered su PR + push main
- [ ] Stage 1: Lint (ESLint, Prettier check)
- [ ] Stage 2: Unit test con coverage report (fail se <80%)
- [ ] Stage 3: Integration test con DB testcontainer
- [ ] Stage 4: Build Docker image + push ECR
- [ ] Stage 5: Deploy staging ECS (solo se main branch)
- [ ] Stage 6: Smoke test staging endpoint
- [ ] Slack notification su failure

**File coinvolti:**
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- `Dockerfile.backend`, `Dockerfile.frontend`

**Rischi:** MEDIO - GitHub Actions minutes limit
**Mitigazione:** Self-hosted runner se supera 2000 min/mese

---

#### TASK 0.4: Setup Testing Framework Backend (M - 5 SP)
**Owner:** Backend Lead
**Description:** Configurare Jest + Supertest + Testcontainers per unit/integration test.

**TDD Approach:**
```typescript
// apps/backend/test/setup.integration.ts
describe('Testing Infrastructure', () => {
  it('should connect to testcontainer PostgreSQL', async () => {
    const container = await new PostgreSqlContainer().start()
    const db = await prisma.$connect()
    expect(db).toBeDefined()
  })
})
```

**Acceptance Criteria:**
- [ ] Jest configurato con TypeScript support
- [ ] Testcontainers PostgreSQL per integration test
- [ ] Mock Redis per unit test (ioredis-mock)
- [ ] Factory pattern per test data generation (factory-bot)
- [ ] Snapshot testing per DTO validation
- [ ] Coverage threshold enforced: 80% line, 75% branch
- [ ] Parallel test execution abilitato

**File coinvolti:**
- `apps/backend/jest.config.js`
- `apps/backend/test/factories/`, `test/helpers/`

**Effort:** 3 giorni

---

#### TASK 0.5: Setup Testing Framework Frontend (M - 5 SP)
**Owner:** Frontend Lead
**Description:** Configurare Vitest + Testing Library + Cypress per test React.

**TDD Approach:**
```typescript
// apps/frontend/src/components/Button.test.tsx
describe('Button Component', () => {
  it('should render and handle click', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click Me</Button>)
    fireEvent.click(screen.getByText('Click Me'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

**Acceptance Criteria:**
- [ ] Vitest configurato per unit test (piu veloce di Jest)
- [ ] React Testing Library per component test
- [ ] MSW (Mock Service Worker) per API mocking
- [ ] Cypress per E2E test
- [ ] Visual regression testing con Percy/Chromatic (opzionale MVP)
- [ ] Coverage threshold: 70% line

**File coinvolti:**
- `apps/frontend/vitest.config.ts`
- `apps/frontend/cypress.config.ts`
- `apps/frontend/src/mocks/handlers.ts`

**Effort:** 3 giorni

---

#### TASK 0.6: Boilerplate NestJS con Prisma ORM (M - 8 SP)
**Owner:** Backend Lead
**Description:** Setup NestJS app con moduli base, Prisma schema, auth guards, logging.

**TDD Approach:**
```typescript
// apps/backend/src/health/health.controller.spec.ts
describe('HealthController', () => {
  it('GET /health should return 200 with status OK', async () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', timestamp: expect.any(String) })
  })
})
```

**Acceptance Criteria:**
- [ ] NestJS app con struttura moduli DDD (domain folders)
- [ ] Prisma ORM configurato con PostgreSQL
- [ ] Migration system setup (prisma migrate)
- [ ] Global exception filter con error logging
- [ ] Request logging middleware (Morgan/Winston)
- [ ] HealthCheck endpoint `/health` con DB probe
- [ ] Swagger OpenAPI 3.0 auto-generation
- [ ] JWT auth guard skeleton (implementazione Sprint 1)

**File coinvolti:**
- `apps/backend/src/main.ts`, `prisma/schema.prisma`
- `apps/backend/src/core/filters/`, `src/core/guards/`

**Effort:** 4 giorni

---

#### TASK 0.7: Boilerplate Next.js 14 con App Router (M - 5 SP)
**Owner:** Frontend Lead
**Description:** Setup Next.js con TailwindCSS, Shadcn/ui, autenticazione client-side.

**TDD Approach:**
```typescript
// apps/frontend/app/page.test.tsx
describe('Homepage', () => {
  it('should render hero section', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('WasteFlow')
  })
})
```

**Acceptance Criteria:**
- [ ] Next.js 14 App Router configurato
- [ ] TailwindCSS + Shadcn/ui components installati
- [ ] Layout condiviso (navbar, footer)
- [ ] Auth context con JWT storage (localStorage)
- [ ] API client axios con interceptors
- [ ] Error boundary React per gestione errori
- [ ] Environment variables configuration (.env.local)

**File coinvolti:**
- `apps/frontend/app/layout.tsx`, `tailwind.config.js`
- `apps/frontend/lib/api-client.ts`, `lib/auth-context.tsx`

**Effort:** 3 giorni

---

#### TASK 0.8: Boilerplate React Native con Expo (S - 3 SP)
**Owner:** Mobile Developer
**Description:** Setup React Native Expo app con navigazione e offline storage.

**TDD Approach:**
```typescript
// apps/mobile/src/components/LoginScreen.test.tsx
describe('LoginScreen', () => {
  it('should navigate to dashboard on successful login', async () => {
    const { getByText } = render(<LoginScreen />)
    fireEvent.press(getByText('Accedi'))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Dashboard'))
  })
})
```

**Acceptance Criteria:**
- [ ] Expo managed workflow configurato
- [ ] React Navigation setup (stack navigator)
- [ ] Expo SQLite per offline storage
- [ ] Axios per API calls
- [ ] AsyncStorage per token JWT
- [ ] Splash screen + app icon placeholder
- [ ] Jest configurato con @testing-library/react-native

**File coinvolti:**
- `apps/mobile/app.json`, `App.tsx`
- `apps/mobile/src/navigation/`, `src/services/storage.ts`

**Effort:** 2 giorni

---

### DEFINITION OF DONE SPRINT 0
- [ ] Tutti i task completati e merged su `main`
- [ ] Pipeline CI passa tutti gli stage (green build)
- [ ] Staging environment accessibile con health check OK
- [ ] Documentazione setup local dev nel README
- [ ] Team training TDD completato (workshop 4h)
- [ ] Sprint review demo: "Hello World" deployato su staging

---

## 3. SPRINT 1 - AUTENTICAZIONE E DOMINI BASE (Settimane 3-4)

### OBIETTIVI SPRINT
- Autenticazione SPID integrata (mock + stub reale)
- Dominio Anagrafiche (Azienda, User, Tenant)
- Catalogo CER importato e ricercabile
- Dashboard utente base (login + home)

**Story Points:** 42 SP
**Rischio:** MEDIO - SPID integration complessita

### FUNZIONALITA TARGET
- MH-01: Gestione anagrafiche (produttore, trasportatore, destinatario)
- MH-02: Database completo Codici CER/EER aggiornato
- MH-08: Autenticazione SPID/CIE per firma digitale (stub MVP)

---

### TASK 1.1: Test e Implementazione Modello User/Tenant (S - 3 SP)

**TDD RED:**
```typescript
// apps/backend/src/domain/auth/user.entity.spec.ts
describe('User Entity', () => {
  it('should create user with valid email', () => {
    const user = User.create({ email: 'test@example.com', role: UserRole.ADMIN })
    expect(user.email).toBe('test@example.com')
  })

  it('should throw error for invalid email', () => {
    expect(() => User.create({ email: 'invalid', role: UserRole.ADMIN }))
      .toThrow('Invalid email format')
  })

  it('should hash password on creation', () => {
    const user = User.create({ email: 'test@example.com', password: 'plain123' })
    expect(user.password).not.toBe('plain123')
    expect(user.password).toMatch(/^\$2[aby]\$/)  // bcrypt hash format
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/domain/auth/user.entity.ts
export class User {
  private constructor(
    public id: string,
    public email: string,
    public password: string,
    public role: UserRole,
    public tenants: UserTenant[]
  ) {}

  static create(props: CreateUserProps): User {
    if (!this.isValidEmail(props.email)) {
      throw new InvalidEmailError()
    }
    const hashedPassword = bcrypt.hashSync(props.password, 10)
    return new User(uuid(), props.email, hashedPassword, props.role, [])
  }

  private static isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
}
```

**TDD REFACTOR:**
- Estrarre validazione email in Value Object `Email`
- Estrarre hashing password in `PasswordHasher` service

**Acceptance Criteria:**
- [ ] User entity con validazioni
- [ ] Tenant entity con multi-tenancy support
- [ ] UserTenant junction table per RBAC
- [ ] Prisma schema aggiornato + migration
- [ ] Unit test coverage 100%

**File:** `src/domain/auth/user.entity.ts`, `prisma/schema.prisma`
**Effort:** 1 giorno

---

### TASK 1.2: SPID SAML Authentication con JWT Custom (M - 8 SP)

**Context:** Implementazione Custom Auth SPID come da ADR-004. SPID SAML 2.0 direct integration con `passport-saml`, JWT custom con refresh token strategy.

**TDD RED:**
```typescript
// apps/backend/src/auth/spid/spid.strategy.spec.ts
describe('SPIDStrategy', () => {
  it('should validate SPID SAML assertion and extract attributes', async () => {
    const mockProfile = {
      fiscalNumber: 'RSSMRA80A01H501U',
      name: 'Mario',
      familyName: 'Rossi',
      email: 'mario.rossi@example.com',
      spidCode: 'https://www.spid.gov.it/SpidL2'
    }

    const strategy = new SPIDStrategy()
    const result = await strategy.validate(mockProfile)

    expect(result.fiscalNumber).toBe('RSSMRA80A01H501U')
    expect(result.email).toBe('mario.rossi@example.com')
  })

  it('should reject SAML assertion with invalid signature', async () => {
    const tamperedAssertion = mockSAMLAssertion({ validSignature: false })

    await expect(strategy.validate(tamperedAssertion))
      .rejects.toThrow('Invalid SAML signature')
  })
})

// apps/backend/src/auth/auth.service.spec.ts
describe('AuthService', () => {
  it('should find or create user from SPID attributes', async () => {
    const spidUser = { fiscalNumber: 'RSSMRA80A01H501U', name: 'Mario', familyName: 'Rossi', email: 'mario@test.it' }

    const user = await authService.findOrCreateUser(spidUser)

    expect(user.fiscalNumber).toBe('RSSMRA80A01H501U')
    expect(user.authProvider).toBe('SPID')
  })

  it('should generate JWT with tenantId and permissions', async () => {
    const user = await createTestUser({ role: 'ADMIN', tenantId: 'tenant-123' })

    const tokens = await authService.generateTokens(user, 'tenant-123')

    const decoded = jwtService.verify(tokens.accessToken)
    expect(decoded.tenantId).toBe('tenant-123')
    expect(decoded.role).toBe('ADMIN')
    expect(decoded.permissions).toContain('fir:*')
  })

  it('should store refresh token in Redis with TTL', async () => {
    const user = await createTestUser()

    const tokens = await authService.generateTokens(user)

    const stored = await redis.get(`refresh:${user.id}:${tokens.refreshToken}`)
    expect(stored).toBeDefined()
    expect(JSON.parse(stored).userId).toBe(user.id)
  })

  it('should refresh access token from valid refresh token', async () => {
    const { refreshToken } = await createValidTokens()

    const newTokens = await authService.refreshTokens(refreshToken)

    expect(newTokens.accessToken).toBeDefined()
    const decoded = jwtService.verify(newTokens.accessToken)
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000)
  })

  it('should reject expired refresh token', async () => {
    const expiredToken = createExpiredRefreshToken()

    await expect(authService.refreshTokens(expiredToken))
      .rejects.toThrow('Invalid refresh token')
  })
})

// Integration test
describe('POST /auth/spid/callback', () => {
  it('should authenticate user and return JWT tokens', async () => {
    const mockSAMLResponse = generateValidSAMLResponse({
      fiscalNumber: 'RSSMRA80A01H501U',
      name: 'Mario',
      familyName: 'Rossi'
    })

    return request(app.getHttpServer())
      .post('/auth/spid/callback')
      .send({ SAMLResponse: mockSAMLResponse })
      .expect(302)  // Redirect to dashboard
      .expect(res => {
        expect(res.headers.location).toContain('/dashboard?token=')
      })
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/auth/strategies/spid.strategy.ts
import { Strategy } from 'passport-saml'
import { PassportStrategy } from '@nestjs/passport'

@Injectable()
export class SPIDStrategy extends PassportStrategy(Strategy, 'spid') {
  constructor() {
    super({
      callbackUrl: process.env.SPID_CALLBACK_URL,
      entryPoint: process.env.SPID_ENTRY_POINT,
      issuer: process.env.SPID_ISSUER,
      privateCert: process.env.SPID_PRIVATE_KEY,
      cert: process.env.SPID_PUBLIC_CERT,
      identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
      authnContext: process.env.SPID_AUTHN_CONTEXT,
      attributeConsumingServiceIndex: '1'
    })
  }

  async validate(profile: any): Promise<SPIDUser> {
    return {
      fiscalNumber: profile.fiscalNumber,
      name: profile.name,
      familyName: profile.familyName,
      email: profile.email || `${profile.fiscalNumber}@noemail.wasteflow.it`,
      spidLevel: profile.spidCode
    }
  }
}

// apps/backend/src/auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private redis: Redis
  ) {}

  async findOrCreateUser(spidUser: SPIDUser): Promise<User> {
    let user = await this.prisma.user.findUnique({
      where: { fiscalNumber: spidUser.fiscalNumber }
    })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          fiscalNumber: spidUser.fiscalNumber,
          email: spidUser.email,
          firstName: spidUser.name,
          lastName: spidUser.familyName,
          authProvider: 'SPID',
          spidLevel: spidUser.spidLevel
        }
      })
    }

    return user
  }

  async generateTokens(user: User, tenantId?: string): Promise<Tokens> {
    const tenant = tenantId || user.defaultTenantId

    const userTenant = await this.prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant } }
    })

    if (!userTenant) {
      throw new UnauthorizedException('User not authorized for this tenant')
    }

    const payload = {
      sub: user.id,
      email: user.email,
      fiscalNumber: user.fiscalNumber,
      tenantId: tenant,
      role: userTenant.role,
      permissions: this.getPermissions(userTenant.role)
    }

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' })
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '7d' }
    )

    await this.redis.setex(
      `refresh:${user.id}:${refreshToken}`,
      7 * 24 * 60 * 60,
      JSON.stringify({ userId: user.id, tenantId: tenant })
    )

    return { accessToken, refreshToken }
  }

  private getPermissions(role: Role): string[] {
    const permissionsMap = {
      ADMIN: ['fir:*', 'registry:*', 'user:*', 'tenant:*'],
      OPERATOR: ['fir:create', 'fir:read', 'fir:update', 'registry:read', 'registry:write'],
      VIEWER: ['fir:read', 'registry:read'],
      CONSULTANT_ADMIN: ['fir:*', 'registry:*', 'tenant:read', 'tenant:switch'],
      MOBILE_OPERATOR: ['fir:read', 'fir:sign', 'fir:update-status']
    }
    return permissionsMap[role] || []
  }

  async refreshTokens(refreshToken: string): Promise<Tokens> {
    const payload = this.jwtService.verify(refreshToken)
    const stored = await this.redis.get(`refresh:${payload.sub}:${refreshToken}`)

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token')
    }

    const { userId, tenantId } = JSON.parse(stored)
    const user = await this.prisma.user.findUnique({ where: { id: userId } })

    return this.generateTokens(user, tenantId)
  }
}

// apps/backend/src/auth/auth.controller.ts
@Controller('auth')
export class AuthController {
  @Get('spid/login')
  @UseGuards(AuthGuard('spid'))
  spidLogin() {
    // Passport redirect automatico
  }

  @Post('spid/callback')
  @UseGuards(AuthGuard('spid'))
  async spidCallback(@Req() req, @Res() res) {
    const spidUser = req.user
    const user = await this.authService.findOrCreateUser(spidUser)

    if (!user.defaultTenantId) {
      return res.redirect('/onboarding/select-tenant')
    }

    const tokens = await this.authService.generateTokens(user)
    return res.redirect(`/dashboard?token=${tokens.accessToken}`)
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken)
  }
}
```

**TDD REFACTOR:**
- Estrarre permission logic in `PermissionService`
- Migrare JWT config in `JwtConfigService`
- Implementare `TokenBlacklistService` per logout
- Add rate limiting su `/auth/*` endpoints (10 req/min per IP)

**Acceptance Criteria:**
- [ ] SPID SAML 2.0 strategy con `passport-saml`
- [ ] SAML metadata XML generato automaticamente
- [ ] Mock SPID IDP per test environment (TestID simulator)
- [ ] JWT access token (1h) + refresh token (7d)
- [ ] Refresh tokens stored in Redis con TTL
- [ ] Permission-based authorization (RBAC con 5 ruoli)
- [ ] Controller endpoints: GET `/auth/spid/login`, POST `/auth/spid/callback`, POST `/auth/refresh`
- [ ] JWT Guard per protected routes
- [ ] Permissions Guard per granular access control
- [ ] Multi-tenant context switch endpoint POST `/auth/tenant/switch`
- [ ] PostgreSQL RLS context set automatico da JWT
- [ ] Integration test con mock SAML Response
- [ ] Unit test coverage >85%
- [ ] Environment variables validation con `@nestjs/config`

**File Structure:**
```
src/auth/
├── strategies/
│   ├── spid.strategy.ts
│   └── jwt.strategy.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   └── permissions.guard.ts
├── decorators/
│   ├── permissions.decorator.ts
│   └── current-user.decorator.ts
├── auth.service.ts
├── auth.controller.ts
├── auth.module.ts
└── __tests__/
    ├── spid.strategy.spec.ts
    ├── auth.service.spec.ts
    ├── auth.controller.spec.ts (integration)
    └── permissions.guard.spec.ts
```

**Environment Variables (.env.dev):**
```bash
# SPID Configuration (Mock for dev)
SPID_ENTRY_POINT=http://localhost:8080/samlsso
SPID_CALLBACK_URL=http://localhost:3000/auth/spid/callback
SPID_ISSUER=wasteflow-dev
SPID_PRIVATE_KEY=./certs/sp-private-key.pem
SPID_PUBLIC_CERT=./certs/sp-certificate.pem
SPID_AUTHN_CONTEXT=https://www.spid.gov.it/SpidL2

# JWT Configuration
JWT_SECRET=dev-secret-change-in-production-256-bits
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=wasteflow.it
JWT_AUDIENCE=wasteflow-api

# Redis (for refresh tokens)
REDIS_URL=redis://localhost:6379
```

**SPID Test Tools:**
- SPID TestID Provider: https://github.com/italia/spid-testenv2
- SAML Tracer browser extension per debug
- SAML metadata validator: https://www.samltool.com/validate_xml.php

**Security Checklist:**
- [ ] SAML assertions signed con certificato registrato AgID
- [ ] HTTPS obbligatorio (TLS 1.3) in production
- [ ] JWT secret rotated ogni 90 giorni (AWS Secrets Manager)
- [ ] Refresh token revocation su logout
- [ ] Rate limiting 10 req/min su auth endpoints
- [ ] Audit log ogni autenticazione (successo/fallimento)
- [ ] No sensitive data in JWT payload (no password, no PII oltre fiscalNumber)

**File:** `src/auth/`, `src/auth/strategies/spid.strategy.ts`, `src/auth/auth.service.ts`
**Effort:** 4 giorni (2 giorni SPID SAML, 1.5 giorni JWT strategy, 0.5 giorni testing)
**Rischio:** ALTO - SPID complessita SAML, mitigato con SPID TestEnv in Sprint 0

**Dependencies:**
- Task 0.6: NestJS boilerplate
- Task 1.1: User/Tenant models
- SPID Test Environment setup (parallel Sprint 0)

**ADR Reference:** ADR-004 - Custom Auth MVP vs Keycloak

---

### TASK 1.3: Catalogo CER - Import e Test Search (M - 5 SP)

**TDD RED:**
```typescript
// apps/backend/src/domain/cer/cer-catalog.service.spec.ts
describe('CERCatalogService', () => {
  it('should import CER codes from CSV', async () => {
    const service = new CERCatalogService(mockRepository)
    await service.importFromCSV('cer_catalog_2025.csv')
    const count = await mockRepository.count()
    expect(count).toBe(842)  // Numero totale CER 2025
  })

  it('should search CER by keyword', async () => {
    const results = await service.search('olio motore')
    expect(results).toHaveLength(3)
    expect(results[0].code).toBe('13 02 05*')
    expect(results[0].description).toContain('oli minerali per motori')
  })

  it('should filter CER pericolosi', async () => {
    const results = await service.search('olio', { pericoloso: true })
    expect(results.every(cer => cer.code.endsWith('*'))).toBe(true)
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/domain/cer/cer-catalog.service.ts
export class CERCatalogService {
  async importFromCSV(filePath: string): Promise<void> {
    const records = await csv().fromFile(filePath)
    await this.repository.createMany(records.map(r => ({
      code: r.code,
      description: r.description,
      isPericoloso: r.code.endsWith('*'),
      category: r.category,
    })))
  }

  async search(keyword: string, filters?: CERFilters): Promise<CERCode[]> {
    const query = this.repository.createQueryBuilder('cer')
      .where('cer.description ILIKE :keyword', { keyword: `%${keyword}%` })

    if (filters?.pericoloso !== undefined) {
      query.andWhere('cer.isPericoloso = :pericoloso', { pericoloso: filters.pericoloso })
    }

    return query.orderBy('cer.code', 'ASC').getMany()
  }
}
```

**Acceptance Criteria:**
- [ ] CER CSV import script da file ufficiale ISPRA
- [ ] Full-text search PostgreSQL su `description`
- [ ] Index GIN per performance search
- [ ] Filtri: pericoloso, categoria
- [ ] API endpoint: GET `/api/cer/search?q=olio&pericoloso=true`
- [ ] Seed database con 842 CER codes
- [ ] Unit + integration test con testcontainer

**File:** `src/domain/cer/`, `prisma/seeds/cer_catalog_2025.csv`
**Effort:** 2.5 giorni

---

### TASK 1.4: Frontend - Login con SPID + Dashboard Home (M - 8 SP)

**TDD RED:**
```typescript
// apps/frontend/src/features/auth/LoginPage.test.tsx
describe('LoginPage', () => {
  it('should redirect to SPID IDP on button click', async () => {
    render(<LoginPage />)
    const spidButton = screen.getByRole('button', { name: /Accedi con SPID/i })
    fireEvent.click(spidButton)

    await waitFor(() => {
      expect(window.location.href).toContain('/auth/spid/login')
    })
  })

  it('should handle SPID callback and store JWT', async () => {
    const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    mockApiClient.post.mockResolvedValue({ data: { accessToken: mockToken } })

    render(<SPIDCallbackPage />)

    await waitFor(() => {
      expect(localStorage.getItem('access_token')).toBe(mockToken)
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })
})
```

**TDD GREEN:**
```typescript
// apps/frontend/src/features/auth/LoginPage.tsx
export function LoginPage() {
  const handleSPIDLogin = () => {
    window.location.href = `${API_URL}/auth/spid/login`
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card>
        <CardHeader>
          <CardTitle>Accedi a WasteFlow</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleSPIDLogin} className="w-full">
            <img src="/spid-logo.svg" alt="SPID" className="mr-2 h-5" />
            Accedi con SPID
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Acceptance Criteria:**
- [ ] Login page con SPID button
- [ ] SPID callback handler con JWT storage
- [ ] Auth context con token refresh
- [ ] Dashboard home con navbar + user menu
- [ ] Protected routes con auth guard
- [ ] Component test con MSW per API mocking
- [ ] E2E test Cypress: login flow completo

**File:** `src/features/auth/`, `src/app/dashboard/page.tsx`
**Effort:** 4 giorni

---

### DEFINITION OF DONE SPRINT 1
- [ ] User puo autenticarsi con SPID mock
- [ ] Dashboard home accessibile post-login
- [ ] CER catalog ricercabile via API
- [ ] Test coverage: Backend 82%, Frontend 71%
- [ ] E2E test: Login + Dashboard navigation
- [ ] Deployment staging OK

---

## 4. SPRINT 2 - CORE DOMAIN: FIR MANAGEMENT (Settimane 5-6)

### OBIETTIVI SPRINT
- Dominio FIR completo con business logic
- Creazione FIR digitale con validazioni
- Firma digitale stub (InfoCert mock)
- Stati FIR e transizioni

**Story Points:** 45 SP (sprint critico)
**Rischio:** ALTO - Complessita dominio + firma digitale

### FUNZIONALITA TARGET
- MH-03: Emissione FIR digitale conforme D.M. 59/2023
- MH-05: Vidimazione digitale documenti

---

### TASK 2.1: FIR Aggregate Root - Domain Model (M - 8 SP)

**TDD RED:**
```typescript
// apps/backend/src/domain/fir/fir.aggregate.spec.ts
describe('FIR Aggregate', () => {
  it('should create FIR in BOZZA state', () => {
    const fir = FIR.create({
      produttoreId: 'tenant-123',
      rifiuto: { cer: '13 02 05*', quantita: 120, unitaMisura: 'kg' },
      trasportatoreId: 'transp-456',
      destinatarioId: 'dest-789',
    })
    expect(fir.stato).toBe(FIRStato.BOZZA)
    expect(fir.numeroProgressivo).toBeNull()
  })

  it('should emit FIR and assign progressive number', () => {
    const fir = FIR.create(validFIRProps)
    fir.emetti('FIR-2025-001234')

    expect(fir.stato).toBe(FIRStato.EMESSO)
    expect(fir.numeroProgressivo).toBe('FIR-2025-001234')
    expect(fir.domainEvents).toContainEqual(
      new FIREmessoEvent(fir.id, fir.numeroProgressivo)
    )
  })

  it('should not allow emissione without firma produttore', () => {
    const fir = FIR.create(validFIRProps)
    expect(() => fir.emetti('FIR-2025-001234'))
      .toThrow('FIR requires produttore signature before emission')
  })

  it('should transition to IN_TRANSITO on presa in carico', () => {
    const fir = createEmessedFIR()
    fir.presaInCarico(new Date(), mockFirmaTrasportatore)

    expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
    expect(fir.dataPresaCarico).toBeDefined()
  })

  it('should validate peso consegnato within 10% tolerance', () => {
    const fir = createInTransitoFIR({ quantitaDichiarata: 1000 })
    expect(() => fir.confermaConsegna(1200, mockFirmaDestinatario))
      .toThrow('Peso consegnato eccede tolleranza 10%')
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/domain/fir/fir.aggregate.ts
export class FIR extends AggregateRoot {
  private constructor(
    public readonly id: string,
    public produttoreId: string,
    public rifiuto: FIRRifiuto,
    public stato: FIRStato,
    public numeroProgressivo?: string,
    public firme?: FirmeDigitali,
    private events: DomainEvent[] = []
  ) { super() }

  static create(props: CreateFIRProps): FIR {
    return new FIR(
      uuid(),
      props.produttoreId,
      FIRRifiuto.create(props.rifiuto),
      FIRStato.BOZZA
    )
  }

  emetti(numeroProgressivo: string): void {
    if (!this.firme?.produttore) {
      throw new DomainError('FIR requires produttore signature')
    }
    this.stato = FIRStato.EMESSO
    this.numeroProgressivo = numeroProgressivo
    this.addDomainEvent(new FIREmessoEvent(this.id, numeroProgressivo))
  }

  presaInCarico(data: Date, firma: FirmaDigitale): void {
    if (this.stato !== FIRStato.EMESSO) {
      throw new DomainError('Invalid state transition')
    }
    this.stato = FIRStato.IN_TRANSITO
    this.dataPresaCarico = data
    this.firme.trasportatore = firma
    this.addDomainEvent(new FIRPresaInCaricoEvent(this.id))
  }

  confermaConsegna(pesoEffettivo: number, firma: FirmaDigitale): void {
    const tolerance = this.rifiuto.quantita.valore * 0.1
    if (Math.abs(pesoEffettivo - this.rifiuto.quantita.valore) > tolerance) {
      throw new DomainError('Peso consegnato eccede tolleranza 10%')
    }
    this.stato = FIRStato.CONSEGNATO
    this.pesoEffettivo = pesoEffettivo
    this.firme.destinatario = firma
    this.addDomainEvent(new FIRConsegnatoEvent(this.id))
  }
}
```

**Acceptance Criteria:**
- [ ] FIR aggregate con invarianti business
- [ ] Stati FIR: BOZZA, EMESSO, IN_TRANSITO, CONSEGNATO, ANNULLATO
- [ ] Domain events per ogni transizione
- [ ] Value Objects: FIRRifiuto, Quantita, FirmeDigitali
- [ ] Unit test coverage 100% aggregate
- [ ] No Prisma/DB dependency (pure domain)

**File:** `src/domain/fir/fir.aggregate.ts`, `src/domain/fir/value-objects/`
**Effort:** 4 giorni

---

### TASK 2.2: FIR Repository + Persistence (S - 5 SP)

**TDD RED:**
```typescript
// apps/backend/src/domain/fir/fir.repository.spec.ts (Integration Test)
describe('FIRRepository', () => {
  let repository: FIRRepository
  let prisma: PrismaClient

  beforeAll(async () => {
    const container = await new PostgreSqlContainer().start()
    prisma = new PrismaClient({ datasourceUrl: container.getConnectionString() })
    repository = new FIRPrismaRepository(prisma)
  })

  it('should persist FIR aggregate', async () => {
    const fir = FIR.create(validProps)
    await repository.save(fir)

    const retrieved = await repository.findById(fir.id)
    expect(retrieved.id).toBe(fir.id)
    expect(retrieved.stato).toBe(FIRStato.BOZZA)
  })

  it('should update FIR state', async () => {
    const fir = await createAndSaveFIR()
    fir.emetti('FIR-2025-001')
    await repository.save(fir)

    const updated = await repository.findById(fir.id)
    expect(updated.stato).toBe(FIRStato.EMESSO)
    expect(updated.numeroProgressivo).toBe('FIR-2025-001')
  })

  it('should find FIRs by tenant and stato', async () => {
    await createMultipleFIRs({ tenantId: 'tenant-1', count: 5 })
    const results = await repository.findByTenant('tenant-1', { stato: FIRStato.BOZZA })
    expect(results).toHaveLength(5)
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts
export class FIRPrismaRepository implements FIRRepository {
  constructor(private prisma: PrismaClient) {}

  async save(fir: FIR): Promise<void> {
    await this.prisma.fir.upsert({
      where: { id: fir.id },
      create: this.toDataModel(fir),
      update: this.toDataModel(fir),
    })
  }

  async findById(id: string): Promise<FIR | null> {
    const data = await this.prisma.fir.findUnique({ where: { id } })
    return data ? this.toDomainModel(data) : null
  }

  private toDataModel(fir: FIR): Prisma.FirCreateInput {
    return {
      id: fir.id,
      tenantId: fir.produttoreId,
      stato: fir.stato,
      numeroProgressivo: fir.numeroProgressivo,
      rifiuto: JSON.stringify(fir.rifiuto),
      // ... map all fields
    }
  }

  private toDomainModel(data: FirModel): FIR {
    // Reconstruct aggregate from persistence
    return FIR.reconstitute({
      id: data.id,
      stato: data.stato as FIRStato,
      rifiuto: JSON.parse(data.rifiuto),
      // ...
    })
  }
}
```

**Acceptance Criteria:**
- [ ] Repository interface definita in domain
- [ ] Implementazione Prisma in infrastructure layer
- [ ] Mapper dominio ↔ persistence
- [ ] Integration test con testcontainer
- [ ] Transaction support per aggregate consistency
- [ ] Query methods: findById, findByTenant, findByStato

**File:** `src/infrastructure/persistence/fir-prisma.repository.ts`
**Effort:** 2.5 giorni

---

### TASK 2.3: Create FIR Use Case + API Endpoint (M - 8 SP)

**TDD RED:**
```typescript
// apps/backend/src/application/use-cases/create-fir.use-case.spec.ts
describe('CreateFIRUseCase', () => {
  let useCase: CreateFIRUseCase
  let mockRepository: jest.Mocked<FIRRepository>
  let mockEventBus: jest.Mocked<EventBus>

  it('should create FIR and publish event', async () => {
    const command = new CreateFIRCommand({
      produttoreId: 'tenant-1',
      rifiuto: { cer: '13 02 05*', quantita: 120 },
      trasportatoreId: 'transp-1',
      destinatarioId: 'dest-1',
    })

    const result = await useCase.execute(command)

    expect(result.isSuccess).toBe(true)
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ stato: FIRStato.BOZZA })
    )
    expect(mockEventBus.publish).not.toHaveBeenCalled()  // BOZZA non emette eventi
  })

  it('should validate CER exists before creation', async () => {
    mockCERRepository.findByCode.mockResolvedValue(null)

    const command = new CreateFIRCommand({ rifiuto: { cer: 'INVALID' } })
    const result = await useCase.execute(command)

    expect(result.isFailure).toBe(true)
    expect(result.error).toBe('CER code not found: INVALID')
  })
})

// Integration test API endpoint
describe('POST /api/fir', () => {
  it('should create FIR and return 201', async () => {
    return request(app.getHttpServer())
      .post('/api/fir')
      .set('Authorization', `Bearer ${validJWT}`)
      .send(validCreateFIRDto)
      .expect(201)
      .expect(res => {
        expect(res.body.id).toBeDefined()
        expect(res.body.stato).toBe('BOZZA')
      })
  })

  it('should return 400 for invalid DTO', async () => {
    return request(app.getHttpServer())
      .post('/api/fir')
      .set('Authorization', `Bearer ${validJWT}`)
      .send({ rifiuto: { quantita: -10 } })  // Invalid
      .expect(400)
      .expect(res => {
        expect(res.body.message).toContain('quantita must be positive')
      })
  })
})
```

**TDD GREEN:**
```typescript
// apps/backend/src/application/use-cases/create-fir.use-case.ts
export class CreateFIRUseCase {
  constructor(
    private firRepository: FIRRepository,
    private cerRepository: CERRepository,
    private eventBus: EventBus
  ) {}

  async execute(command: CreateFIRCommand): Promise<Result<FIR>> {
    // Validate CER exists
    const cer = await this.cerRepository.findByCode(command.rifiuto.cer)
    if (!cer) {
      return Result.fail(`CER code not found: ${command.rifiuto.cer}`)
    }

    // Create aggregate
    const fir = FIR.create({
      produttoreId: command.produttoreId,
      rifiuto: command.rifiuto,
      trasportatoreId: command.trasportatoreId,
      destinatarioId: command.destinatarioId,
    })

    // Persist
    await this.firRepository.save(fir)

    return Result.ok(fir)
  }
}

// apps/backend/src/api/fir/fir.controller.ts
@Controller('api/fir')
export class FIRController {
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateFIRDto, @CurrentUser() user: User) {
    const command = new CreateFIRCommand({
      ...dto,
      produttoreId: user.tenantId,
    })

    const result = await this.createFIRUseCase.execute(command)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return FIRMapper.toDTO(result.value)
  }
}
```

**Acceptance Criteria:**
- [ ] Use case con business logic validation
- [ ] DTO validation con class-validator
- [ ] Controller con auth guard
- [ ] Swagger documentation
- [ ] Unit test use case con mocks
- [ ] Integration test API con Supertest
- [ ] Error handling completo

**File:** `src/application/use-cases/create-fir.use-case.ts`, `src/api/fir/`
**Effort:** 4 giorni

---

### DEFINITION OF DONE SPRINT 2
- [ ] FIR aggregate completo con test 100%
- [ ] API POST /api/fir funzionante
- [ ] FIR persisted su PostgreSQL
- [ ] E2E test: Create FIR flow
- [ ] Test coverage: Backend 83%
- [ ] Swagger API docs aggiornate

---

## 5. METRICHE DI QUALITA E TESTING STRATEGY

### COVERAGE TARGET
- **Backend:** ≥80% line coverage, ≥75% branch coverage
- **Frontend:** ≥70% line coverage
- **Critical paths:** 100% coverage (FIR aggregate, auth, RENTRI sync)

### TEST PYRAMID
```
           /\
          /E2E\         ~10 tests (critical flows)
         /------\
        /  API  \       ~50 tests (integration)
       /----------\
      /    UNIT    \    ~300 tests (domain logic)
     /--------------\
```

### QUALITY GATES (CI Pipeline)
1. **Lint:** ESLint errors = 0
2. **Unit Test:** Coverage ≥80% backend, ≥70% frontend
3. **Integration Test:** All pass
4. **Security:** npm audit (no critical vulnerabilities)
5. **Performance:** Lighthouse CI score >85

### CONTRACT TESTING (RENTRI API)
- Pact tests per validare contract API RENTRI
- Mock server RENTRI per test isolati
- Consumer-driven contract evolution

---

## 6. RISK REGISTER E MITIGAZIONI

| Rischio | Probabilita | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| **RENTRI API downtime blocca sync** | MEDIA | ALTO | Graceful degradation + queue retry, alert team |
| **SPID integration piu complessa del previsto** | ALTA | MEDIO | Spike 2 giorni Sprint 0, mock robusto per parallelize dev |
| **Team velocity inferiore a 40 SP/sprint** | MEDIA | ALTO | Buffer sprint 7 ridotto, de-scope MH-13 se necessario |
| **PostgreSQL performance issue con load** | BASSA | MEDIO | Index strategy da Sprint 0, load testing Sprint 6 |
| **Firma digitale InfoCert integrazione ritardata** | MEDIA | MEDIO | Stub firma locale per MVP, integrazione post-launch |
| **Test coverage non raggiunge 80%** | BASSA | ALTO | Code review blocca merge se coverage < threshold |

---

## 7. DEFINITION OF DONE - LIVELLI

### TASK LEVEL
- [ ] Test scritti PRIMA (TDD RED-GREEN-REFACTOR)
- [ ] Codice passa lint senza warning
- [ ] Test coverage ≥80% per modulo
- [ ] Code review approvato da 2 dev
- [ ] Branch merged su develop

### SPRINT LEVEL
- [ ] Tutti i task completati
- [ ] Integration test passano
- [ ] Deploy staging eseguito con successo
- [ ] Smoke test staging OK
- [ ] Sprint review demo con stakeholder
- [ ] Retrospettiva completata con action items

### MVP LEVEL (Fine Sprint 7)
- [ ] Tutte le 13 funzionalita MUST HAVE implementate
- [ ] Test coverage: Backend 83%, Frontend 72%
- [ ] E2E test: 12 flussi critici coperti
- [ ] Performance: P95 latency <2s
- [ ] Security audit completato (no critical vuln)
- [ ] Beta test con 20 utenti: NPS >40
- [ ] Documentazione API completa
- [ ] Runbook operativo per production deploy

---

## CONCLUSIONI

**Fattibilita:** ALTA con approccio TDD rigoroso e team disciplinato.

**Key Success Factors:**
1. TDD non negoziabile - zero feature senza test
2. Sprint 0 fondamentale - non skippare setup tooling
3. Velocity realistico - 40 SP/sprint achievable con team 5-7 dev
4. Rischio RENTRI mitigato con graceful degradation
5. Buffer Sprint 7 per hardening e security audit

**Prossimi Step:**
1. Kickoff Sprint 0: Setup monorepo + AWS infrastructure
2. Training team TDD: Workshop 4h con kata pratici
3. Setup Jira/Linear con task board e burndown chart
4. Definizione ceremony Scrum: daily standup, planning, review, retro

**Delivery Confidence:** 85% - Raggiungibile con disciplina e focus.

---

**Documento Preparato da:** Technical Lead & Architect
**Versione:** 1.0
**Prossimo Aggiornamento:** Post-Sprint 2 (validazione velocity reale)
