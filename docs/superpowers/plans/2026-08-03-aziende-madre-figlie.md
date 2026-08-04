# Aziende madre e figlie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere che un'azienda madre (titolare del contratto, spesso il consulente) raggruppi più aziende figlie i cui dati restano isolati fra loro, ciascuna con la propria configurazione RENTRI.

**Architecture:** Una sola colonna nuova, `Tenant.parentTenantId`: le figlie sono tenant a tutti gli effetti, quindi ereditano immutato l'isolamento già in esercizio (TenantContext → estensione RLS Prisma → `requireRequestTenantId`) e nessun dato operativo viene migrato. Il contratto (piano, limiti, feature, Stripe) si legge risalendo alla radice; l'accesso scende dalla madre alle figlie e non risale mai.

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL 16, Jest, Angular 17 + PrimeNG (frontend).

## Global Constraints

- **Spec di riferimento:** `docs/superpowers/specs/2026-08-03-aziende-madre-figlie-design.md`. In caso di conflitto fra piano e spec, vince la spec.
- **TDD obbligatorio**: test rosso verificato prima di ogni implementazione. Nessuna eccezione.
- **Italiano** per stringhe UI, messaggi d'errore e commenti; identificatori in inglese salvo termini di dominio (`madre`, `figlie`, `aziendeLimit`).
- **Migrazioni forward-only e additive**: nessuna colonna rimossa, nessun dato spostato.
- **Nessuna attribuzione AI nei messaggi di commit.**
- **Fonte unica dell'azienda attiva**: `requireRequestTenantId(req)` da `core/context/resolve-request-tenant.ts`. Mai `req.user.tenantId` grezzo.
- **Gerarchia a un solo livello**: una figlia non può avere figlie.
- **Comandi**: unitari `cd apps/backend && npx jest <path>`; integrazione con Postgres reale `cd apps/backend && npm run test:postgres` (file `*.postgres.spec.ts`, esclusi dal gate CI perché il runner non ha un database); suite completa `cd apps/backend && npx jest --runInBand --forceExit`; typecheck `npx tsc -p tsconfig.json --noEmit`; lint `npx eslint --fix <file>`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `apps/backend/prisma/schema.prisma` | `Tenant.parentTenantId`, relazione `madre`/`figlie`, `Tenant.aziendeLimit` |
| `apps/backend/prisma/migrations/<timestamp>_gruppo_aziende/migration.sql` | Migrazione additiva |
| `apps/backend/src/application/billing/contratto-gruppo.service.ts` | **Nuovo.** Unico punto che risolve il contratto risalendo alla radice |
| `apps/backend/src/application/billing/subscription-enforcement.service.ts` | Usa il risolutore; il tetto FIR resta contato sulla figlia |
| `apps/backend/src/api/me/me-features.service.ts` | Legge piano/feature/limite utenti dalla radice |
| `apps/backend/src/api/me/membership.service.ts` | `checkAccess` scende dalla madre; `listTenants` espone la gerarchia |
| `apps/backend/src/application/admin/tenant.service.ts` | Creazione figlia: `parentTenantId`, quota, divieto di secondo livello |
| `apps/backend/src/api/admin/dto/create-tenant.dto.ts` | Campo `parentTenantId` opzionale |
| `apps/backend/src/application/queries/handlers/get-aggregated-dashboard.handler.ts` | Riscritto sui figli della madre, con Prisma al posto delle query raw rotte |
| `apps/backend/src/application/gruppo/isolamento-sorelle.spec.ts` | **Nuovo.** La suite che dimostra il requisito |
| `apps/frontend/src/app/shared/components/layout.component.ts` | Selettore azienda gerarchico |

---

## Task 1: Schema e migrazione della gerarchia

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (modello `Tenant`, righe 25-106)
- Create: `apps/backend/prisma/migrations/<timestamp>_gruppo_aziende/migration.sql`
- Test: `apps/backend/src/application/gruppo/gerarchia-tenant.postgres.spec.ts`

**Interfaces:**
- Consumes: nulla (primo task)
- Produces: colonne `tenants.parent_tenant_id` (uuid, nullable, FK self con `ON DELETE RESTRICT`) e `tenants.aziende_limit` (integer, nullable); campi Prisma `Tenant.parentTenantId`, `Tenant.madre`, `Tenant.figlie`, `Tenant.aziendeLimit`

- [ ] **Step 1: Scrivere il test di integrazione che fallisce**

Crea `apps/backend/src/application/gruppo/gerarchia-tenant.postgres.spec.ts`:

```typescript
/**
 * Gerarchia madre-figlie a livello di database.
 *
 * Richiede un PostgreSQL reale: il vincolo ON DELETE RESTRICT e il
 * comportamento dei NULL non sono dimostrabili con una finta.
 * Eseguire con `npm run test:postgres` (escluso dal gate CI: il runner non ha DB).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** P.IVA valide e irripetibili fra esecuzioni: il campo è @unique. */
const piva = () => String(Date.now()).slice(-9).padStart(11, '1')

describe('Gerarchia madre-figlie (Postgres reale)', () => {
  const creati: string[] = []

  afterAll(async () => {
    // Prima le figlie: la FK con RESTRICT vieta di cancellare una madre con figlie.
    for (const id of [...creati].reverse()) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('una figlia referenzia la madre e la madre elenca le figlie', async () => {
    const madre = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Gruppo Madre Srl' },
    })
    creati.push(madre.id)

    const figlia = await prisma.tenant.create({
      data: {
        partitaIva: piva(),
        ragioneSociale: 'Figlia Alfa Srl',
        parentTenantId: madre.id,
      },
    })
    creati.push(figlia.id)

    const conFiglie = await prisma.tenant.findUnique({
      where: { id: madre.id },
      include: { figlie: { select: { id: true } } },
    })

    expect(conFiglie!.parentTenantId).toBeNull()
    expect(conFiglie!.figlie.map(f => f.id)).toEqual([figlia.id])
  })

  it('una madre con figlie non e cancellabile (ON DELETE RESTRICT)', async () => {
    const madre = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Madre Indelebile Srl' },
    })
    creati.push(madre.id)
    const figlia = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Figlia Beta Srl', parentTenantId: madre.id },
    })
    creati.push(figlia.id)

    await expect(prisma.tenant.delete({ where: { id: madre.id } })).rejects.toThrow()
  })

  it('aziendeLimit e nullable: i tenant esistenti restano invariati', async () => {
    const radice = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Radice Senza Quota Srl' },
    })
    creati.push(radice.id)

    expect(radice.aziendeLimit).toBeNull()
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd apps/backend && npm run test:postgres -- gerarchia-tenant`
Expected: FAIL in compilazione TypeScript — `parentTenantId` e `aziendeLimit` non esistono sul tipo `TenantCreateInput`/`Tenant`.

- [ ] **Step 3: Aggiungere i campi allo schema Prisma**

In `apps/backend/prisma/schema.prisma`, dentro `model Tenant`, subito dopo il campo `ownerUserId`:

