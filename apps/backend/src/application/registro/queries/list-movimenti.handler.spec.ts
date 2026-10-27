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
  tipoAnnotazione: 'ORDINARIA',
  motivoAnnotazione: null,
  rettificato: null,
  correzioni: [] as unknown[],
})

describe('ListMovimentiHandler', () => {
  let prisma: {
    wasteMovement: { count: jest.Mock; findMany: jest.Mock }
    $queryRaw: jest.Mock
  }
  let handler: ListMovimentiHandler

  beforeEach(() => {
    prisma = {
      wasteMovement: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([riga('reg-A')]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
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

  describe('stato delle righe', () => {
    const rif = (n: number, tipo: string) => ({
      progressiveNumber: n,
      progressiveYear: 2026,
      tipoAnnotazione: tipo,
    })

    it('una riga ordinaria senza correzioni e vigente e non lancia la query ricorsiva', async () => {
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0]).toMatchObject({
        stato: 'VIGENTE',
        tipoAnnotazione: 'ORDINARIA',
      })
      expect(result.value.items[0].rettificaDi).toBeUndefined()
      expect(result.value.items[0].correttoDa).toBeUndefined()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('include predecessore e correzioni nella pagina, senza filtrare per vigenza', async () => {
      await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      const arg = prisma.wasteMovement.findMany.mock.calls[0][0]
      expect(arg.include.rettificato.select).toEqual({
        progressiveNumber: true,
        progressiveYear: true,
        tipoAnnotazione: true,
      })
      expect(arg.include.correzioni.select).toEqual(arg.include.rettificato.select)
      expect(arg.where).toEqual({ tenantId: 't1' })
    })

    it('rettificato, annullato, rettifica e annullamento, con UNA query per la testa', async () => {
      const ordinaria = { ...riga('reg-A'), id: 'o', correzioni: [rif(2, 'RETTIFICA')] }
      const rettifica = {
        ...riga('reg-A'),
        id: 'r',
        tipoAnnotazione: 'RETTIFICA',
        motivoAnnotazione: 'errore di battitura',
        rettificato: rif(1, 'ORDINARIA'),
        correzioni: [rif(3, 'ANNULLAMENTO')],
      }
      const annullamento = {
        ...riga('reg-A'),
        id: 'a',
        tipoAnnotazione: 'ANNULLAMENTO',
        motivoAnnotazione: 'registrato per errore',
        rettificato: rif(2, 'RETTIFICA'),
      }
      prisma.wasteMovement.findMany.mockResolvedValue([annullamento, rettifica, ordinaria])
      prisma.$queryRaw.mockResolvedValue([
        { partenza: 'o', tipo_testa: 'ANNULLAMENTO' },
        { partenza: 'r', tipo_testa: 'ANNULLAMENTO' },
      ])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      const [a, r, o] = result.value.items
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect([a.stato, r.stato, o.stato]).toEqual(['ANNULLATO', 'ANNULLATO', 'ANNULLATO'])
      expect(a.rettificaDi).toEqual(rif(2, 'RETTIFICA'))
      expect(r.rettificaDi).toEqual(rif(1, 'ORDINARIA'))
      expect(r.correttoDa).toEqual(rif(3, 'ANNULLAMENTO'))
      expect(r.motivoAnnotazione).toBe('errore di battitura')
      expect(o.correttoDa).toEqual(rif(2, 'RETTIFICA'))
    })

    it('una riga corretta da una rettifica vigente e RETTIFICATA', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), correzioni: [rif(2, 'RETTIFICA')] },
      ])
      prisma.$queryRaw.mockResolvedValue([{ partenza: 'm-reg-A', tipo_testa: 'RETTIFICA' }])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0].stato).toBe('RETTIFICATO')
    })

    it('la riga di annullamento senza correzioni e ANNULLATA senza query', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        {
          ...riga('reg-A'),
          tipoAnnotazione: 'ANNULLAMENTO',
          motivoAnnotazione: 'm',
          rettificato: rif(1, 'ORDINARIA'),
        },
      ])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0].stato).toBe('ANNULLATO')
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })
})
