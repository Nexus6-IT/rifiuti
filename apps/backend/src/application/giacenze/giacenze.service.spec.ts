import { Test, TestingModule } from '@nestjs/testing'
import { GiacenzeService } from './giacenze.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { SoglieDepositoService } from './soglie-deposito.service'
import { SOGLIE_PREDEFINITE } from '../../domain/waste-movement/deposito-temporaneo'
import { RegistroNonTrovatoError } from '../registro/registri.service'

describe('GiacenzeService', () => {
  let service: GiacenzeService
  let prisma: any
  /** Movimenti vigenti restituiti alla lettura degli eventi del FIFO. */
  let eventi: any[]
  /** Scarichi su FIR annullati restituiti alla lettura dedicata. */
  let scarichiFir: any[]
  let soglieSvc: { soglieApplicate: jest.Mock }
  let registri: any[]

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    eventi = []
    scarichiFir = []
    registri = [
      { id: 'reg-A', descrizione: 'Registro A', attivo: true },
      { id: 'reg-B', descrizione: 'Registro B', attivo: true },
    ]
    soglieSvc = {
      soglieApplicate: jest.fn((_t: string, ids: string[]) =>
        Promise.resolve(
          new Map(ids.map(id => [id, { ...SOGLIE_PREDEFINITE, origine: 'PREDEFINITA' }]))
        )
      ),
    }
    prisma = {
      registroRifiuti: { findMany: jest.fn(() => Promise.resolve(registri)) },
      wasteMovement: {
        groupBy: jest.fn(),
        // due letture: gli scarichi dei FIR annullati (filtro su firId) e gli eventi del FIFO
        findMany: jest.fn((args: any) =>
          Promise.resolve(args?.where?.firId ? scarichiFir : eventi)
        ),
      },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
      giacenzaIniziale: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiacenzeService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
        { provide: SoglieDepositoService, useValue: soglieSvc },
      ],
    }).compile()
    service = module.get(GiacenzeService)
  })

  let progressivo = 0
  /** Movimento vigente come lo legge il lettore degli eventi. */
  function mov(
    cerCode: string,
    type: 'CARICO' | 'SCARICO',
    quantity: number,
    giorno: string,
    extra: Record<string, unknown> = {}
  ) {
    progressivo += 1
    return {
      id: `m${progressivo}`,
      registroId: 'reg-A',
      cerCode,
      type,
      unit: 'KG',
      quantity,
      movementDate: new Date(`${giorno}T10:00:00Z`),
      progressiveYear: 2026,
      progressiveNumber: progressivo,
      ...extra,
    }
  }

  /** Instrada il groupBy delle somme (per tipo); `eventiMovimenti` alimenta il FIFO. */
  function mockGroupBy(byType: any[], eventiMovimenti: any[] = []) {
    eventi = eventiMovimenti
    prisma.wasteMovement.groupBy.mockImplementation((args: any) => {
      if (args.by.includes('type')) return Promise.resolve(byType)
      return Promise.resolve([]) // groupBy dell'asterisco
    })
  }

  /** Le chiamate al groupBy delle somme (quelle dell'asterisco non hanno il filtro di registro). */
  const chiamateSomme = () =>
    prisma.wasteMovement.groupBy.mock.calls.filter((c: any[]) => c[0].by.includes('type'))

  it('calcola la giacenza per CER (carico - scarico, clamp a 0)', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
        { cerCode: '170504', type: 'CARICO', unit: 'KG', _sum: { quantity: 10 } },
        { cerCode: '170504', type: 'SCARICO', unit: 'KG', _sum: { quantity: 25 } }, // scarico > carico
      ],
      [
        mov('150101', 'CARICO', 100, '2026-01-01'),
        mov('150101', 'SCARICO', 30, '2026-01-10'),
        mov('170504', 'CARICO', 10, '2026-05-01'),
        mov('170504', 'SCARICO', 25, '2026-05-02'),
      ]
    )

    const giacenze = await service.getGiacenze('tenant-1')

    const cer15 = giacenze.find(g => g.cerCode === '15 01 01')!
    expect(cer15.giacenzaKg).toBe(70)
    expect(cer15.oldestCaricoDate).toEqual(new Date('2026-01-01T00:00:00Z'))
    const cer17 = giacenze.find(g => g.cerCode === '17 05 04')!
    expect(cer17.giacenzaKg).toBe(0) // clamp: 10-25 → 0
    expect(cer17.oldestCaricoDate).toBeNull() // nessun lotto residuo
  })

  it('G6: il carico vecchio interamente scaricato non fa invecchiare il deposito', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 150 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [
        mov('150101', 'CARICO', 100, '2025-01-01'),
        mov('150101', 'SCARICO', 100, '2025-02-01'),
        mov('150101', 'CARICO', 50, '2026-04-01'),
      ]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.giacenzaKg).toBe(50)
    expect(g.oldestCaricoDate).toEqual(new Date('2026-04-01T00:00:00Z'))
  })

  it('un CER interamente scaricato ha oldestCaricoDate null', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [mov('150101', 'CARICO', 100, '2026-01-01'), mov('150101', 'SCARICO', 100, '2026-02-01')]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.giacenzaKg).toBe(0)
    expect(g.oldestCaricoDate).toBeNull()
  })

  it('senza registroId: minimo dei lotti più vecchi dei registri, FIFO sempre per registro', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 200 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [
        // reg-A: carico del 1/1 mai scaricato nel suo registro
        mov('150101', 'CARICO', 100, '2026-01-01', { registroId: 'reg-A' }),
        // reg-B: scarico del 1/2 e carico del 1/3; lo scarico NON consuma il lotto di reg-A
        mov('150101', 'SCARICO', 100, '2026-02-01', { registroId: 'reg-B' }),
        mov('150101', 'CARICO', 100, '2026-03-01', { registroId: 'reg-B' }),
      ]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.oldestCaricoDate).toEqual(new Date('2026-01-01T00:00:00Z'))
  })

  it('giacenze: con registroId conta solo quel registro; senza, tutti', async () => {
    mockGroupBy([], [])

    await service.getGiacenze('tenant-1', 'reg-A')
    expect(chiamateSomme()).toHaveLength(1)
    for (const chiamata of chiamateSomme()) {
      expect(chiamata[0].where).toMatchObject({ tenantId: 'tenant-1', registroId: 'reg-A' })
    }
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toMatchObject({
      registroId: 'reg-A',
    })

    prisma.wasteMovement.groupBy.mockClear()
    prisma.wasteMovement.findMany.mockClear()
    await service.getGiacenze('tenant-1')
    for (const chiamata of prisma.wasteMovement.groupBy.mock.calls) {
      expect(chiamata[0].where).not.toHaveProperty('registroId')
    }
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).not.toHaveProperty('registroId')
  })

  it('deposito: gli alert rispettano il filtro registroId e il registro deve essere dell’azienda', async () => {
    mockGroupBy([], [])

    await service.getDepositoTemporaneoAlerts('tenant-1', 'reg-A')
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toMatchObject({
      registroId: 'reg-A',
    })
    expect(soglieSvc.soglieApplicate).toHaveBeenCalledWith('tenant-1', ['reg-A'])

    await expect(service.getDepositoTemporaneoAlerts('tenant-1', 'reg-X')).rejects.toBeInstanceOf(
      RegistroNonTrovatoError
    )
  })

  it('giacenze: gli scarichi su FIR annullati rispettano il filtro registroId', async () => {
    mockGroupBy([], [])
    prisma.fIR.findMany.mockResolvedValue([
      {
        id: 'f1',
        status: 'CANCELLED',
        firNumber: 'F1',
        rentriNumeroFir: null,
        rentriStatoFormulario: null,
      },
    ])

    await service.getGiacenze('tenant-1', 'reg-A')

    const perFir = prisma.wasteMovement.findMany.mock.calls.find((c: any[]) => c[0].where.firId)
    expect(perFir[0].where).toMatchObject({ registroId: 'reg-A' })
  })

  describe('deposito temporaneo (alert e vista per registro)', () => {
    const soglie = (extra: Record<string, unknown> = {}) => ({
      ...SOGLIE_PREDEFINITE,
      origine: 'PREDEFINITA',
      ...extra,
    })
    const impostaSoglie = (perRegistro: Record<string, any>) =>
      soglieSvc.soglieApplicate.mockImplementation((_t: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map(id => [id, perRegistro[id] ?? soglie()])))
      )

    it('DURATA: il lotto più vecchio oltre i tre mesi di calendario è SUPERATO', async () => {
      mockGroupBy([], [mov('150101', 'CARICO', 100, '2026-01-01')])

      const alerts = await service.getDepositoTemporaneoAlerts('tenant-1', undefined, '2026-06-01')

      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({
        tipo: 'DURATA',
        livello: 'SUPERATO',
        cerCode: '15 01 01',
        valore: 151,
        scadenza: '2026-04-01',
        registroId: 'reg-A',
        registroDescrizione: 'Registro A',
      })
    })

    it('QUANTITA_TOTALE: la somma dei CER dello stesso registro raggiunge la soglia', async () => {
      mockGroupBy(
        [],
        [mov('150101', 'CARICO', 20000, '2026-05-30'), mov('170504', 'CARICO', 10000, '2026-05-30')]
      )

      const alerts = await service.getDepositoTemporaneoAlerts('tenant-1', undefined, '2026-06-01')

      const q = alerts.filter(a => a.tipo === 'QUANTITA_TOTALE')
      expect(q).toHaveLength(1)
      expect(q[0]).toMatchObject({ livello: 'SUPERATO', valore: 30000, cerCode: null })
    })

    it('la quantità non si somma fra registri diversi', async () => {
      mockGroupBy(
        [],
        [
          mov('150101', 'CARICO', 20000, '2026-05-30', { registroId: 'reg-A' }),
          mov('170504', 'CARICO', 20000, '2026-05-30', { registroId: 'reg-B' }),
        ]
      )

      const alerts = await service.getDepositoTemporaneoAlerts('tenant-1', undefined, '2026-06-01')

      // 20000 kg per registro: 66% della soglia di 30000, sotto il preavviso dell'80%
      expect(alerts.filter(a => a.tipo === 'QUANTITA_TOTALE')).toEqual([])
    })

    it('usa le soglie del registro al posto di quelle dell’azienda', async () => {
      mockGroupBy(
        [],
        [
          mov('150101', 'CARICO', 6000, '2026-05-30', { registroId: 'reg-A' }),
          mov('150101', 'CARICO', 6000, '2026-05-30', { registroId: 'reg-B' }),
        ]
      )
      impostaSoglie({
        'reg-A': soglie({ criterio: 'QUANTITATIVO', kgMaxTotale: 5000, origine: 'REGISTRO' }),
      })

      const alerts = await service.getDepositoTemporaneoAlerts('tenant-1', undefined, '2026-06-01')

      const tot = alerts.filter(a => a.tipo === 'QUANTITA_TOTALE')
      expect(tot).toHaveLength(1)
      expect(tot[0]).toMatchObject({ registroId: 'reg-A', soglia: 5000 })
      expect(soglieSvc.soglieApplicate).toHaveBeenCalledTimes(1)
    })

    it('G6: carico vecchio scaricato del tutto, nessun avviso di durata e età dal carico successivo', async () => {
      mockGroupBy(
        [],
        [
          mov('150101', 'CARICO', 100, '2025-01-01'),
          mov('150101', 'SCARICO', 100, '2025-02-01'),
          mov('150101', 'CARICO', 50, '2026-05-01'),
        ]
      )

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      const reg = vista.registri.find(r => r.registroId === 'reg-A')!
      expect(reg.avvisi.filter(a => a.tipo === 'DURATA')).toEqual([])
      expect(reg.cer[0]).toMatchObject({
        giornoPiuVecchio: '2026-05-01',
        etaGiorni: 31,
        scadenza: '2026-08-01',
        residuoKg: 50,
      })
    })

    it('nessun avviso se tutto è stato scaricato', async () => {
      mockGroupBy(
        [],
        [mov('150101', 'CARICO', 100, '2020-01-01'), mov('150101', 'SCARICO', 100, '2020-01-02')]
      )

      const alerts = await service.getDepositoTemporaneoAlerts('tenant-1')
      expect(alerts).toEqual([])
    })

    it('I3: CER con soli m³ residui vecchi, DURATA e quantitaParziale', async () => {
      mockGroupBy([], [mov('150101', 'CARICO', 2, '2026-01-01', { unit: 'M3' })])

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      const reg = vista.registri.find(r => r.registroId === 'reg-A')!
      expect(reg.quantitaParziale).toBe(true)
      expect(reg.cer[0]).toMatchObject({ residuoKg: 0, giornoPiuVecchio: '2026-01-01' })
      expect(reg.cer[0].famiglie[0]).toMatchObject({ unita: 'M3', residuo: 2 })
      expect(reg.avvisi.find(a => a.tipo === 'DURATA')).toMatchObject({
        livello: 'SUPERATO',
        cerCode: '15 01 01',
      })
    })

    it('scopertoPresente se uno scarico non è coperto dai carichi', async () => {
      mockGroupBy([], [mov('150101', 'SCARICO', 10, '2026-05-01')])

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      expect(vista.registri[0].scopertoPresente).toBe(true)
      expect(vista.registri[0].cer[0].famiglie[0]).toMatchObject({ scoperto: 10, lotti: [] })
    })

    it('limita a 50 i lotti per famiglia: tiene i più vecchi, dichiara quelli omessi', async () => {
      const giorno = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
      // inseriti in ordine sparso: il taglio deve guardare la data, non l'ordine di arrivo
      const lotti = Array.from({ length: 53 }, (_, i) => mov('150101', 'CARICO', 1, giorno(i)))
      mockGroupBy([], [...lotti].reverse())

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      const fam = vista.registri[0].cer[0].famiglie[0]
      expect(fam.lotti).toHaveLength(50)
      expect(fam.lottiOmessi).toBe(3)
      expect(fam.residuo).toBe(53)
      expect(fam.lotti[0].giorno).toBe(giorno(0))
      expect(fam.lotti[49].giorno).toBe(giorno(49))
      // il primo omesso è il cinquantunesimo per età
      expect(fam.lotti.map(l => l.giorno)).not.toContain(giorno(50))
    })

    it('criterio QUANTITATIVO: lotto di 2 mesi, scadenza a un anno e nessun avviso di durata', async () => {
      mockGroupBy([], [mov('150101', 'CARICO', 10, '2026-04-01')])
      impostaSoglie({
        'reg-A': soglie({ criterio: 'QUANTITATIVO', origine: 'REGISTRO' }),
      })

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      const reg = vista.registri.find(r => r.registroId === 'reg-A')!
      expect(reg.cer[0]).toMatchObject({ giornoPiuVecchio: '2026-04-01', scadenza: '2027-04-01' })
      expect(reg.avvisi).toEqual([])
    })

    it('registro disattivato senza eventi, chiesto con registroId: compare con la voce vuota', async () => {
      registri = [
        { id: 'reg-A', descrizione: 'A', attivo: true },
        { id: 'reg-B', descrizione: 'B', attivo: false },
      ]
      mockGroupBy([], [mov('150101', 'CARICO', 10, '2026-05-01', { registroId: 'reg-A' })])

      const vista = await service.getDepositoTemporaneo('tenant-1', {
        registroId: 'reg-B',
        oggi: '2026-06-01',
      })

      expect(vista.registri).toHaveLength(1)
      expect(vista.registri[0]).toMatchObject({
        registroId: 'reg-B',
        attivo: false,
        cer: [],
        avvisi: [],
        totaleKg: 0,
      })
    })

    it('registri disattivati senza eventi esclusi, con eventi inclusi', async () => {
      registri = [
        { id: 'reg-A', descrizione: 'A', attivo: true },
        { id: 'reg-B', descrizione: 'B', attivo: false },
        { id: 'reg-C', descrizione: 'C', attivo: false },
      ]
      mockGroupBy([], [mov('150101', 'CARICO', 10, '2026-05-01', { registroId: 'reg-C' })])

      const vista = await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })

      expect(vista.registri.map(r => r.registroId)).toEqual(['reg-A', 'reg-C'])
    })

    it('M4: il numero di query non dipende dal numero di registri', async () => {
      const conta = async (n: number) => {
        registri = Array.from({ length: n }, (_, i) => ({
          id: `reg-${i}`,
          descrizione: `R${i}`,
          attivo: true,
        }))
        mockGroupBy(
          [],
          registri.map(r => mov('150101', 'CARICO', 10, '2026-05-01', { registroId: r.id }))
        )
        for (const m of [
          prisma.registroRifiuti.findMany,
          prisma.wasteMovement.findMany,
          prisma.wasteMovement.groupBy,
          prisma.giacenzaIniziale.findMany,
          prisma.giacenzaIniziale.groupBy,
          prisma.$queryRaw,
          soglieSvc.soglieApplicate,
        ]) {
          m.mockClear()
        }
        await service.getDepositoTemporaneo('tenant-1', { oggi: '2026-06-01' })
        return [
          prisma.registroRifiuti.findMany,
          prisma.wasteMovement.findMany,
          prisma.wasteMovement.groupBy,
          prisma.giacenzaIniziale.findMany,
          prisma.giacenzaIniziale.groupBy,
          prisma.$queryRaw,
          soglieSvc.soglieApplicate,
        ].map(m => m.mock.calls.length)
      }
      const con2 = await conta(2)
      const con6 = await conta(6)
      expect(con6).toEqual(con2)
    })

    it('un solo warn per chiamata con il numero di avvisi SUPERATO', async () => {
      mockGroupBy(
        [],
        [
          mov('150101', 'CARICO', 10, '2026-01-01', { registroId: 'reg-A' }),
          mov('170504', 'CARICO', 10, '2026-01-01', { registroId: 'reg-A' }),
        ]
      )
      const logger = (service as any).logger

      await service.getDepositoTemporaneoAlerts('tenant-1', undefined, '2026-06-01')

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn.mock.calls[0][0]).toContain('2 avvisi')
    })
  })

  it('converte le tonnellate in kg e tiene i litri fuori dai kg', async () => {
    mockGroupBy([
      { cerCode: '170405', type: 'CARICO', unit: 'T', _sum: { quantity: 1 } },
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'kg', _sum: { quantity: 200 } },
      { cerCode: '170405', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
    ])
    const [g] = await service.getGiacenze('t1')
    expect(g).toMatchObject({ caricoKg: 1500, scaricoKg: 200, giacenzaKg: 1300 })
    expect(g.altreUnita).toEqual([
      { unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30, iniziale: 0 },
    ])
  })

  it('elenca gli scarichi collegati a FIR annullati, senza toglierli dalla giacenza', async () => {
    mockGroupBy([
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'KG', _sum: { quantity: 200 } },
    ])
    prisma.fIR.findMany.mockResolvedValue([
      {
        id: 'f1',
        status: 'AWAITING_CARRIER',
        firNumber: 'FIR-2026-000003',
        rentriNumeroFir: null,
        rentriStatoFormulario: 'Annullato',
      },
    ])
    scarichiFir = [
      {
        cerCode: '170405',
        progressiveNumber: 9,
        progressiveYear: 2026,
        quantity: 200,
        unit: 'KG',
        firId: 'f1',
      },
    ]
    const [g] = await service.getGiacenze('t1')
    expect(g.giacenzaKg).toBe(300)
    expect(g.scarichiSuFirAnnullati).toEqual([
      { numero: '2026/9', quantita: 200, unita: 'KG', fir: 'FIR-2026-000003' },
    ])
    expect(prisma.fIR.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
    )
  })

  it('unisce in una riga lo stesso CER scritto in formati diversi', async () => {
    mockGroupBy(
      [
        { cerCode: '200301', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '20 03 01', type: 'CARICO', unit: 'KG', _sum: { quantity: 50 } },
        { cerCode: '20 03 01', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
      ],
      [
        mov('200301', 'CARICO', 100, '2026-03-01'),
        mov('20 03 01', 'CARICO', 50, '2026-02-01'),
        mov('20 03 01', 'SCARICO', 30, '2026-02-10'),
      ]
    )
    const giacenze = await service.getGiacenze('t1')
    expect(giacenze).toHaveLength(1)
    expect(giacenze[0]).toMatchObject({
      cerCode: '20 03 01',
      caricoKg: 150,
      scaricoKg: 30,
      giacenzaKg: 120,
      oldestCaricoDate: new Date('2026-02-01T00:00:00Z'),
    })
  })

  it('non interroga gli scarichi dei FIR se nessun FIR è annullato', async () => {
    mockGroupBy([{ cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 5 } }])
    await service.getGiacenze('t1')
    const perFir = prisma.wasteMovement.findMany.mock.calls.filter((c: any[]) => c[0].where.firId)
    expect(perFir).toHaveLength(0)
  })

  describe('giacenze iniziali (aperture del registro)', () => {
    const apertura = (cerCode: string, quantita: number, unita: string, data: string) => ({
      id: `ap-${cerCode}-${unita}`,
      registroId: 'reg-A',
      cerCode,
      quantita,
      unita,
      dataRiferimento: new Date(`${data}T00:00:00Z`),
    })

    it('un CER con sola apertura compare con caricoKg = inizialeKg', async () => {
      mockGroupBy([], [])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 120, 'KG', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g).toMatchObject({
        cerCode: '15 01 06',
        caricoKg: 120,
        inizialeKg: 120,
        scaricoKg: 0,
        giacenzaKg: 120,
        oldestCaricoDate: new Date('2026-02-01T00:00:00Z'),
      })
    })

    it("somma l'apertura (anche in t) ai carichi e la distingue in inizialeKg", async () => {
      mockGroupBy(
        [
          { cerCode: '150106', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
          { cerCode: '150106', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
        ],
        [mov('150106', 'CARICO', 100, '2026-03-01'), mov('150106', 'SCARICO', 30, '2026-03-02')]
      )
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 2, 'T', '2026-01-15'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g).toMatchObject({ caricoKg: 2100, inizialeKg: 2000, giacenzaKg: 2070 })
      // lo scarico consuma l'apertura (più vecchia) ma ne resta: il lotto più vecchio è ancora lei
      expect(g.oldestCaricoDate).toEqual(new Date('2026-01-15T00:00:00Z'))
    })

    it("D9: il carico vecchio interamente scaricato non conta, conta l'apertura", async () => {
      mockGroupBy(
        [
          { cerCode: '150106', type: 'CARICO', unit: 'KG', _sum: { quantity: 10 } },
          { cerCode: '150106', type: 'SCARICO', unit: 'KG', _sum: { quantity: 10 } },
        ],
        [mov('150106', 'CARICO', 10, '2026-01-01'), mov('150106', 'SCARICO', 10, '2026-01-10')]
      )
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 5, 'KG', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g.giacenzaKg).toBe(5)
      expect(g.oldestCaricoDate).toEqual(new Date('2026-02-01T00:00:00Z'))
    })

    it("l'asterisco vince fra apertura e movimenti", async () => {
      mockGroupBy([{ cerCode: '150110', type: 'CARICO', unit: 'KG', _sum: { quantity: 1 } }], [])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 10*', 4, 'KG', '2026-02-01'),
      ])
      const giacenze = await service.getGiacenze('tenant-1')
      expect(giacenze).toHaveLength(1)
      expect(giacenze[0].cerCode).toBe('15 01 10*')
    })

    it('le unità non di massa hanno il loro iniziale e non si mescolano ai kg', async () => {
      mockGroupBy([
        { cerCode: '150106', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
        { cerCode: '150106', type: 'SCARICO', unit: 'LITRI', _sum: { quantity: 10 } },
      ])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 50, 'LITRI', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g.caricoKg).toBe(0)
      expect(g.inizialeKg).toBe(0)
      expect(g.altreUnita).toEqual([
        { unita: 'LITRI', carico: 80, scarico: 10, giacenza: 70, iniziale: 50 },
      ])
    })

    it('le aperture si leggono una sola volta, per tenant e, se indicato, per registro', async () => {
      mockGroupBy([], [])
      await service.getGiacenze('tenant-1', 'reg-A')
      expect(prisma.giacenzaIniziale.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.giacenzaIniziale.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        registroId: 'reg-A',
      })
      prisma.giacenzaIniziale.findMany.mockClear()
      await service.getGiacenze('tenant-1')
      expect(prisma.giacenzaIniziale.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.giacenzaIniziale.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
      })
    })
  })
})