```prisma
  /// Azienda madre del gruppo. null = azienda madre (radice, titolare del
  /// contratto); valorizzata = azienda figlia. Gerarchia a UN SOLO livello:
  /// una figlia non puo' avere figlie (vincolo applicativo, v. TenantService).
  ///
  /// Le figlie restano tenant a tutti gli effetti: ereditano immutato
  /// l'isolamento (TenantContext + estensione RLS) e hanno ciascuna la propria
  /// RentriCredential. Il contratto (piano, limiti, feature, Stripe) si legge
  /// invece SEMPRE risalendo alla radice: v. ContrattoGruppoService.
  parentTenantId String? @map("parent_tenant_id") @db.Uuid

  /// Quante aziende figlie puo' avere questo gruppo. Solo sulla radice.
  /// null = nessun limite di gruppo: vale il vecchio `User.companyLimit` di
  /// chi crea (retrocompatibilita' per i tenant esistenti).
  aziendeLimit Int? @map("aziende_limit")
```

E, nella sezione delle relazioni dello stesso modello (dopo `rentriUnitaLocali`):

```prisma
  madre  Tenant?  @relation("GruppoAziende", fields: [parentTenantId], references: [id], onDelete: Restrict)
  figlie Tenant[] @relation("GruppoAziende")
```

E, fra gli `@@index` già presenti:

```prisma
  @@index([parentTenantId])
```

- [ ] **Step 4: Creare la migrazione**

Run: `cd apps/backend && npx prisma migrate dev --name gruppo_aziende --create-only`

Apri il file generato e verifica che contenga **solo** queste operazioni (se la migrazione include altro, cancella le righe estranee: è il falso positivo di drift noto e documentato nel progetto):

```sql
ALTER TABLE "tenants" ADD COLUMN "parent_tenant_id" UUID;
ALTER TABLE "tenants" ADD COLUMN "aziende_limit" INTEGER;

CREATE INDEX "tenants_parent_tenant_id_idx" ON "tenants"("parent_tenant_id");

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parent_tenant_id_fkey"
  FOREIGN KEY ("parent_tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Applicare la migrazione e rigenerare il client**

Run: `cd apps/backend && npx prisma migrate dev && npx prisma generate`
Expected: migrazione applicata, client rigenerato senza errori.

- [ ] **Step 6: Eseguire il test e verificare che passi**

Run: `cd apps/backend && npm run test:postgres -- gerarchia-tenant`
Expected: PASS, 3 test.

- [ ] **Step 7: Verificare che la suite unitaria non sia rotta**

Run: `cd apps/backend && npx jest --runInBand --forceExit --silent`
Expected: tutte verdi (141 suite / 1434 test al momento della scrittura del piano).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations apps/backend/src/application/gruppo/gerarchia-tenant.postgres.spec.ts
git commit -m "feat(gruppo): gerarchia madre-figlie fra tenant

Aggiunge parent_tenant_id (FK self, ON DELETE RESTRICT: una madre con
figlie non e' cancellabile perche' la cascata cancellerebbe dati soggetti
a conservazione decennale) e aziende_limit. Migrazione additiva: tutti i
tenant esistenti restano radici e nessun dato si sposta."
```

---

## Task 2: Il contratto si legge dalla radice

**Files:**
- Create: `apps/backend/src/application/billing/contratto-gruppo.service.ts`
- Create: `apps/backend/src/application/billing/contratto-gruppo.service.spec.ts`
- Modify: `apps/backend/src/application/billing/subscription-enforcement.service.ts`
- Modify: `apps/backend/src/application/billing/billing.module.ts` (registrare il provider)

**Interfaces:**
- Consumes: `Tenant.parentTenantId` (Task 1)
- Produces: `ContrattoGruppoService` con
  - `risolviRadice(tenantId: string): Promise<string>` — id della radice (se stesso se già radice)
  - `caricaContratto(tenantId: string): Promise<ContrattoEffettivo | null>` dove
    `ContrattoEffettivo = { tenantIdRadice: string; subscriptionTier: SubscriptionTier; subscriptionStatus: SubscriptionStatus; subscriptionEnd: Date | null; firLimitPerMonth: number; userLimitTotal: number; featureFlags: unknown; aziendeLimit: number | null; ragioneSociale: string }`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `apps/backend/src/application/billing/contratto-gruppo.service.spec.ts`:

```typescript
/**
 * Il contratto (piano, limiti, feature, Stripe) vive SOLO sulla madre: una
 * figlia non ha un abbonamento proprio, lo eredita. Senza questa regola due
 * societa' dello stesso gruppo potrebbero avere piani incoerenti.
 */
import { ContrattoGruppoService } from './contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

/** Prisma finto che si comporta come il DB: risolve per id. */
function makePrisma() {
  const righe: Record<string, any> = {
    [RADICE]: {
      id: RADICE,
      parentTenantId: null,
      subscriptionTier: 'PROFESSIONAL',
      subscriptionStatus: 'ACTIVE',
      subscriptionEnd: null,
      firLimitPerMonth: 100,
      userLimitTotal: 10,
      featureFlags: null,
      aziendeLimit: 5,
      ragioneSociale: 'Gruppo Madre Srl',
    },
    [FIGLIA]: {
      id: FIGLIA,
      parentTenantId: RADICE,
      // Valori volutamente diversi: NON devono essere letti.
      subscriptionTier: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      subscriptionEnd: null,
      firLimitPerMonth: 1,
      userLimitTotal: 1,
      featureFlags: null,
      aziendeLimit: null,
      ragioneSociale: 'Figlia Alfa Srl',
    },
  }
  return {
    tenant: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(righe[where.id] ?? null)),
    },
  } as any
}

describe('ContrattoGruppoService', () => {
  it('per una figlia risolve la radice', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.risolviRadice(FIGLIA)).resolves.toBe(RADICE)
  })

  it('per una radice risolve se stessa', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.risolviRadice(RADICE)).resolves.toBe(RADICE)
  })

  it('il contratto di una figlia e quello della madre, non il suo', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    const contratto = await service.caricaContratto(FIGLIA)

    expect(contratto!.tenantIdRadice).toBe(RADICE)
    expect(contratto!.subscriptionTier).toBe('PROFESSIONAL')
    expect(contratto!.firLimitPerMonth).toBe(100)
    expect(contratto!.userLimitTotal).toBe(10)
    expect(contratto!.aziendeLimit).toBe(5)
  })

  it('tenant inesistente: nessun contratto', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.caricaContratto('non-esiste')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd apps/backend && npx jest src/application/billing/contratto-gruppo.service.spec.ts`
Expected: FAIL — `Cannot find module './contratto-gruppo.service'`.

- [ ] **Step 3: Implementare il servizio**

