/**
 * RLS pezzo 4, Task 5: i percorsi di gruppo, di cambio azienda e delle rotte pubbliche con la
 * RLS ATTIVA, collegandosi come in produzione: `creaPrismaServiceApplicativo()` come
 * `wasteflow_app` (via `DATABASE_URL`) e `PrismaSistemaService` come `wasteflow_sistema` (via
 * `DATABASE_URL_SISTEMA`). Handler e servizi sono quelli veri; il proprietario (`wasteflow`)
 * prepara i dati e rilegge cio' che e' stato scritto.
 *
 * Finti, e solo questi, perche' sono esterni e non Prisma: la firma e il client di Stripe, la
 * coda, la posta, le cache Redis, il firmatario JWT e il logger.
 *
 * Il percorso SAML vivo e' `auth/strategies/spid.strategy.ts` (i file sotto `infrastructure/keycloak`
 * e `application/auth/handle-spid-callback.use-case.ts` sono codice morto e non si provano).
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ForbiddenException } from '@nestjs/common'
import * as jwt from 'jsonwebtoken'
import { defer, from, lastValueFrom } from 'rxjs'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono queste due variabili, come in produzione. Prisma 5 le legge
// al `$connect`: restano impostate per tutto lo spec.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { TenantContext } from '../../core/context/tenant-context'
import { TenantContextMiddleware } from '../../core/middleware/tenant-context.middleware'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { GetAggregatedDashboardHandler } from '../../application/queries/handlers/get-aggregated-dashboard.handler'
import { MembershipService } from '../../api/me/membership.service'
import { SwitchTenantContextCommandHandler } from '../../application/commands/handlers/switch-tenant-context.handler'
import { SwitchTenantContextCommand } from '../../application/commands/switch-tenant-context.command'
import { PrismaConsultantTenantAssociationRepository } from './consultant-tenant-association.repository'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { DigitalSignatureService } from '../../application/signatures/digital-signature.service'
import { SignatureFIRRepository } from '../signatures/signature-fir.repository'
import { AccessRequestService } from '../../application/access-request/access-request.service'
import { BillingService } from '../../application/billing/billing.service'
import { SpidStrategy } from '../../auth/strategies/spid.strategy'
import { SignatureAuditHandler } from '../../application/signatures/signature-audit.handler'

const logger = { setContext() {}, info() {}, warn() {}, error() {}, debug() {}, log() {} } as never
const SEGRETO_JWT = 'segreto-di-prova-gruppi-rotte'

describe('RLS: gruppi, cambio azienda e rotte pubbliche col ruolo applicativo (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService

  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  const tenantIds: string[] = []
  let madre = ''
  let figlia1 = ''
  let figlia2 = ''
  let studio = '' // azienda primaria del consulente
  let estranea = '' // nessuna parentela, nessuna associazione
  let utenteStudio = ''
  let utenteFiglia1 = ''
  let ruoloId = ''
  let firFiglia1 = ''
  let firFiglia2 = ''
  let firStudio = ''
  let firEstranea = ''
  let contatore = 0

  const nelContesto = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function creaAzienda(tag: string, extra: object = {}) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `G${tag}${sfx}`.slice(0, 11),
        ragioneSociale: `GruppiRotte ${tag} ${run}`,
        codiceFiscale: `GRP${tag}${sfx}`.slice(0, 16),
        ...extra,
      },
    })
    tenantIds.push(t.id)
    return t.id
  }

  async function creaUtente(tenantId: string, nome: string, cf?: string) {
    return (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-gruppi-${nome}-${run}`,
          fiscalCode: cf ?? `GRPTNT00A00A${String(100 + contatore++)}Z`,
          firstName: 'Prova',
          lastName: nome,
          email: `gruppi-${nome}-${run}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  }

  async function creaFir(tenantId: string, userId: string, stato: 'DRAFT' | 'AWAITING_RECEIVER') {
    return (
      await owner.fIR.create({
        data: {
          tenantId,
          status: stato,
          producerUserId: userId,
          producerPartitaIva: '12345678903',
          producerName: 'Produttore',
          producerAddress: 'Via Roma 1',
          carrierPartitaIva: '12345678903',
          carrierName: 'Trasportatore',
          carrierVehiclePlate: 'AA111BB',
          receiverPartitaIva: '12345678903',
          receiverName: 'Destinatario',
          receiverAddress: 'Via Roma 2',
          cerCode: '150101',
          wasteDescription: 'Imballaggi',
          wasteCategory: 'Non pericoloso',
          quantity: 10,
          transportDate: new Date('2026-10-01'),
        },
      })
    ).id
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    await sistema.$connect()

    madre = await creaAzienda('M')
    figlia1 = await creaAzienda('F1', { parentTenantId: madre })
    figlia2 = await creaAzienda('F2', { parentTenantId: madre })
    studio = await creaAzienda('S')
    estranea = await creaAzienda('E')

    utenteStudio = await creaUtente(studio, 'studio')
    utenteFiglia1 = await creaUtente(figlia1, 'figlia1', 'RSSMRA80A01H501U')
    const uEstranea = await creaUtente(estranea, 'estranea')
    const uFiglia2 = await creaUtente(figlia2, 'figlia2')

    ruoloId = (
      await owner.role.create({
        data: { tenantId: figlia1, name: `CONS-${run}`, createdBy: utenteStudio },
      })
    ).id
    await owner.consultantTenantAssociation.create({
      data: {
        consultantUserId: utenteStudio,
        tenantId: figlia1,
        roleId: ruoloId,
        addedBy: utenteStudio,
      },
    })

    // Due FIR in bozza per figlia, uno per lo studio, uno per l'estranea.
    firFiglia1 = await creaFir(figlia1, utenteFiglia1, 'DRAFT')
    await creaFir(figlia1, utenteFiglia1, 'DRAFT')
    firFiglia2 = await creaFir(figlia2, uFiglia2, 'DRAFT')
    firStudio = await creaFir(studio, utenteStudio, 'DRAFT')
    firEstranea = await creaFir(estranea, uEstranea, 'DRAFT')
  })

  afterAll(async () => {
    if (tenantIds.length) {
      const dove = { tenantId: { in: tenantIds } }
      await owner.activityLog.deleteMany({ where: dove })
      await owner.fIRSignature.deleteMany({ where: dove })
      await owner.fIR.deleteMany({ where: dove })
      await owner.consultantTenantAssociation.deleteMany({ where: dove })
      await owner.role.deleteMany({ where: dove })
      await owner.user.deleteMany({ where: dove })
      await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    }
    await owner.accessRequest.deleteMany({ where: { email: `gruppi-ar-${run}@example.it` } })
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  it('i servizi dell applicazione sono collegati coi ruoli giusti', async () => {
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    const [s] = await sistema.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    expect(a.u).toBe('wasteflow_app')
    expect(s.u).toBe('wasteflow_sistema')
  })

  describe('1. cruscotto di gruppo', () => {
    it('madre con due figlie: i dati di entrambe, niente dell estranea e della piattaforma', async () => {
      const handler = new GetAggregatedDashboardHandler(app)
      const vista = await nelContesto(madre, () => handler.execute({ tenantIdMadre: madre }))

      expect(vista.totalTenants).toBe(2)
      expect(vista.totalPendingFirs).toBe(3)
      const perId = Object.fromEntries(
        vista.pendingFirsByClient.map(r => [r.tenantId, r.pendingCount])
      )
      expect(perId).toEqual({ [figlia1]: 2, [figlia2]: 1 })
      const idVisti = new Set([
        ...vista.pendingFirsByClient.map(r => r.tenantId),
        ...vista.recentActivity.map(r => r.tenantId),
        ...vista.upcomingDeadlines.map(r => r.tenantId),
      ])
      expect(idVisti.has(estranea)).toBe(false)
      expect(idVisti.has(studio)).toBe(false)
      expect(idVisti.has(AZIENDA_PIATTAFORMA_ID)).toBe(false)
      expect(vista.recentActivity).toHaveLength(3)
    })

    it('un azienda estranea come "madre" non ha figlie e non vede quelle altrui', async () => {
      const handler = new GetAggregatedDashboardHandler(app)
      const vista = await nelContesto(estranea, () => handler.execute({ tenantIdMadre: estranea }))
      expect(vista.totalTenants).toBe(0)
      expect(vista.totalPendingFirs).toBe(0)
    })
  })

  describe('2. consulente: elenco, accesso, switch-tenant, X-Tenant-ID', () => {
    const jwtTokens = {
      generateTokenPair: (p: { tenantId: string }) => ({ accessToken: `t-${p.tenantId}` }),
    }
    const membership = () => new MembershipService(app, sistema, jwtTokens as never)
    const utente = () => ({
      id: utenteStudio,
      email: 'x@example.it',
      tenantId: studio,
      role: 'ADMIN',
      permissions: [],
    })

    it('listTenants e checkAccess: l azienda associata si, quella non associata no', async () => {
      const m = membership()
      const elenco = await m.listTenants(utente() as never)
      const ids = elenco.tenants.map(t => t.id)
      expect(ids.sort()).toEqual([studio, figlia1].sort())
      expect(ids).not.toContain(estranea)
      expect(ids).not.toContain(AZIENDA_PIATTAFORMA_ID)

      expect(await m.checkAccess(utenteStudio, figlia1, studio)).toBe(true)
      expect(await m.checkAccess(utenteStudio, estranea, studio)).toBe(false)
      // La gerarchia scende soltanto: essere associati a una figlia non da' la madre ne' la sorella.
      expect(await m.checkAccess(utenteStudio, madre, studio)).toBe(false)
      expect(await m.checkAccess(utenteStudio, figlia2, studio)).toBe(false)
    })

    it('il proprietario di una madre vede anche le figlie (discesa gerarchica)', async () => {
      await owner.tenant.update({ where: { id: madre }, data: { ownerUserId: utenteStudio } })
      try {
        const m = membership()
        const ids = (await m.listTenants(utente() as never)).tenants.map(t => t.id)
        expect(ids.sort()).toEqual([studio, madre, figlia1, figlia2].sort())
        expect(await m.checkAccess(utenteStudio, figlia2, studio)).toBe(true)
      } finally {
        await owner.tenant.update({ where: { id: madre }, data: { ownerUserId: null } })
      }
    })

    it('SwitchTenantContextCommandHandler: associazione letta col client di sistema', async () => {
      const repo = new PrismaConsultantTenantAssociationRepository(app, sistema)
      const emesso: unknown[] = []
      const emitter = new EventEmitter2()
      emitter.on('tenant.context.switched', e => emesso.push(e))
      const handler = new SwitchTenantContextCommandHandler(
        repo,
        { invalidateUser: async () => undefined } as never,
        {} as never,
        { signAsync: async (p: { tenantId: string }) => `jwt-${p.tenantId}` } as never,
        emitter
      )
      const esito = await handler.execute(
        new SwitchTenantContextCommand(utenteStudio, studio, figlia1)
      )
      expect(esito).toMatchObject({ newJwt: `jwt-${figlia1}`, tenantId: figlia1, roleId: ruoloId })
      expect(emesso).toHaveLength(1)
      await expect(
        handler.execute(new SwitchTenantContextCommand(utenteStudio, studio, estranea))
      ).rejects.toMatchObject({ status: 404 })
    })

    it('MembershipService.switchTenant: nuovo token sull azienda scelta, rifiutato sull estranea', async () => {
      const m = membership()
      const esito = await m.switchTenant(utente() as never, figlia1)
      expect(esito.tenantId).toBe(figlia1)
      await expect(m.switchTenant(utente() as never, estranea)).rejects.toBeInstanceOf(
        ForbiddenException
      )
    })

    describe('lettura con X-Tenant-ID (middleware + TenantSwitchInterceptor + contesto reali)', () => {
      const middleware = () =>
        new TenantContextMiddleware({ get: () => SEGRETO_JWT } as unknown as ConfigService)
      const interceptor = () => new TenantSwitchInterceptor(membership(), new Reflector())

      /** Percorre la catena come una richiesta HTTP e restituisce cio' che il "controller" legge col client app. */
      async function richiesta(header: string): Promise<string[]> {
        const token = jwt.sign(
          { sub: utenteStudio, tenantId: studio, role: 'ADMIN', type: 'access' },
          SEGRETO_JWT
        )
        const req: Record<string, unknown> = {
          headers: { authorization: `Bearer ${token}`, 'x-tenant-id': header },
          user: { id: utenteStudio, tenantId: studio, role: 'ADMIN' },
        }
        const ctx = {
          getType: () => 'http',
          switchToHttp: () => ({ getRequest: () => req }),
          getHandler: () => function handler() {},
          getClass: () => class Controller {},
        }
        const letto = async () => {
          const righe = await app.fIR.findMany({ select: { id: true, tenantId: true } })
          return righe.map(r => r.id)
        }
        return await new Promise<string[]>((resolve, reject) => {
          middleware().use(req as never, {} as never, () => {
            const flusso = interceptor().intercept(ctx as never, {
              handle: () => defer(() => from(letto())),
            })
            lastValueFrom(flusso).then(v => resolve(v as string[]), reject)
          })
        })
      }

      it('verso la figlia associata: vede i suoi FIR e nessun altro', async () => {
        const visti = await richiesta(figlia1)
        expect(visti.sort()).toEqual(
          (await owner.fIR.findMany({ where: { tenantId: figlia1 } })).map(f => f.id).sort()
        )
        expect(visti).toContain(firFiglia1)
        expect(visti).not.toContain(firStudio)
        expect(visti).not.toContain(firFiglia2)
        expect(visti).not.toContain(firEstranea)
      })

      it('verso un azienda non associata: 403, nessun dato', async () => {
        await expect(richiesta(estranea)).rejects.toBeInstanceOf(ForbiddenException)
        await expect(richiesta(figlia2)).rejects.toBeInstanceOf(ForbiddenException)
      })

      it('senza header sul percorso del consulente: vale solo la sua azienda', async () => {
        const visti = await nelContesto(studio, async () =>
          (await app.fIR.findMany({ select: { id: true } })).map(r => r.id)
        )
        expect(visti).toEqual([firStudio])
      })
    })
  })

  describe('3. rotte pubbliche', () => {
    it('verify pubblica di un FIR: use case senza tenant, lettura col client di sistema', async () => {
      const repo = new SignatureFIRRepository(app, sistema, logger)
      const useCase = new VerifySignaturesUseCase(repo, new DigitalSignatureService(logger), logger)
      const esito = await useCase.execute({ firId: firFiglia1 })
      expect(esito.firId).toBe(firFiglia1)
      expect(esito.signatureCount).toBe(0)
      // Con l'azienda sbagliata il FIR non esiste (client app + RLS), come per l'utente autenticato.
      await expect(useCase.execute({ firId: firFiglia1, tenantId: estranea })).rejects.toThrow()
      // Un id inesistente e' un "non trovato", non un errore del database.
      await expect(useCase.execute({ firId: randomUUID() })).rejects.toThrow()
    })

    it('access-request pubblica: la richiesta si scrive col client app, senza contesto', async () => {
      const email = { sendEmail: async () => undefined, send: async () => undefined }
      const service = new AccessRequestService(app, email as never, logger)
      const esito = await service.submit({
        ragioneSociale: `Richiedente ${run}`,
        firstName: 'Anna',
        lastName: 'Verdi',
        email: `gruppi-ar-${run}@example.it`,
      } as never)
      expect(esito.requestId).toBeTruthy()
      const riga = await owner.accessRequest.findUnique({ where: { id: esito.requestId } })
      expect(riga?.status).toBe('PENDING')
      expect((await service.list()).some(r => r.id === esito.requestId)).toBe(true)
    })

    describe('webhook Stripe', () => {
      const billing = () =>
        new BillingService(
          app,
          {} as never,
          { get: () => undefined } as unknown as ConfigService,
          {} as never
        )
      const cliente = () => `cus_gruppi_${run}`

      beforeAll(async () => {
        await owner.tenant.update({ where: { id: studio }, data: { stripeCustomerId: cliente() } })
      })

      it('subscription.updated: findTenantByCustomerId senza contesto, poi l aggiornamento', async () => {
        const evento = {
          id: `evt_${run}_1`,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: `sub_${run}`,
              customer: cliente(),
              status: 'active',
              metadata: {},
              items: { data: [{ price: { id: 'price_sconosciuto' } }] },
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          },
        }
        await billing().processWebhookEvent(evento as never)
        const t = await owner.tenant.findUnique({ where: { id: studio } })
        expect(t?.stripeSubscriptionId).toBe(`sub_${run}`)
        expect(t?.subscriptionStatus).toBe('ACTIVE')
      })

      it('subscription.deleted: l azienda torna in prova e scaduta', async () => {
        const evento = {
          id: `evt_${run}_2`,
          type: 'customer.subscription.deleted',
          data: { object: { id: `sub_${run}`, customer: cliente(), metadata: {} } },
        }
        await billing().processWebhookEvent(evento as never)
        const t = await owner.tenant.findUnique({ where: { id: studio } })
        expect(t?.subscriptionStatus).toBe('EXPIRED')
        expect(t?.stripeSubscriptionId).toBeNull()
      })

      it('un cliente Stripe sconosciuto non tocca nessuna azienda', async () => {
        const prima = await owner.tenant.findUnique({ where: { id: estranea } })
        await billing().processWebhookEvent({
          id: `evt_${run}_3`,
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_x', customer: `cus_nessuno_${run}`, metadata: {} } },
        } as never)
        const dopo = await owner.tenant.findUnique({ where: { id: estranea } })
        expect(dopo?.subscriptionStatus).toBe(prima?.subscriptionStatus)
      })
    })

    it('callback SPID: lookup utente per codice fiscale col client di sistema', async () => {
      const strategia = new SpidStrategy(
        { get: () => undefined } as unknown as ConfigService,
        sistema
      )
      const utente = await strategia.validate({
        fiscalCode: 'RSSMRA80A01H501U',
        email: 'x@example.it',
      } as never)
      expect(utente.id).toBe(utenteFiglia1)
      await expect(
        strategia.validate({ fiscalCode: 'NNNNNN00A00A000A', email: 'x@example.it' } as never)
      ).rejects.toThrow()
      // Il client app, fuori da un contesto, non trova lo stesso utente (RLS).
      expect(await app.user.findMany({ where: { fiscalCode: 'RSSMRA80A01H501U' } })).toEqual([])
    })
  })

  it('signature-audit.handler su FIR_SIGNED: la riga di audit si scrive nell azienda del contesto', async () => {
    const handler = new SignatureAuditHandler(app, logger)
    const emitter = new EventEmitter2()
    emitter.on('FIR_SIGNED', e => handler.handleFIRSigned(e))
    const evento = {
      userId: utenteFiglia1,
      occurredOn: new Date(),
      payload: {
        tenantId: figlia1,
        firId: firFiglia1,
        firNumber: `FIR-${run}`,
        role: 'PRODUCER',
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        signatureMethod: 'SPID',
        signedAt: new Date(),
        newStatus: 'EMESSO',
      },
    }
    await nelContesto(figlia1, async () => {
      emitter.emit('FIR_SIGNED', evento)
      for (let i = 0; i < 40; i++) {
        if ((await owner.activityLog.count({ where: { tenantId: figlia1 } })) > 0) break
        await new Promise(r => setTimeout(r, 50))
      }
    })
    const righe = await owner.activityLog.findMany({ where: { tenantId: figlia1 } })
    expect(righe.map(r => r.action)).toEqual(['PRODUCER_SIGNATURE_APPLIED'])
    expect(righe[0].firId).toBe(firFiglia1)
  })

  describe('azienda piattaforma', () => {
    it('non compare nel cruscotto di gruppo ne nell elenco del consulente, nemmeno con tutte le aziende in gioco', async () => {
      const piattaforma = await owner.tenant.findUnique({ where: { id: AZIENDA_PIATTAFORMA_ID } })
      expect(piattaforma).not.toBeNull()

      const vista = await nelContesto(madre, () =>
        new GetAggregatedDashboardHandler(app).execute({ tenantIdMadre: madre })
      )
      const nomi = JSON.stringify(vista)
      expect(nomi).not.toContain(AZIENDA_PIATTAFORMA_ID)
      expect(nomi).not.toContain(piattaforma!.ragioneSociale)

      const m = new MembershipService(app, sistema, {} as never)
      const elenco = await m.listTenants({
        id: utenteStudio,
        email: 'x@example.it',
        tenantId: studio,
        role: 'ADMIN',
        permissions: [],
      } as never)
      expect(elenco.tenants.map(t => t.id)).not.toContain(AZIENDA_PIATTAFORMA_ID)
      // E' una riga reale, ma raggiungibile solo se la si cerca per id: nessun utente vi e' associato.
      expect(await m.checkAccess(utenteStudio, AZIENDA_PIATTAFORMA_ID, studio)).toBe(false)
    })
  })
})
