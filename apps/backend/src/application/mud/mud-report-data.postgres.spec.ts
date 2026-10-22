import { PrismaClient } from '@prisma/client'
import { aggiornaReportData } from './mud-report-data'

/**
 * Scritture concorrenti di `MUDReport.reportData`, contro un **Postgres reale**.
 *
 * Il read-modify-write sul JSON in READ COMMITTED perde una delle due chiavi se due
 * transaction leggono lo stesso `precedente`; con il record assente due `upsert` possono
 * fallire con P2002. Il lock per tenant e anno di `aggiornaReportData` serializza entrambi
 * i casi: un finto non lo dimostra, il database sì.
 *
 * Gira solo nel gate di integrazione (job «Test integrazione (PostgreSQL reale)»).
 */
describe('aggiornaReportData — concorrenza su Postgres reale', () => {
  let prisma: PrismaClient
  let tenantId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: `MR${Date.now().toString().slice(-9)}`,
        ragioneSociale: 'Report MUD Concorrenza Test SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id
  })

  afterAll(async () => {
    await prisma.mUDReport.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('due aggiornamenti concorrenti di reportData conservano entrambe le chiavi', async () => {
    for (let giro = 0; giro < 5; giro++) {
      await prisma.mUDReport.deleteMany({ where: { tenantId } }) // anche il caso del record assente
      await Promise.all([
        prisma.$transaction(tx =>
          aggiornaReportData(tx, tenantId, 2025, p => ({
            reportData: { ...p, integrazioni: { giro } },
          }))
        ),
        prisma.$transaction(tx =>
          aggiornaReportData(tx, tenantId, 2025, p => ({
            reportData: {
              ...p,
              esportazioni: [...(Array.isArray(p.esportazioni) ? p.esportazioni : []), { giro }],
            },
          }))
        ),
      ])
      const r = await prisma.mUDReport.findUniqueOrThrow({
        where: { tenantId_year: { tenantId, year: 2025 } },
      })
      expect(r.reportData).toEqual({ integrazioni: { giro }, esportazioni: [{ giro }] })
    }
  })
})
