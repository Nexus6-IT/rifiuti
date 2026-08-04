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