Crea `apps/backend/src/application/billing/contratto-gruppo.service.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

/**
 * Contratto effettivo di un'azienda: sempre quello della radice del gruppo.
 */
export interface ContrattoEffettivo {
  tenantIdRadice: string
  subscriptionTier: SubscriptionTier
  subscriptionStatus: SubscriptionStatus
  subscriptionEnd: Date | null
  firLimitPerMonth: number
  userLimitTotal: number
  featureFlags: unknown
  aziendeLimit: number | null
  ragioneSociale: string
}

/**
 * ContrattoGruppoService — UNICO punto da cui si legge il contratto.
 *
 * Piano, stato abbonamento, limiti, feature e identificativi Stripe vivono
 * solo sull'azienda madre: una figlia li ha in tabella (la migrazione e'
 * additiva) ma NON sono autorevoli. Chi li legge direttamente da una figlia
 * ottiene valori che nessuno mantiene aggiornati.
 *
 * La gerarchia e' a un solo livello, quindi la risalita e' un singolo salto:
 * nessuna ricorsione, nessuna query ricorsiva.
 */
@Injectable()
export class ContrattoGruppoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Id della radice del gruppo: il tenant stesso se e' gia' radice. */
  async risolviRadice(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, parentTenantId: true },
    })
    if (!tenant) return tenantId
    return tenant.parentTenantId ?? tenant.id
  }

  /** Contratto effettivo, o null se il tenant non esiste. */
  async caricaContratto(tenantId: string): Promise<ContrattoEffettivo | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, parentTenantId: true },
    })
    if (!tenant) return null

    const radiceId = tenant.parentTenantId ?? tenant.id
    const radice =
      radiceId === tenant.id
        ? await this.prisma.tenant.findUnique({ where: { id: radiceId } })
        : await this.prisma.tenant.findUnique({ where: { id: radiceId } })

    if (!radice) return null

    return {
      tenantIdRadice: radice.id,
      subscriptionTier: radice.subscriptionTier,
      subscriptionStatus: radice.subscriptionStatus,
      subscriptionEnd: radice.subscriptionEnd,
      firLimitPerMonth: radice.firLimitPerMonth,
      userLimitTotal: radice.userLimitTotal,
      featureFlags: radice.featureFlags,
      aziendeLimit: radice.aziendeLimit,
      ragioneSociale: radice.ragioneSociale,
    }
  }
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd apps/backend && npx jest src/application/billing/contratto-gruppo.service.spec.ts`
Expected: PASS, 4 test.

- [ ] **Step 5: Semplificare il ramo ridondante**

I due rami del ternario in `caricaContratto` fanno la stessa query. Sostituisci le righe da `const radice =` a `: await this.prisma.tenant.findUnique({ where: { id: radiceId } })` con:

```typescript
    const radice = await this.prisma.tenant.findUnique({ where: { id: radiceId } })
```

Run: `cd apps/backend && npx jest src/application/billing/contratto-gruppo.service.spec.ts`
Expected: PASS, 4 test (il refactoring non cambia comportamento).

- [ ] **Step 6: Registrare il provider**

In `apps/backend/src/application/billing/billing.module.ts` aggiungi `ContrattoGruppoService` a `providers` e a `exports` (import da `./contratto-gruppo.service`).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/application/billing/
git commit -m "feat(gruppo): il contratto si legge sempre dalla radice del gruppo"
```

---

## Task 3: Enforcement e feature leggono il contratto della radice

**Files:**
- Modify: `apps/backend/src/application/billing/subscription-enforcement.service.ts`
- Modify: `apps/backend/src/application/billing/subscription-enforcement.service.spec.ts` (se esiste; altrimenti crearlo)
- Modify: `apps/backend/src/api/me/me-features.service.ts`
- Test: `apps/backend/src/api/me/me-features.service.spec.ts`

**Interfaces:**
- Consumes: `ContrattoGruppoService.caricaContratto` (Task 2)
- Produces: nessuna nuova firma pubblica; cambia il comportamento di `assertNotSuspended`, `assertFirLimitNotReached`, `assertUserLimitNotReached`, `MeFeaturesService.getFeaturesForUser`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `apps/backend/src/application/billing/subscription-enforcement.gruppo.spec.ts`:

```typescript
/**
 * Regole di gruppo sull'enforcement:
 *  - lo STATO dell'abbonamento e i LIMITI vengono dalla madre;
 *  - il CONTEGGIO dei FIR resta della figlia (tetto per azienda, non di gruppo:
 *    una societa' attiva non consuma la quota delle sorelle).
 */
import { ForbiddenException } from '@nestjs/common'
import { SubscriptionEnforcementService } from './subscription-enforcement.service'
import { ContrattoGruppoService } from './contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

function makeDeps(opts: { statoRadice: string; limiteRadice: number; firDellaFiglia: number }) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? {
                id: RADICE,
                parentTenantId: null,
                subscriptionTier: 'PROFESSIONAL',
                subscriptionStatus: opts.statoRadice,
                subscriptionEnd: null,
                firLimitPerMonth: opts.limiteRadice,
                userLimitTotal: 10,
                featureFlags: null,
                aziendeLimit: 5,
                ragioneSociale: 'Gruppo Madre Srl',
              }
            : {
                id: FIGLIA,
                parentTenantId: RADICE,
                subscriptionTier: 'TRIAL',
                subscriptionStatus: 'ACTIVE',
                subscriptionEnd: null,
                firLimitPerMonth: 1,
                userLimitTotal: 1,
                featureFlags: null,
                aziendeLimit: null,
                ragioneSociale: 'Figlia Alfa Srl',
              }
        )
      ),
    },
    fIR: {
      // Conta solo se il filtro e' sulla figlia: e' il punto del test.
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where.tenantId === FIGLIA ? opts.firDellaFiglia : 0)
      ),
    },
    user: { count: jest.fn().mockResolvedValue(0) },
  }
  const contratto = new ContrattoGruppoService(prisma)
  return { prisma, service: new SubscriptionEnforcementService(prisma, contratto) }
}

