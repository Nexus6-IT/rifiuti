import { ListMovimentiHandler } from './list-movimenti.handler'
import { ListMovimentiQuery } from './list-movimenti.query'

const riga = (registroId: string) => ({
  id: `m-${registroId}`,
  tenantId: 't1',
  registroId,
  progressiveNumber: 3,
  progressiveYear: 2026,
  type: 'CARICO',
  movementDate: new Date('2026-03-01'),
  registrationDate: new Date('2026-03-01'),
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '200301',
  wasteDescription: null,
  quantity: 10,
  unit: 'KG',
  wastePhysicalState: null,
  wasteHazardClasses: null,
  operationCode: null,
  counterpartName: null,
  counterpartAddress: null,
  firId: null,
  recordedByUserId: null,
  entryHash: 'h',
  notes: null,
  createdAt: new Date('2026-03-01'),
})

describe('ListMovimentiHandler', () => {
  let prisma: { wasteMovement: { count: jest.Mock; findMany: jest.Mock } }
  let handler: ListMovimentiHandler

  beforeEach(() => {
    prisma = {
      wasteMovement: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([riga('reg-A')]),
      },
    }
    handler = new ListMovimentiHandler(prisma as any)
  })

  it('lista movimenti: filtra per registroId e restituisce registroId', async () => {
    const result = await handler.execute(
      new ListMovimentiQuery('t1', { registroId: 'reg-A' }, { page: 1, limit: 20 })
    )

    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      registroId: 'reg-A',
    })
    expect(prisma.wasteMovement.count.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      registroId: 'reg-A',
    })
    expect(result.value.items[0].registroId).toBe('reg-A')
  })

  it('lista movimenti: senza registroId non filtra per registro', async () => {
    await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))

    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' })
  })
})
