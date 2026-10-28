import { ConflictException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { MudPresentazioneService } from './mud-presentazione.service'
import { MudVersionRegistry } from './export/mud-version.registry'

/**
 * Segnatura della presentazione contro un Postgres reale: due segnature concorrenti dello
 * stesso anno non passano entrambe. Il controllo «già presentato» gira sotto il lock del report,
 * quindi la seconda legge lo stato scritto dalla prima e riceve 409; un finto non lo dimostra.
 */
function idObbligatorio(id: string | undefined): string {
  if (!id) throw new Error('dato di prova non creato: nessuna cancellazione senza filtro')
  return id
}

describe('MudPresentazioneService — Postgres reale', () => {
  let prisma: PrismaClient
  let service: MudPresentazioneService
  let tenantId: string
  let userA: string
  let userB: string
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  async function utente(nome: string, fiscalCode: string) {
    const suffisso = `${Date.now()}${Math.floor(Math.random() * 100000)}`
    const u = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-presentazione-${nome}-${suffisso}`,
        fiscalCode,
        firstName: 'Mario',
        lastName: nome,
        email: `presentazione-${nome}-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return u.id
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    const suffisso = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)
    const t = await prisma.tenant.create({
      data: { partitaIva: `MP${suffisso}`, ragioneSociale: 'Presentazione MUD SRL', country: 'IT' },
    })
    tenantId = t.id
    userA = await utente('a', 'RSSMRA80A01H501U')
    userB = await utente('b', 'VRDLGU80A01H501X')
    const aggregazione = {
      aggrega: jest.fn().mockResolvedValue({
        anno: 2025,
        righe: [],
        controlli: [],
        dichiarante: { atecoNormalizzato: '381100', comuneCode: '058091' },
        movimentiPerCer: {},
        pericolosiPerCer: {},
        mudNonDovuto: false,
      }),
    }
    service = new MudPresentazioneService(
      prisma as any,
      new MudVersionRegistry(),
      aggregazione as any,
      logger
    )
  })

  afterAll(async () => {
    // Solo le righe create qui: con un id `undefined` Prisma toglierebbe il filtro.
    if (tenantId) {
      await prisma.activityLog.deleteMany({ where: { tenantId } })
      await prisma.mUDReport.deleteMany({ where: { tenantId } })
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.tenant.deleteMany({ where: { id: tenantId } })
    }
    await prisma.$disconnect()
  })

  it('due segnature concorrenti: una riesce, l altra riceve 409', async () => {
    for (let giro = 0; giro < 5; giro++) {
      await prisma.activityLog.deleteMany({ where: { tenantId: idObbligatorio(tenantId) } })
      await prisma.mUDReport.deleteMany({ where: { tenantId: idObbligatorio(tenantId) } })

      const esiti = await Promise.allSettled([
        service.segnaPresentato(tenantId, 2025, userA),
        service.segnaPresentato(tenantId, 2025, userB),
      ])

      const riuscite = esiti.filter(e => e.status === 'fulfilled')
      const rifiutate = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(riuscite).toHaveLength(1)
      expect(rifiutate).toHaveLength(1)
      expect(rifiutate[0].reason).toBeInstanceOf(ConflictException)

      const log = await prisma.activityLog.findMany({
        where: { tenantId, action: 'MUD_PRESENTATO' },
      })
      expect(log).toHaveLength(1)
      const r = await prisma.mUDReport.findUniqueOrThrow({
        where: { tenantId_year: { tenantId, year: 2025 } },
      })
      expect(r.status).toBe('SUBMITTED')
      expect(r.submittedBy).toBe(log[0].userId)
    }
  })
})
