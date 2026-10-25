/**
 * Azienda tecnica "piattaforma" (RLS pezzo 4, Task 4) su Postgres reale con la RLS ATTIVA:
 *  - la riga della migration esiste una volta sola, con valori neutri;
 *  - il job `audit-logging` scrive nell'azienda piattaforma col ruolo `wasteflow_app` e la
 *    catena di hash resta valida;
 *  - l'azienda piattaforma non compare nell'elenco del super admin ne' nelle scansioni dei cron,
 *    NEMMENO quando fosse (per errore) attiva: l'esclusione e' del filtro, non dello stato.
 *
 * Eseguire con `npm run test:postgres`. Il proprietario (`wasteflow`) prepara e ripristina;
 * la riga piattaforma non viene mai cancellata (solo ripristinata a SUSPENDED).
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { PrismaPermissionAuditLogRepository } from './permission-audit-log.repository'
import { AuditLoggingProcessor } from '../jobs/audit-logging.job'
import { AuditPiattaformaService } from '../../application/admin/audit-piattaforma.service'
import { TenantService } from '../../application/admin/tenant.service'
import { DeadlineCheckerService } from '../../application/notifications/deadline-checker.service'

const logger = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} } as never

describe('Azienda piattaforma (Postgres reale, RLS attiva)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  const run = randomUUID().replace(/-/g, '')
  const utente = randomUUID()
  const sfx = Date.now().toString().slice(-8)
  let clienteId = ''

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.$connect()
    const [{ u }] = await app.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    expect(u).toBe('wasteflow_app')
    sistema = new PrismaSistemaService()
    await sistema.$connect()
    const t = await owner.tenant.create({
      data: { partitaIva: `PI${sfx}`.slice(0, 11), ragioneSociale: `Cliente ${run}` },
    })
    clienteId = t.id
  })

  afterAll(async () => {
    await owner.permissionAuditLog.deleteMany({ where: { userId: utente } })
    await owner.tenant.update({
      where: { id: AZIENDA_PIATTAFORMA_ID },
      data: { subscriptionStatus: 'SUSPENDED' },
    })
    await owner.tenant.delete({ where: { id: clienteId } })
    await app.$disconnect()
    await sistema.$disconnect()
    await owner.$disconnect()
  })

  it('la riga esiste una volta sola, con valori neutri', async () => {
    const righe = await owner.tenant.findMany({ where: { id: AZIENDA_PIATTAFORMA_ID } })
    expect(righe).toHaveLength(1)
    const t = righe[0]
    expect(t.subscriptionStatus).toBe('SUSPENDED')
    expect(t.subscriptionTier).toBe('TRIAL')
    expect(t.firLimitPerMonth).toBe(0)
    expect(t.userLimitTotal).toBe(0)
    expect(t.mudNonDovuto).toBe(true)
    expect(t.rentriModalitaLegame).toBe('MANUALE')
    expect(t.stripeCustomerId).toBeNull()
    expect(t.ownerUserId).toBeNull()
    expect(t.parentTenantId).toBeNull()
  })

  it('audit-logging scrive nell azienda piattaforma col ruolo app, catena di hash valida', async () => {
    const repo = new PrismaPermissionAuditLogRepository(app)
    const job = new AuditLoggingProcessor({ save: jest.fn() } as never, repo)
    const evento = (azione: string) =>
      ({
        id: randomUUID(),
        attemptsMade: 0,
        data: {
          type: 'permission-check',
          data: {
            userId: utente,
            tenantId: AZIENDA_PIATTAFORMA_ID,
            actionAttempted: azione,
            resourceType: 'tenant',
            decision: 'ALLOW',
            // Colonne NOT NULL (spid_fiscal_code, session_id): oggi la richiesta API non le porta.
            spidFiscalCode: 'TESTSPID0000000A',
            sessionId: 'sessione-di-prova',
            timestamp: new Date().toISOString(),
          },
        },
      }) as never
    await job.process(evento('tenant:read:all'))
    await new Promise(r => setTimeout(r, 5))
    await job.process(evento('tenant:update:all'))

    const righe = await owner.permissionAuditLog.findMany({
      where: { userId: utente },
      orderBy: { timestamp: 'asc' },
    })
    expect(righe).toHaveLength(2)
    expect(righe.every(r => r.tenantId === AZIENDA_PIATTAFORMA_ID)).toBe(true)
    expect(righe[1].previousEntryHash).toBe(righe[0].currentHash)

    // Il super admin la legge selezionando l'azienda piattaforma nel contesto (X-Tenant-ID).
    const lette = await TenantContext.run(
      { tenantId: AZIENDA_PIATTAFORMA_ID },
      async () => await app.permissionAuditLog.findMany({ where: { userId: utente } })
    )
    expect(lette).toHaveLength(2)
    // Un'altra azienda non la vede.
    const altra = await TenantContext.run(
      { tenantId: clienteId },
      async () => await app.permissionAuditLog.findMany({ where: { userId: utente } })
    )
    expect(altra).toHaveLength(0)
  })

  it('il servizio dedicato legge l audit della piattaforma dal client di sistema, hash valido', async () => {
    // Nel contesto di un'altra azienda la RLS nasconderebbe le righe al client app: il sistema le vede.
    const risultato = await TenantContext.run(
      { tenantId: clienteId },
      async () => await new AuditPiattaformaService(sistema).leggi({ perPagina: 200 })
    )
    const mie = risultato.logs.filter(l => l.userId === utente)
    expect(mie).toHaveLength(2)
    expect(mie.every(l => l.hashValido)).toBe(true)
    expect(risultato.totale).toBeGreaterThanOrEqual(2)
  })

  describe('esclusione dalle viste applicative (anche con la riga attiva)', () => {
    beforeAll(async () => {
      await owner.tenant.update({
        where: { id: AZIENDA_PIATTAFORMA_ID },
        data: { subscriptionStatus: 'ACTIVE' },
      })
    })
    afterAll(async () => {
      await owner.tenant.update({
        where: { id: AZIENDA_PIATTAFORMA_ID },
        data: { subscriptionStatus: 'SUSPENDED' },
      })
    })

    it('elenco aziende del super admin e dell admin', async () => {
      const service = new TenantService(app, sistema, logger, {} as never)
      const superAdmin = await service.list({
        id: utente,
        role: 'SUPER_ADMIN',
        tenantId: '',
      } as never)
      expect(superAdmin.some((t: { id: string }) => t.id === clienteId)).toBe(true)
      expect(superAdmin.some((t: { id: string }) => t.id === AZIENDA_PIATTAFORMA_ID)).toBe(false)

      // Anche un ADMIN che per assurdo avesse la piattaforma come azienda non la elenca.
      const admin = await TenantContext.run(
        { tenantId: AZIENDA_PIATTAFORMA_ID },
        async () =>
          await service.list({
            id: utente,
            role: 'ADMIN',
            tenantId: AZIENDA_PIATTAFORMA_ID,
          } as never)
      )
      expect(admin.some((t: { id: string }) => t.id === AZIENDA_PIATTAFORMA_ID)).toBe(false)
    })

    it('scansione dei cron (deadline-checker, certificati RENTRI)', async () => {
      const letti: string[][] = []
      const originale = sistema.tenant.findMany.bind(sistema.tenant)
      const spia = jest.spyOn(sistema.tenant, 'findMany').mockImplementation((async (
        args: never
      ) => {
        const r = (await originale(args)) as { id: string }[]
        letti.push(r.map(t => t.id))
        return r
      }) as never)
      try {
        const checker = new DeadlineCheckerService(
          app,
          sistema,
          {} as never,
          {} as never,
          logger,
          {} as never
        )
        await checker.checkRentriCertificateExpiration()
      } finally {
        spia.mockRestore()
      }
      expect(letti.length).toBeGreaterThan(0)
      expect(letti.flat()).toContain(clienteId)
      expect(letti.flat()).not.toContain(AZIENDA_PIATTAFORMA_ID)
    })
  })
})
