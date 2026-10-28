import { Prisma } from '@prisma/client'
import { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { MudAggregazioneService } from '../mud/aggregazione/mud-aggregazione.service'
import { limitiAnnoMud } from '../mud/aggregazione/mud-regole'
import { righeCausaliSistema } from '../registro/causali/catalogo-causali.fixture'
import { prodottoNelPeriodo, preliminariNelPeriodo } from './complementi-bilancio'
import { leggiMovimentiAnno } from './lettore-movimenti-bilancio'
import { loggerFinto, prismaFintoMud, referenceDataFinto } from './prisma-finto-mud.fixture'

const riga = (p: Partial<any> = {}) => ({
  registroId: 'reg-A',
  progressiveNumber: 1,
  progressiveYear: 2025,
  type: 'CARICO',
  causale: 'PRODUZIONE_INTERNA',
  causaleAziendaId: null,
  cerCode: '17 04 05',
  quantity: 100,
  unit: 'KG',
  operationCode: null,
  firId: null,
  firIdRicopia: null,
  ricopiaChiave: '',
  counterpartName: null,
  movementDate: new Date('2025-06-10T08:00:00Z'),
  ...p,
})

describe('leggiMovimentiAnno', () => {
  let prisma: any
  beforeEach(() => {
    prisma = prismaFintoMud()
  })

  it("legge i movimenti vigenti dell'anno italiano del tenant", async () => {
    await leggiMovimentiAnno(prisma, 't1', 2025)

    const { inizio, fine } = limitiAnnoMud(2025)
    expect(prisma.wasteMovement.findMany).toHaveBeenCalledTimes(1)
    const args = prisma.wasteMovement.findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      tenantId: 't1',
      movementDate: { gte: inizio, lt: fine },
      ...WHERE_VIGENTE,
    })
    expect(Object.keys(args.select)).toEqual(
      expect.arrayContaining([
        'type',
        'causale',
        'causaleAziendaId',
        'movementDate',
        'quantity',
        'unit',
        'operationCode',
        'firId',
      ])
    )
    expect(args.orderBy).toEqual([{ movementDate: 'asc' }, { progressiveNumber: 'asc' }])
  })

  it('il filtro sulla data di inizio e quello sui vigenti stanno nella query', async () => {
    await leggiMovimentiAnno(prisma, 't1', 2025)
    const { where } = prisma.wasteMovement.findMany.mock.calls[0][0]
    expect(where.movementDate.gte).toEqual(new Date('2024-12-31T23:00:00.000Z'))
    expect(where.tipoAnnotazione).toEqual({ not: 'ANNULLAMENTO' })
    expect(where.correzioni).toEqual({ none: {} })
  })

  it('FIR collegati letti nel tenant, solo se ci sono firId', async () => {
    prisma.wasteMovement.findMany.mockResolvedValue([riga({ quantity: 5 })])
    await leggiMovimentiAnno(prisma, 't1', 2025)
    expect(prisma.fIR.findMany).not.toHaveBeenCalled()

    prisma.wasteMovement.findMany.mockResolvedValue([
      riga({ firId: 'f1', quantity: new Prisma.Decimal('12.5') }),
      riga({ firId: 'f2', progressiveNumber: 2 }),
      riga({ firId: 'f1', progressiveNumber: 3 }),
      riga({ firId: 'f-assente', progressiveNumber: 4 }),
    ])
    prisma.fIR.findMany.mockResolvedValue([
      {
        id: 'f1',
        status: 'COMPLETED',
        firNumber: 'FIR-1',
        rentriNumeroFir: null,
        rentriStatoFormulario: null,
        wasteOperationCode: 'R13',
      },
      {
        id: 'f2',
        status: 'COMPLETED',
        firNumber: 'FIR-2',
        rentriNumeroFir: null,
        rentriStatoFormulario: null,
        wasteOperationCode: null,
      },
    ])

    const ms = await leggiMovimentiAnno(prisma, 't1', 2025)

    expect(prisma.fIR.findMany).toHaveBeenCalledTimes(1)
    const args = prisma.fIR.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ tenantId: 't1', id: { in: ['f1', 'f2', 'f-assente'] } })
    expect(Object.keys(args.select).sort()).toEqual(
      [
        'id',
        'status',
        'firNumber',
        'rentriNumeroFir',
        'rentriStatoFormulario',
        'wasteOperationCode',
      ].sort()
    )
    expect(ms[0].quantity).toBe(12.5)
    expect(typeof ms[0].quantity).toBe('number')
    expect(ms[0].fir?.id).toBe('f1')
    expect(ms[1].fir?.id).toBe('f2')
    expect(ms[3].fir).toBeNull()
  })

  it('i movimenti senza FIR hanno fir null', async () => {
    prisma.wasteMovement.findMany.mockResolvedValue([riga()])
    const ms = await leggiMovimentiAnno(prisma, 't1', 2025)
    expect(ms[0].fir).toBeNull()
  })

  it('ogni lettura filtra per tenant e non tocca il catalogo', async () => {
    prisma.wasteMovement.findMany.mockResolvedValue([riga({ firId: 'f1' })])
    await leggiMovimentiAnno(prisma, 't1', 2025)
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where.tenantId).toBe('t1')
    expect(prisma.fIR.findMany.mock.calls[0][0].where.tenantId).toBe('t1')
    expect(prisma.causaleRegistro.findMany).not.toHaveBeenCalled()
  })

  it('prodotto e preliminari coerenti con il MUD sugli stessi movimenti', async () => {
    const dati = [
      riga({ progressiveNumber: 1, quantity: 1000, unit: 'KG' }),
      riga({ progressiveNumber: 2, causale: 'RECUPERO_PARZIALE', quantity: 0.5, unit: 't' }),
      riga({ progressiveNumber: 3, causale: 'INGRESSO_ESTERNO', quantity: 300, unit: 'KG' }),
      riga({
        progressiveNumber: 4,
        type: 'SCARICO',
        causale: 'AVVIO_RECUPERO',
        operationCode: 'R13',
        quantity: 400,
        unit: 'kg',
      }),
      riga({
        progressiveNumber: 5,
        type: 'SCARICO',
        causale: 'AVVIO_SMALTIMENTO',
        operationCode: 'D15',
        quantity: 200,
        unit: 'KG',
      }),
      riga({
        progressiveNumber: 6,
        type: 'SCARICO',
        causale: 'AVVIO_RECUPERO',
        operationCode: 'R3',
        quantity: 100,
        unit: 'KG',
      }),
    ]
    prisma.wasteMovement.findMany.mockResolvedValue(dati)

    const a = await new MudAggregazioneService(prisma, referenceDataFinto(), loggerFinto()).aggrega(
      't1',
      2025
    )
    const ms = await leggiMovimentiAnno(prisma, 't1', 2025)
    const catalogo = new CatalogoCausali(righeCausaliSistema(), [])

    const prodottoMud = a.righe.reduce((s, r) => s + r.prodottoKg, 0)
    expect(prodottoNelPeriodo(catalogo, ms, '2025-12-31')).toBe(prodottoMud)
    // 1000 kg di produzione + 0,5 t di recupero parziale
    expect(prodottoMud).toBe(1500)

    const { r13Kg, d15Kg } = preliminariNelPeriodo(catalogo, ms, '2025-12-31')
    const recuperoMud = a.righe.reduce((s, r) => s + r.recuperoKg, 0)
    const smaltimentoMud = a.righe.reduce((s, r) => s + r.smaltimentoKg, 0)
    expect(r13Kg).toBe(400)
    expect(d15Kg).toBe(200)
    expect(recuperoMud).toBe(500)
    expect(smaltimentoMud).toBe(200)
    expect(r13Kg).toBeLessThanOrEqual(recuperoMud)
    expect(d15Kg).toBeLessThanOrEqual(smaltimentoMud)
  })
})