describe('SubscriptionEnforcementService — gruppo', () => {
  it('la figlia e bloccata se la MADRE e sospesa, anche se lei risulta attiva', async () => {
    const { service } = makeDeps({ statoRadice: 'SUSPENDED', limiteRadice: 100, firDellaFiglia: 0 })

    await expect(service.assertNotSuspended(FIGLIA)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('il tetto FIR viene dalla madre ma conta i soli FIR della figlia', async () => {
    const { service, prisma } = makeDeps({
      statoRadice: 'ACTIVE',
      limiteRadice: 100,
      firDellaFiglia: 99,
    })

    await expect(service.assertFirLimitNotReached(FIGLIA)).resolves.toBeUndefined()
    expect(prisma.fIR.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: FIGLIA }) })
    )
  })

  it('la figlia e bloccata quando raggiunge il tetto del piano della madre', async () => {
    const { service } = makeDeps({
      statoRadice: 'ACTIVE',
      limiteRadice: 100,
      firDellaFiglia: 100,
    })

    await expect(service.assertFirLimitNotReached(FIGLIA)).rejects.toBeInstanceOf(
      ForbiddenException
    )
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd apps/backend && npx jest src/application/billing/subscription-enforcement.gruppo.spec.ts`
Expected: FAIL — il costruttore di `SubscriptionEnforcementService` accetta un solo argomento; e comunque il servizio legge lo stato dalla figlia (`ACTIVE`), quindi il primo test non lancia.

- [ ] **Step 3: Iniettare il risolutore e leggere il contratto dalla radice**

In `subscription-enforcement.service.ts` sostituisci il costruttore:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratto: ContrattoGruppoService
  ) {}
```

aggiungendo l'import `import { ContrattoGruppoService } from './contratto-gruppo.service'`.

In `assertNotSuspended`, sostituisci la query iniziale:

```typescript
    // Il contratto vive sulla radice del gruppo: una figlia non ha un
    // abbonamento proprio, eredita quello della madre.
    const tenant = await this.contratto.caricaContratto(tenantId)
```

(il resto del metodo resta identico: usa `tenant.subscriptionEnd`, `tenant.subscriptionStatus`).

In `assertFirLimitNotReached`, sostituisci la query iniziale con:

```typescript
    // Il VALORE del tetto viene dal piano della madre; il CONTEGGIO resta
    // della singola azienda (tetto per azienda, non di gruppo).
    const tenant = await this.contratto.caricaContratto(tenantId)
```

lasciando invariato il `this.prisma.fIR.count({ where: { tenantId, ... } })`.

In `assertUserLimitNotReached`, sostituisci la query iniziale con:

```typescript
    const tenant = await this.contratto.caricaContratto(tenantId)
```

lasciando invariato il `this.prisma.user.count({ where: { tenantId, ... } })`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `cd apps/backend && npx jest src/application/billing/`
Expected: PASS (inclusi gli eventuali test preesistenti del servizio; se qualcuno costruisce `SubscriptionEnforcementService` con un solo argomento, aggiornalo passando `new ContrattoGruppoService(prisma)`).

- [ ] **Step 5: Scrivere il test delle feature che fallisce**

Crea `apps/backend/src/api/me/me-features.gruppo.spec.ts`:

```typescript
/**
 * Le feature e il piano mostrati a una figlia sono quelli del contratto della
 * madre: e' la stessa regola dell'enforcement, applicata alla UI.
 */
import { MeFeaturesService } from './me-features.service'
import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? {
                id: RADICE,
                parentTenantId: null,
                subscriptionTier: 'ENTERPRISE',
                subscriptionStatus: 'ACTIVE',
                subscriptionEnd: null,
                firLimitPerMonth: 0,
                userLimitTotal: 50,
                featureFlags: null,
                aziendeLimit: 5,
                ragioneSociale: 'Gruppo Madre Srl',
              }
            : {
                id: FIGLIA,
                parentTenantId: RADICE,
                subscriptionTier: 'TRIAL',
                subscriptionStatus: 'TRIAL',
                subscriptionEnd: null,
                firLimitPerMonth: 1,
                userLimitTotal: 1,
                featureFlags: null,
                aziendeLimit: null,
                ragioneSociale: 'Figlia Alfa Srl',
              }
        )
      ),
    },
  }
  return new MeFeaturesService(prisma, new ContrattoGruppoService(prisma))
}

describe('MeFeaturesService — gruppo', () => {
  it('una figlia vede il piano e il limite utenti della madre', async () => {
    const service = makeService()

    const risposta = await service.getFeaturesForUser({ tenantId: FIGLIA } as any)

    expect(risposta.tier).toBe('ENTERPRISE')
    expect(risposta.userLimitTotal).toBe(50)
  })
})
```

- [ ] **Step 6: Eseguire il test e verificare che fallisca**

Run: `cd apps/backend && npx jest src/api/me/me-features.gruppo.spec.ts`
Expected: FAIL — il costruttore accetta un solo argomento e il tier restituito è `TRIAL`.

- [ ] **Step 7: Far leggere le feature dalla radice**

In `me-features.service.ts`: aggiungi l'import `import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'`, cambia il costruttore in

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratto: ContrattoGruppoService
  ) {}
```

e sostituisci il blocco `const tenant = await this.prisma.tenant.findUnique({...})` con

```typescript
    // Piano, feature e limite utenti vengono dal contratto della radice.
    const tenant = await this.contratto.caricaContratto(tenantId)
```

- [ ] **Step 8: Eseguire i test e verificare che passino**

Run: `cd apps/backend && npx jest src/api/me/`
Expected: PASS. Se il modulo che dichiara `MeFeaturesService` non importa `BillingModule`, aggiungilo agli `imports` così che `ContrattoGruppoService` sia iniettabile.

- [ ] **Step 9: Suite completa e typecheck**

Run: `cd apps/backend && npx tsc -p tsconfig.json --noEmit && npx jest --runInBand --forceExit --silent`
Expected: typecheck pulito, tutte le suite verdi.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/application/billing/ apps/backend/src/api/me/
git commit -m "feat(gruppo): abbonamento, limiti e feature letti dal contratto della madre

Il tetto FIR resta per azienda: il valore viene dal piano della radice, il
conteggio dai soli FIR della figlia."
```

---

## Task 4: L'accesso scende dalla madre alle figlie

**Files:**
- Modify: `apps/backend/src/api/me/membership.service.ts`
- Modify: `apps/backend/src/api/me/membership.service.spec.ts`

**Interfaces:**
- Consumes: `Tenant.parentTenantId` (Task 1)
- Produces: `MembershipService.checkAccess` con quarta sorgente (madre); `listTenants` che restituisce anche `parentTenantId` per ogni voce

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungi in coda a `apps/backend/src/api/me/membership.service.spec.ts`:

```typescript
describe('MembershipService — gerarchia madre-figlie', () => {
  const MADRE = 'tenant-madre-uuid'
  const FIGLIA = 'tenant-figlia-uuid'
  const SORELLA = 'tenant-sorella-uuid'
  const UTENTE_MADRE = 'utente-madre-uuid'
  const UTENTE_FIGLIA = 'utente-figlia-uuid'

  /** Prisma finto: gerarchia + proprieta' + associazioni consulente. */
  function makePrismaGerarchia() {
    const tenants: Record<string, any> = {
      [MADRE]: { id: MADRE, parentTenantId: null, ownerUserId: UTENTE_MADRE },
      [FIGLIA]: { id: FIGLIA, parentTenantId: MADRE, ownerUserId: null },
      [SORELLA]: { id: SORELLA, parentTenantId: MADRE, ownerUserId: null },
    }
    return {
      tenant: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(tenants[where.id] ?? null)),
        findFirst: jest.fn(({ where }: any) => {
          const t = tenants[where.id]
          if (!t) return Promise.resolve(null)
          if (where.ownerUserId && t.ownerUserId !== where.ownerUserId) return Promise.resolve(null)
          return Promise.resolve({ id: t.id })
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      consultantTenantAssociation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any
  }

  it('chi e abilitato alla madre accede a una figlia', async () => {
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_MADRE, FIGLIA, MADRE)).resolves.toBe(true)
  })

  it('chi e abilitato a una figlia NON accede alla sorella', async () => {
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_FIGLIA, SORELLA, FIGLIA)).resolves.toBe(false)
  })

  it('chi e abilitato a una figlia NON risale alla madre', async () => {
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_FIGLIA, MADRE, FIGLIA)).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `cd apps/backend && npx jest src/api/me/membership.service.spec.ts`
Expected: FAIL sul primo test (`resolves.toBe(true)` riceve `false`); gli altri due passano già — sono le guardie che devono restare verdi dopo la modifica.

- [ ] **Step 3: Aggiungere la discesa dalla madre**

In `membership.service.ts`, dentro `checkAccess`, dopo il blocco `// 3. Associazione consulente attiva e non scaduta.` e prima del `return !!assoc`, sostituisci la chiusura del metodo con:

```typescript
    if (assoc) return true

    // 4. Discesa gerarchica: chi e' abilitato all'azienda MADRE accede alle
    //    figlie coi poteri del proprio ruolo. E' l'unico punto in cui la
    //    gerarchia concede qualcosa, e vale in una sola direzione: essere
    //    abilitati a una figlia non da' accesso ne' alla madre ne' alle sorelle.
    const target = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { parentTenantId: true },
    })
    if (!target?.parentTenantId) return false

    // Ricorsione di UN solo passo: la gerarchia e' a un livello.
    return this.checkAccess(userId, target.parentTenantId, primaryTenantId)
  }
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `cd apps/backend && npx jest src/api/me/membership.service.spec.ts`
Expected: PASS, tutti i test (i 4 preesistenti sulle associazioni scadute + i 3 nuovi).

- [ ] **Step 5: Esporre la gerarchia nell'elenco aziende**

In `listTenants`, aggiungi le figlie dei tenant accessibili e restituisci il legame. Sostituisci il blocco che costruisce `tenants` con:

```typescript
    // Le figlie delle aziende accessibili sono a loro volta accessibili
    // (discesa gerarchica, v. checkAccess).
    const figlie = await this.prisma.tenant.findMany({
      where: { parentTenantId: { in: Array.from(ids) } },
      select: { id: true },
    })
    figlie.forEach(f => ids.add(f.id))

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, ragioneSociale: true, parentTenantId: true },
      orderBy: { ragioneSociale: 'asc' },
    })
