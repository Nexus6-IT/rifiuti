import { PrismaClient } from '@prisma/client'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
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
/**
 * Id per il `where` di un deleteMany dentro un test: con `undefined` Prisma toglierebbe il
 * filtro e cancellerebbe tutta la tabella, quindi si fallisce invece di cancellare.
 */
function idObbligatorio(id: string | undefined): string {
  if (!id) throw new Error('tenant di prova non creato: nessuna cancellazione senza filtro')
  return id
}

describe('aggiornaReportData — concorrenza su Postgres reale', () => {
  let prisma: PrismaClient
  let tenantId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Report MUD Concorrenza Test SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id
  })

  afterAll(async () => {
    // Con un id `undefined` (beforeAll fallito) Prisma toglie il filtro e deleteMany
    // cancellerebbe l'intera tabella: senza id non si cancella nulla.
    if (tenantId) {
      await prisma.mUDReport.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('due aggiornamenti concorrenti di reportData conservano entrambe le chiavi', async () => {
    for (let giro = 0; giro < 5; giro++) {
      await prisma.mUDReport.deleteMany({ where: { tenantId: idObbligatorio(tenantId) } }) // anche il caso del record assente
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

  it('con il record già presente gli aggiornamenti concorrenti conservano tutte le chiavi', async () => {
    for (let giro = 0; giro < 5; giro++) {
      await prisma.mUDReport.deleteMany({ where: { tenantId: idObbligatorio(tenantId) } })
      await prisma.mUDReport.create({
        data: { tenantId, year: 2025, status: 'SUBMITTED', reportData: { hashAggregato: 'h0' } },
      })
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
      expect(r.status).toBe('SUBMITTED')
      expect(r.reportData).toEqual({
        hashAggregato: 'h0',
        integrazioni: { giro },
        esportazioni: [{ giro }],
      })
    }
  })
})
