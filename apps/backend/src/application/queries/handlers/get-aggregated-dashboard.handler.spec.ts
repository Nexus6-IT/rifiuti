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

/**
 * Il doppio di `fIR.groupBy` APPLICA DAVVERO il filtro `where.status.in` e
 * `where.tenantId.in` sui FIR passati in `firs`, invece di restituire un
 * conteggio fisso indipendente dagli argomenti. Un mock incondizionato
 * (come nella prima versione di questo spec) rende invisibile QUALE insieme
 * di stati l'handler stia effettivamente usando: è esattamente il motivo per
 * cui una decisione di prodotto (quali stati contano come "da lavorare") è
 * potuta cambiare in produzione senza che nessun test se ne accorgesse.
 */
function makePrisma(firs: Array<{ tenantId: string; status: string }> = []) {
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
      groupBy: jest.fn(({ where }: any) => {
        const tenantIds: string[] = where.tenantId.in
        const statuses: string[] = where.status.in
        const conteggi = new Map<string, number>()
        for (const fir of firs) {
          if (!tenantIds.includes(fir.tenantId)) continue
          if (!statuses.includes(fir.status)) continue
          conteggi.set(fir.tenantId, (conteggi.get(fir.tenantId) ?? 0) + 1)
        }
        return Promise.resolve(
          Array.from(conteggi.entries()).map(([tenantId, count]) => ({
            tenantId,
            _count: { _all: count },
          }))
        )
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mUDReport: { findMany: jest.fn().mockResolvedValue([]) },
    rENTRISyncLog: { count: jest.fn().mockResolvedValue(2) },
  } as any
}

describe('GetAggregatedDashboardHandler', () => {
  it('aggrega le figlie della madre e somma i FIR da trasmettere', async () => {
    const prisma = makePrisma([
      { tenantId: ALFA, status: 'DRAFT' },
      { tenantId: ALFA, status: 'AWAITING_PRODUCER' },
      { tenantId: ALFA, status: 'AWAITING_CARRIER' },
      { tenantId: BETA, status: 'DRAFT' },
    ])
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

  it('un FIR AWAITING_RECEIVER (in transito) non conta come "da lavorare"', async () => {
    // Decisione PO (fix round 1): la vista risponde a "dove devo intervenire".
    // Un FIR in transito verso il destinatario non richiede alcuna azione da
    // parte di chi guarda la vista di gruppo, quindi va escluso dal conteggio.
    const prisma = makePrisma([{ tenantId: ALFA, status: 'AWAITING_RECEIVER' }])
    const handler = new GetAggregatedDashboardHandler(prisma)

    const risultato = await handler.execute({ tenantIdMadre: MADRE } as any)

    expect(risultato.totalPendingFirs).toBe(0)
    expect(risultato.pendingFirsByClient).toEqual([])
  })

  it('un FIR AWAITING_PRODUCER (bozza, come DRAFT) conta come "da lavorare"', async () => {
    // DRAFT e AWAITING_PRODUCER sono entrambi lo stato di dominio BOZZA
    // (v. fir-prisma.repository.ts, DB_TO_STATO): nessuna ragione per
    // trattarli diversamente nel conteggio.
    const prisma = makePrisma([{ tenantId: ALFA, status: 'AWAITING_PRODUCER' }])
    const handler = new GetAggregatedDashboardHandler(prisma)

    const risultato = await handler.execute({ tenantIdMadre: MADRE } as any)

    expect(risultato.totalPendingFirs).toBe(1)
    expect(risultato.pendingFirsByClient).toEqual([
      { tenantId: ALFA, tenantName: 'Alfa Srl', pendingCount: 1 },
    ])
  })

  it("un'azienda segnata come non tenuta al MUD non compare fra le scadenze MUD (A-W-10)", async () => {
    // Bozze MUD di entrambe le figlie (create prima del flag o dall'export): il doppio di
    // `mUDReport.findMany` applica il filtro sulla relazione `tenant`, come farebbe Postgres.
    const flag: Record<string, boolean> = { [ALFA]: true, [BETA]: false }
    const bozze = [
      { tenantId: ALFA, year: 2025, status: 'DRAFT' },
      { tenantId: BETA, year: 2025, status: 'DRAFT' },
    ]
    const prisma = makePrisma()
    prisma.mUDReport.findMany = jest.fn(({ where }: any) =>
      Promise.resolve(
        bozze.filter(
          b =>
            where.tenantId.in.includes(b.tenantId) &&
            (where.tenant?.is?.mudNonDovuto === undefined ||
              where.tenant.is.mudNonDovuto === flag[b.tenantId])
        )
      )
    )
    const handler = new GetAggregatedDashboardHandler(prisma)

    const risultato = await handler.execute({ tenantIdMadre: MADRE } as any)

    expect(risultato.upcomingDeadlines).toEqual([
      { tenantId: BETA, tenantName: 'Beta Srl', year: 2025, status: 'DRAFT' },
    ])
  })
})