```

- [ ] **Step 6: Scrivere il test dell'elenco e verificarlo**

Aggiungi nel `describe` della gerarchia:

```typescript
  it('l elenco aziende include le figlie della madre, col legame', async () => {
    const prisma = makePrismaGerarchia()
    prisma.tenant.findMany = jest.fn(({ where }: any) => {
      if (where.parentTenantId) return Promise.resolve([{ id: FIGLIA }, { id: SORELLA }])
      if (where.ownerUserId) return Promise.resolve([{ id: MADRE }])
      return Promise.resolve([
        { id: MADRE, ragioneSociale: 'Gruppo Madre Srl', parentTenantId: null },
        { id: FIGLIA, ragioneSociale: 'Figlia Alfa Srl', parentTenantId: MADRE },
        { id: SORELLA, ragioneSociale: 'Figlia Beta Srl', parentTenantId: MADRE },
      ])
    })
    const service = new MembershipService(prisma, jwtTokens)

    const risposta = await service.listTenants({ id: UTENTE_MADRE, tenantId: MADRE } as any)

    expect(risposta.tenants.map((t: any) => t.id)).toEqual([MADRE, FIGLIA, SORELLA])
    expect(risposta.tenants.find((t: any) => t.id === FIGLIA).parentTenantId).toBe(MADRE)
  })
```

Run: `cd apps/backend && npx jest src/api/me/membership.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/api/me/
git commit -m "feat(gruppo): l'accesso scende dalla madre alle figlie, mai il contrario"
```

---

## Task 5: Creazione di un'azienda figlia

**Files:**
- Modify: `apps/backend/src/api/admin/dto/create-tenant.dto.ts`
- Modify: `apps/backend/src/application/admin/tenant.service.ts` (metodo `create`, righe 150-235)
- Test: `apps/backend/src/application/admin/tenant-figlia.spec.ts`

**Interfaces:**
- Consumes: `Tenant.parentTenantId`, `Tenant.aziendeLimit` (Task 1)
- Produces: `POST /api/v1/admin/tenants` accetta `parentTenantId`; regole: divieto di secondo livello, quota `aziendeLimit` con precedenza su `User.companyLimit`, nessuna eredità RENTRI

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `apps/backend/src/application/admin/tenant-figlia.spec.ts`:

```typescript
/**
 * Creazione di un'azienda figlia dentro un gruppo.
 *
 * Tre regole, tutte fail-closed:
 *  1. gerarchia a un solo livello: non si crea una figlia sotto una figlia;
 *  2. quota: se la madre ha `aziendeLimit`, comanda quello;
 *  3. nessuna eredita' RENTRI: la figlia nasce senza credenziale.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { TenantService } from './tenant.service'

const MADRE = 'tenant-madre-uuid'
const FIGLIA_ESISTENTE = 'tenant-figlia-uuid'
const ADMIN = 'utente-admin-uuid'

const dtoBase = {
  partitaIva: '12345678901',
  ragioneSociale: 'Nuova Figlia Srl',
  address: 'Via Roma 1',
  city: 'Roma',
  province: 'RM',
  postalCode: '00100',
}

function makeService(opts: { aziendeLimit: number | null; figlieEsistenti: number }) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === MADRE
            ? { id: MADRE, parentTenantId: null, aziendeLimit: opts.aziendeLimit }
            : { id: FIGLIA_ESISTENTE, parentTenantId: MADRE, aziendeLimit: null }
        )
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(opts.figlieEsistenti),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'nuovo-uuid', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ companyLimit: 99 }) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'ruolo-admin' }) },
    consultantTenantAssociation: { upsert: jest.fn().mockResolvedValue({}) },
    rentriCredential: { findUnique: jest.fn().mockResolvedValue(null) },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { prisma, service: new TenantService(prisma, logger) }
}

const adminCorrente = { id: ADMIN, role: 'ADMIN', tenantId: MADRE } as any

describe('TenantService — creazione azienda figlia', () => {
  it('rifiuta una figlia sotto una figlia (gerarchia a un solo livello)', async () => {
    const { service } = makeService({ aziendeLimit: 5, figlieEsistenti: 0 })

    await expect(
      service.create({ ...dtoBase, parentTenantId: FIGLIA_ESISTENTE } as any, adminCorrente)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rifiuta la creazione oltre aziendeLimit della madre', async () => {
    const { service } = makeService({ aziendeLimit: 3, figlieEsistenti: 3 })

    await expect(
      service.create({ ...dtoBase, parentTenantId: MADRE } as any, adminCorrente)
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('crea la figlia col legame alla madre quando la quota lo consente', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 5, figlieEsistenti: 2 })

    await service.create({ ...dtoBase, parentTenantId: MADRE } as any, adminCorrente)

    // Prisma vuole la relazione in forma `connect`, non la FK scalare: e' la
    // stessa forma gia' usata per `tenant`/`producerUser` altrove nel progetto.
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.madre.connect.id).toBe(MADRE)
  })

  it('la figlia nasce senza configurazione RENTRI ereditata dalla madre', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 5, figlieEsistenti: 0 })

    await service.create({ ...dtoBase, parentTenantId: MADRE } as any, adminCorrente)

    // Nessuna lettura della credenziale della madre e nessuna scrittura per la figlia:
    // certificato e iscrizioni appartengono a quella persona giuridica.
    expect(prisma.rentriCredential.findUnique).not.toHaveBeenCalled()
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data).not.toHaveProperty('rentriCredential')
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `cd apps/backend && npx jest src/application/admin/tenant-figlia.spec.ts`
Expected: FAIL — `parentTenantId` non è nel DTO né gestito da `create`; nessuna delle tre regole esiste.

- [ ] **Step 3: Aggiungere il campo al DTO**

In `apps/backend/src/api/admin/dto/create-tenant.dto.ts` aggiungi:

```typescript
  /**
   * Azienda madre del gruppo. Se valorizzato, il tenant creato e' una figlia:
   * eredita il contratto della madre e resta isolato dalle sorelle.
   */
  @ApiPropertyOptional({ description: 'Id dell\'azienda madre del gruppo' })
  @IsOptional()
  @IsUUID()
  parentTenantId?: string
```

(assicurati che `IsOptional`, `IsUUID` e `ApiPropertyOptional` siano importati).

- [ ] **Step 4: Applicare le tre regole in `create`**

In `tenant.service.ts`, dentro `create`, subito prima della costruzione di `subscriptionData` (riga ~152), inserisci:

```typescript
    // --- Gruppo: validazione della madre, se richiesta una figlia ---
    if (dto.parentTenantId) {
      const madre = await this.prisma.tenant.findUnique({
        where: { id: dto.parentTenantId },
        select: { id: true, parentTenantId: true, aziendeLimit: true },
      })
      if (!madre) {
        throw new BadRequestException('Azienda madre non trovata')
      }
      // Gerarchia a UN SOLO livello: senza questo vincolo servirebbero query
      // ricorsive e "chi vede cosa" diventerebbe un albero da risolvere a ogni
      // richiesta.
      if (madre.parentTenantId) {
        throw new BadRequestException(
          'Questa azienda e gia una figlia: non e possibile creare un gruppo dentro un gruppo.'
        )
      }
      // Quota di gruppo: se la madre la dichiara, comanda lei; altrimenti
      // resta in vigore il vecchio User.companyLimit di chi crea.
      if (madre.aziendeLimit !== null) {
        const figlie = await this.prisma.tenant.count({
          where: { parentTenantId: madre.id },
        })
        if (figlie >= madre.aziendeLimit) {
          throw new ForbiddenException(
            `Limite aziende del gruppo raggiunto (${figlie}/${madre.aziendeLimit}). ` +
              'Aggiorna il piano per aggiungere altre aziende.'
          )
        }
      }
    }
```

Poi, nella costruzione di `data: Prisma.TenantCreateInput` (riga ~191), aggiungi dopo `ownerUserId`:

```typescript
      ...(dto.parentTenantId ? { madre: { connect: { id: dto.parentTenantId } } } : {}),
```

Verifica che `BadRequestException` e `ForbiddenException` siano importati da `@nestjs/common`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `cd apps/backend && npx jest src/application/admin/`
Expected: PASS, 4 test. Se altri spec preesistenti costruiscono `TenantService` o chiamano `create`, verifica che restino verdi: il nuovo blocco di validazione si attiva **solo** quando `dto.parentTenantId` è valorizzato, quindi il comportamento senza gruppo non cambia.

- [ ] **Step 6: Suite completa e typecheck**

Run: `cd apps/backend && npx tsc -p tsconfig.json --noEmit && npx jest --runInBand --forceExit --silent`
Expected: typecheck pulito, tutte verdi.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/api/admin/dto/create-tenant.dto.ts apps/backend/src/application/admin/
git commit -m "feat(gruppo): creazione di aziende figlie con quota e divieto di secondo livello"
```

---

## Task 6: La suite che dimostra l'isolamento fra sorelle

**Files:**
- Create: `apps/backend/src/application/gruppo/isolamento-sorelle.postgres.spec.ts`

**Interfaces:**
- Consumes: tutto quanto costruito nei task precedenti
- Produces: la prova del requisito. È la consegna centrale del piano: senza questa suite il resto è un'affermazione non verificata

- [ ] **Step 1: Scrivere la suite di isolamento**

Crea `apps/backend/src/application/gruppo/isolamento-sorelle.postgres.spec.ts`:

```typescript
/**
 * ISOLAMENTO FRA AZIENDE SORELLE — la prova del requisito.
 *
 * Due figlie della stessa madre non devono vedersi NULLA a vicenda. Il test
 * gira su Postgres reale e passa dall'estensione RLS (prisma.db) dentro un
 * TenantContext, cioe' esattamente il percorso delle richieste HTTP.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { rlsExtension } from '../../infrastructure/persistence/prisma-rls.extension'

const base = new PrismaClient()
const db = base.$extends(rlsExtension)

const piva = (n: number) => String(Date.now() * 10 + n).slice(-11).padStart(11, '1')

describe('Isolamento fra aziende sorelle (Postgres reale)', () => {
  let madreId: string
  let alfaId: string
  let betaId: string
  let utenteAlfaId: string

  beforeAll(async () => {
    const madre = await base.tenant.create({
      data: { partitaIva: piva(1), ragioneSociale: 'Gruppo Madre Srl' },
    })
    madreId = madre.id
    const alfa = await base.tenant.create({
      data: { partitaIva: piva(2), ragioneSociale: 'Alfa Srl', parentTenantId: madre.id },
    })
    alfaId = alfa.id
    const beta = await base.tenant.create({
      data: { partitaIva: piva(3), ragioneSociale: 'Beta Srl', parentTenantId: madre.id },
    })
    betaId = beta.id

    const utenteAlfa = await base.user.create({
      data: {
        tenantId: alfaId,
        email: `alfa-${Date.now()}@example.it`,
        fiscalCode: `AAAAAA00A00A${String(Date.now()).slice(-3)}A`,
        // firstName e lastName sono NOT NULL nello schema: ometterli fa
        // fallire la create con un errore del driver, non un errore di test.
        firstName: 'Utente',
        lastName: 'Alfa',
        role: 'ADMIN',
        keycloakId: `kc-${Date.now()}`,
      },
    })
    utenteAlfaId = utenteAlfa.id

    // Un produttore per ciascuna sorella.
    await base.produttore.create({
      data: {
        tenantId: alfaId,
        ragioneSociale: 'Produttore di Alfa',
        partitaIVA: piva(4),
        via: 'Via Alfa',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
      },
    })
    await base.produttore.create({
      data: {
        tenantId: betaId,
        ragioneSociale: 'Produttore di Beta',
        partitaIVA: piva(5),
        via: 'Via Beta',
        civico: '2',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
      },
    })
  })

  afterAll(async () => {
    // onDelete: Cascade sui dati operativi; le figlie prima della madre.
    for (const id of [alfaId, betaId, madreId]) {
      await base.tenant.delete({ where: { id } }).catch(() => undefined)
    }
    await base.$disconnect()
  })

  it('Alfa non vede le anagrafiche di Beta', async () => {
    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const produttori = await db.produttore.findMany()

      expect(produttori).toHaveLength(1)
      expect(produttori[0].ragioneSociale).toBe('Produttore di Alfa')
    })
  })

  it('Alfa non raggiunge un produttore di Beta nemmeno conoscendone l id', async () => {
    const diBeta = await base.produttore.findFirst({ where: { tenantId: betaId } })

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const trovato = await db.produttore.findFirst({ where: { id: diBeta!.id } })

      expect(trovato).toBeNull()
    })
  })

  it('una scrittura di Alfa nasce dentro Alfa, non altrove', async () => {
    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const creato = await db.produttore.create({
        data: {
          ragioneSociale: 'Secondo produttore di Alfa',
          partitaIVA: piva(6),
          via: 'Via Alfa',
          civico: '3',
          cap: '00100',
          comune: 'Roma',
          provincia: 'RM',
        } as any,
      })

      expect(creato.tenantId).toBe(alfaId)
    })
  })

  it('il conteggio di Beta non include i dati di Alfa', async () => {
    await TenantContext.run({ tenantId: betaId, userId: utenteAlfaId }, async () => {
      const quanti = await db.produttore.count()

      expect(quanti).toBe(1)
    })
  })

  it('la configurazione RENTRI di Alfa non e visibile a Beta', async () => {
    await base.rentriCredential.create({
      data: {
        tenantId: alfaId,
        clientId: 'client-alfa',
        certificatePem: 'PEM-ALFA',
        privateKeyEnc: 'iv:tag:cipher',
      },
    })

    await TenantContext.run({ tenantId: betaId, userId: utenteAlfaId }, async () => {
      const credenziali = await db.rentriCredential.findMany()

      expect(credenziali).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: Eseguire la suite**

Run: `cd apps/backend && npm run test:postgres -- isolamento-sorelle`
Expected: PASS, 5 test. **Se anche uno solo fallisce, non proseguire**: significa che l'isolamento fra sorelle non tiene, ed è il requisito centrale del lavoro. Ferma il piano e riporta il fallimento.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/application/gruppo/isolamento-sorelle.postgres.spec.ts
git commit -m "test(gruppo): dimostra l'isolamento fra aziende sorelle su Postgres reale"
```

---

## Task 7: Vista d'insieme del gruppo

**Files:**
- Modify: `apps/backend/src/application/queries/handlers/get-aggregated-dashboard.handler.ts`
- Test: `apps/backend/src/application/queries/handlers/get-aggregated-dashboard.handler.spec.ts`

**Interfaces:**
- Consumes: `Tenant.parentTenantId` (Task 1)
- Produces: `GetAggregatedDashboardHandler.execute(query)` che restituisce `{ totalTenants, totalPendingFirs, totalRentriSyncFailures, pendingFirsByClient: Array<{tenantId, tenantName, pendingCount}>, upcomingDeadlines: Array<{tenantId, tenantName, year, status}>, recentActivity: Array<{tenantId, tenantName, activityType, activityDate, description}> }`

**Contesto obbligatorio da leggere prima di iniziare:** l'handler attuale è **rotto**. Le query raw leggono `t.name`, `m.type` e `m.deadline_date`, colonne che non esistono (`tenants` ha `ragione_sociale`; `mud_reports` ha `year` e `status`, non `type`/`deadline_date`). Vanno sostituite con Prisma, che è tipizzato e avrebbe impedito l'errore.

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `apps/backend/src/application/queries/handlers/get-aggregated-dashboard.handler.spec.ts`:

```typescript
/**
 * Vista d'insieme del gruppo: aggrega le figlie della madre.
 *
 * L'implementazione precedente usava query raw su colonne inesistenti
 * (t.name, m.type, m.deadline_date) e falliva a runtime.
 */
import { GetAggregatedDashboardHandler } from './get-aggregated-dashboard.handler'

const MADRE = 'tenant-madre-uuid'
const ALFA = 'tenant-alfa-uuid'
const BETA = 'tenant-beta-uuid'

function makePrisma() {
  return {
    tenant: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.parentTenantId === MADRE
            ? [
                { id: ALFA, ragioneSociale: 'Alfa Srl' },
                { id: BETA, ragioneSociale: 'Beta Srl' },
              ]
            : []
        )
      ),
    },
    fIR: {
      groupBy: jest.fn().mockResolvedValue([
        { tenantId: ALFA, _count: { _all: 3 } },
        { tenantId: BETA, _count: { _all: 1 } },
      ]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mUDReport: { findMany: jest.fn().mockResolvedValue([]) },
    rENTRISyncLog: { count: jest.fn().mockResolvedValue(2) },
  } as any
}

describe('GetAggregatedDashboardHandler', () => {
  it('aggrega le figlie della madre e somma i FIR da trasmettere', async () => {
    const prisma = makePrisma()
    const handler = new GetAggregatedDashboardHandler(prisma)

    const risultato = await handler.execute({ tenantIdMadre: MADRE } as any)

    expect(risultato.totalTenants).toBe(2)
    expect(risultato.totalPendingFirs).toBe(4)
    expect(risultato.pendingFirsByClient).toEqual([
      { tenantId: ALFA, tenantName: 'Alfa Srl', pendingCount: 3 },
      { tenantId: BETA, tenantName: 'Beta Srl', pendingCount: 1 },
    ])
    expect(risultato.totalRentriSyncFailures).toBe(2)
  })

  it('una madre senza figlie restituisce una vista vuota, non un errore', async () => {
    const prisma = makePrisma()
    prisma.tenant.findMany = jest.fn().mockResolvedValue([])
    const handler = new GetAggregatedDashboardHandler(prisma)

    const risultato = await handler.execute({ tenantIdMadre: 'senza-figlie' } as any)

    expect(risultato.totalTenants).toBe(0)
    expect(risultato.pendingFirsByClient).toEqual([])
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd apps/backend && npx jest src/application/queries/handlers/get-aggregated-dashboard.handler.spec.ts`
Expected: FAIL — l'handler attuale ha un costruttore con più dipendenze e legge le associazioni consulente, non le figlie.

- [ ] **Step 3: Riscrivere l'handler**

Sostituisci integralmente il corpo della classe in `get-aggregated-dashboard.handler.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'

export interface VistaGruppo {
  totalTenants: number
  totalPendingFirs: number
  totalRentriSyncFailures: number
  pendingFirsByClient: Array<{ tenantId: string; tenantName: string; pendingCount: number }>
  upcomingDeadlines: Array<{ tenantId: string; tenantName: string; year: number; status: string }>
  recentActivity: Array<{
    tenantId: string
    tenantName: string
    activityType: string
    activityDate: Date
    description: string
  }>
}

/**
 * Vista d'insieme del gruppo: aggrega le aziende FIGLIE della madre.
 *
 * E' l'unico punto dell'applicazione che legge piu' tenant in una sola
 * richiesta, e lo fa esplicitamente sull'elenco dei figli: non allarga il
 * contesto: per operare su un'azienda bisogna comunque selezionarla.
 *
 * Usa Prisma e non SQL raw: la versione precedente interrogava colonne
 * inesistenti (t.name, m.type, m.deadline_date) e falliva a runtime.
 */
@Injectable()
export class GetAggregatedDashboardHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: { tenantIdMadre: string }): Promise<VistaGruppo> {
    const figlie = await this.prisma.tenant.findMany({
      where: { parentTenantId: query.tenantIdMadre },
      select: { id: true, ragioneSociale: true },
      orderBy: { ragioneSociale: 'asc' },
    })

    if (figlie.length === 0) {
      return {
        totalTenants: 0,
        totalPendingFirs: 0,
        totalRentriSyncFailures: 0,
        pendingFirsByClient: [],
        upcomingDeadlines: [],
        recentActivity: [],
      }
    }

    const ids = figlie.map(f => f.id)
    const nome = new Map(figlie.map(f => [f.id, f.ragioneSociale]))

    const [perFir, mud, sincroniaFallite, ultimiFir] = await Promise.all([
      this.prisma.fIR.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, status: { in: ['DRAFT', 'AWAITING_CARRIER'] } },
        _count: { _all: true },
      }),
      this.prisma.mUDReport.findMany({
        where: { tenantId: { in: ids }, status: { not: 'SUBMITTED' } },
        select: { tenantId: true, year: true, status: true },
        orderBy: { year: 'desc' },
        take: 20,
      }),
      // Enum RENTRISyncLogStatus: PENDING | SUCCESS | FAILURE.
      // La vecchia query raw filtrava su 'FAILED', valore che non esiste.
      this.prisma.rENTRISyncLog.count({
        where: { tenantId: { in: ids }, status: 'FAILURE' },
      }),
      this.prisma.fIR.findMany({
        where: { tenantId: { in: ids } },
        select: { tenantId: true, firNumber: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    const pendingFirsByClient = figlie
      .map(f => ({
        tenantId: f.id,
        tenantName: f.ragioneSociale,
        pendingCount: perFir.find(g => g.tenantId === f.id)?._count._all ?? 0,
      }))
      .filter(r => r.pendingCount > 0)

    return {
      totalTenants: figlie.length,
      totalPendingFirs: pendingFirsByClient.reduce((s, r) => s + r.pendingCount, 0),
      totalRentriSyncFailures: sincroniaFallite,
      pendingFirsByClient,
      upcomingDeadlines: mud.map(m => ({
        tenantId: m.tenantId,
        tenantName: nome.get(m.tenantId) ?? m.tenantId,
        year: m.year,
        status: m.status,
      })),
      recentActivity: ultimiFir.map(f => ({
        tenantId: f.tenantId,
        tenantName: nome.get(f.tenantId) ?? f.tenantId,
        activityType: 'FIR_CREATO',
        activityDate: f.createdAt,
        description: `FIR ${f.firNumber}`,
      })),
    }
  }
}
```

- [ ] **Step 4: Allineare il chiamante**

In `apps/backend/src/api/permissions/consultant.controller.ts`, l'endpoint che invocava l'handler deve passare `{ tenantIdMadre: requireRequestTenantId(req) }` invece della query basata sull'utente consulente. Importa `requireRequestTenantId` da `../../core/context/resolve-request-tenant`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `cd apps/backend && npx jest src/application/queries/ src/api/permissions/`
Expected: PASS. Se esistono spec che costruiscono l'handler con la vecchia firma (repository delle associazioni consulente + logger), aggiornale alla nuova.

- [ ] **Step 6: Suite completa, typecheck, lint**

Run: `cd apps/backend && npx tsc -p tsconfig.json --noEmit && npx jest --runInBand --forceExit --silent`
Expected: typecheck pulito, tutte verdi.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/application/queries/ apps/backend/src/api/permissions/
git commit -m "fix(gruppo): vista d'insieme riscritta sui figli, senza le query raw rotte

L'handler leggeva t.name, m.type e m.deadline_date: colonne inesistenti,
quindi falliva a runtime benche' l'endpoint fosse cablato. Riscritto con
Prisma, che e' tipizzato e avrebbe impedito l'errore."
```

---

## Task 8: Selettore azienda gerarchico (frontend)

**Files:**
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (metodo `loadUserTenants`, righe ~1245-1260)
- Test: `apps/frontend/src/app/shared/components/layout.component.spec.ts`

**Interfaces:**
- Consumes: `GET /me/tenants` che ora restituisce `{ id, ragioneSociale, parentTenantId }` (Task 4)
- Produces: elenco ordinato con le figlie sotto la propria madre e indentate

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi in `apps/frontend/src/app/shared/components/layout.component.spec.ts` (crealo se assente, seguendo lo stile delle altre spec del progetto):

```typescript
import { ordinaAziendePerGruppo } from './layout.component'

describe('ordinaAziendePerGruppo', () => {
  it('mette ogni figlia sotto la propria madre e la marca come annidata', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'beta', name: 'Beta Srl', parentTenantId: 'madre' },
      { id: 'madre', name: 'Gruppo Madre Srl', parentTenantId: null },
      { id: 'alfa', name: 'Alfa Srl', parentTenantId: 'madre' },
    ])

    expect(risultato.map(a => a.id)).toEqual(['madre', 'alfa', 'beta'])
    expect(risultato.map(a => a.annidata)).toEqual([false, true, true])
  })

  it('lascia in elenco piatto le aziende senza gruppo', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'due', name: 'Due Srl', parentTenantId: null },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id)).toEqual(['due', 'uno'])
    expect(risultato.every(a => !a.annidata)).toBe(true)
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd apps/frontend && npx jest src/app/shared/components/layout.component.spec.ts` (oppure `npm test -- layout.component` secondo il runner configurato)
Expected: FAIL — `ordinaAziendePerGruppo` non esiste.

- [ ] **Step 3: Implementare la funzione**

In `layout.component.ts`, sopra la dichiarazione del componente, aggiungi ed esporta:

```typescript
export interface AziendaSelezionabile {
  id: string
  name: string
  parentTenantId?: string | null
  annidata?: boolean
}

/**
 * Ordina le aziende per gruppo: ogni figlia compare subito sotto la propria
 * madre e viene marcata `annidata` (il template la indenta). Le aziende senza
 * gruppo restano un elenco piatto nell'ordine ricevuto dal backend.
 */
export function ordinaAziendePerGruppo(
  aziende: AziendaSelezionabile[]
): Array<AziendaSelezionabile & { annidata: boolean }> {
  const figliePerMadre = new Map<string, AziendaSelezionabile[]>()
  for (const a of aziende) {
    if (!a.parentTenantId) continue
    const gruppo = figliePerMadre.get(a.parentTenantId) ?? []
    gruppo.push(a)
    figliePerMadre.set(a.parentTenantId, gruppo)
  }

  const risultato: Array<AziendaSelezionabile & { annidata: boolean }> = []
  for (const a of aziende) {
    if (a.parentTenantId) continue
    risultato.push({ ...a, annidata: false })
    for (const figlia of figliePerMadre.get(a.id) ?? []) {
      risultato.push({ ...figlia, annidata: true })
    }
  }

  // Figlie la cui madre non e' accessibile all'utente: non vanno perse.
  for (const a of aziende) {
    if (a.parentTenantId && !risultato.some(r => r.id === a.id)) {
      risultato.push({ ...a, annidata: false })
    }
  }

  return risultato
}
```

- [ ] **Step 4: Usarla nel caricamento e indentare nel template**

In `loadUserTenants`, sostituisci `this.userTenants.set(mapped)` con:

```typescript
          this.userTenants.set(ordinaAziendePerGruppo(mapped))
```

e nel mapping conserva il legame aggiungendo `parentTenantId: t.parentTenantId ?? null` all'oggetto costruito.

Nel template del selettore, applica l'indentazione alle voci annidate (classe CSS `azienda-annidata` con `padding-left: 1.25rem`).

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `cd apps/frontend && npx jest src/app/shared/components/layout.component.spec.ts`
Expected: PASS, 2 test.

- [ ] **Step 6: Suite frontend completa**

Run: `cd apps/frontend && npm test`
Expected: tutte verdi.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/shared/components/
git commit -m "feat(gruppo): selettore azienda con le figlie annidate sotto la madre"
```

---

## Self-Review del piano

**Copertura della spec** — ogni sezione ha un task:

| Sezione spec | Task |
|---|---|
| §3 Modello dati (`parentTenantId`, un livello, Restrict) | 1 (colonne + FK), 5 (divieto secondo livello) |
| §4 Isolamento fra sorelle | 6 |
| §5 Contratto sulla madre, tetto FIR per azienda, quota | 2, 3 (contratto e tetto), 5 (quota `aziendeLimit`) |
| §6 Accesso dall'alto, selettore gerarchico | 4 (backend), 8 (frontend) |
| §7 Visione d'insieme | 7 |
| §8 RENTRI senza eredità | 5 (test dedicato) |
| §9 Test 1-8 | 6 (1,2,3 isolamento), 3 (4 contratto, 5 tetto), 5 (6 un livello, 8 quota), 1 (7 cancellazione) |
| §10 Migrazione additiva | 1 |

**Rimasto volutamente fuori:** la RLS nativa Postgres (spec §12, «va chiuso a parte, con verifica su database reale») e l'unificazione dei due `PrismaService`. Nessuno dei due è introdotto da questo lavoro.

**Coerenza dei tipi:** `ContrattoEffettivo` è definita in Task 2 e usata in 3; `checkAccess(userId, targetTenantId, primaryTenantId)` mantiene la firma esistente; `VistaGruppo` è definita e usata solo in Task 7; `AziendaSelezionabile` solo in Task 8. `aziendeLimit` è `Int?` in Task 1 e trattato come `number | null` ovunque.
