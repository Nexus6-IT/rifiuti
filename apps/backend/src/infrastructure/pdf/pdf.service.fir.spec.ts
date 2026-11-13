import { Prisma } from '@prisma/client'
import { PDFService } from './pdf.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('PDFService.buildFIRContent - numero del FIR', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const firBase = {
    status: 'EMESSO',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producer: { companyName: 'Produttore SRL' },
    carrier: { companyName: 'Trasportatore SRL' },
    receiver: { companyName: 'Destinatario SRL' },
    cerCode: '13 02 05*',
    quantity: 120,
    unitOfMeasure: 'KG',
    signatures: [],
  }

  const contenuto = (fir: object) =>
    JSON.stringify((new PDFService(logger) as any).buildFIRContent(fir))

  it('con il numero RENTRI, "Numero FIR" è quello e il riferimento interno ha la sua etichetta', () => {
    const testo = contenuto({
      ...firBase,
      firNumber: 'FIR-2026-000007',
      rentriNumeroFir: 'XYZ123',
    })
    expect(testo).toMatch(/"Numero FIR".*"XYZ123"/)
    expect(testo).toMatch(/"Riferimento interno".*"FIR-2026-000007"/)
  })

  it('senza numero RENTRI resta il riferimento interno come oggi', () => {
    const testo = contenuto({ ...firBase, firNumber: 'FIR-2026-000007', rentriNumeroFir: null })
    expect(testo).toMatch(/"Numero FIR".*"FIR-2026-000007"/)
    expect(testo).not.toContain('Riferimento interno')
  })
})

describe('PDFService.buildFIRContent - record Prisma grezzo (come lo passa il controller)', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  // Forma vera di `prisma.fIR.findFirst`: `effectiveWeight` e `quantity` Decimal, `unit`,
  // snapshot delle parti in `*Name`/`*Address`/`*PartitaIva`. Nessun `pesoEffettivo`/`unitOfMeasure`.
  const recordPrisma = {
    status: 'CONSEGNATO',
    firNumber: 'FIR-2026-000007',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producerName: 'Produttore SRL',
    producerAddress: 'Via Roma 1',
    producerPartitaIva: '01234567890',
    carrierName: 'Trasportatore SRL',
    carrierPartitaIva: '09876543210',
    receiverName: 'Destinatario SRL',
    receiverAddress: 'Via Milano 2',
    receiverPartitaIva: '11111111111',
    cerCode: '13 02 05*',
    quantity: new Prisma.Decimal('2'),
    unit: 'T',
    effectiveWeight: new Prisma.Decimal('2.5'),
    signatures: [],
  }

  const contenuto = (fir: object) =>
    JSON.stringify((new PDFService(logger) as any).buildFIRContent(fir))

  it('la quantita dichiarata esce con l unita del record, non "undefined"', () => {
    const testo = contenuto(recordPrisma)
    expect(testo).toContain('2 T')
    expect(testo).not.toContain('undefined')
  })

  it('il peso a destino (effectiveWeight Decimal) esce con l unita del record, non N/D ne kg', () => {
    const testo = contenuto(recordPrisma)
    expect(testo).toContain('2.5 T')
    expect(testo).toMatch(/"Peso effettivo ricevuto".*"2.5 T"/)
    expect(testo).not.toContain('2.5 kg')
  })

  it('senza peso a destino la 4a copia non compare e senza unita ripiega su kg', () => {
    const testo = contenuto({ ...recordPrisma, effectiveWeight: null, unit: undefined })
    expect(testo).not.toContain('4ª COPIA')
    expect(testo).toContain('2 kg')
  })

  it('un peso a destino pari a 0 non e assente: la 4a copia compare con 0 e l unita', () => {
    const testo = contenuto({ ...recordPrisma, effectiveWeight: 0 })
    expect(testo).toContain('4ª COPIA')
    expect(testo).toMatch(/"Peso effettivo ricevuto".*"0 T"/)
  })

  it('produttore, trasportatore e destinatario escono dallo snapshot del record', () => {
    const testo = contenuto(recordPrisma)
    expect(testo).toContain('Produttore SRL')
    expect(testo).toContain('Trasportatore SRL')
    expect(testo).toContain('Via Milano 2')
    expect(testo).not.toContain('Informazioni non disponibili')
  })
})

describe('PDFService.buildFIRContent - codice fiscale delle parti (F2-10 D9.10)', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const base = {
    status: 'CONSEGNATO',
    firNumber: 'FIR-2026-000008',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producerName: 'Mario Rossi',
    producerAddress: 'Via Roma 1',
    producerPartitaIva: '',
    producerCodiceFiscale: 'RSSMRA80A01H501U',
    carrierName: 'Trasportatore SRL',
    carrierPartitaIva: '09876543210',
    receiverName: 'Destinatario SRL',
    receiverAddress: 'Via Milano 2',
    receiverPartitaIva: '11111111111',
    cerCode: '13 02 05*',
    quantity: new Prisma.Decimal('2'),
    unit: 'kg',
    signatures: [],
  }
  const contenuto = (fir: object) =>
    JSON.stringify((new PDFService(logger) as any).buildFIRContent(fir))

  it('un privato con la sola P.IVA vuota stampa il codice fiscale, non N/A', () => {
    const testo = contenuto(base)
    expect(testo).toContain('RSSMRA80A01H501U')
  })

  it('con la P.IVA presente stampa quella', () => {
    const testo = contenuto(base)
    expect(testo).toContain('09876543210')
    expect(testo).toContain('11111111111')
  })
})

describe('PDFService.buildFIRContent - date e ore in ora italiana', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  // Il codice sotto test non deve dipendere da TZ del processo: la CI gira in UTC, questa
  // macchina in Europe/Rome, e le attese qui sono le stesse in entrambi i casi.

  const firBase = {
    status: 'EMESSO',
    firNumber: 'FIR-2026-000007',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producer: { companyName: 'Produttore SRL' },
    carrier: { companyName: 'Trasportatore SRL' },
    receiver: { companyName: 'Destinatario SRL' },
    cerCode: '13 02 05*',
    quantity: 120,
    unitOfMeasure: 'KG',
    signatures: [],
  }

  const contenuto = (fir: object) =>
    JSON.stringify((new PDFService(logger) as any).buildFIRContent(fir))

  it('la firma estiva si stampa in ora italiana', () => {
    const testo = contenuto({
      ...firBase,
      signatures: [
        { role: 'PRODUTTORE', signerName: 'Mario Rossi', signedAt: '2026-07-10T08:12:00Z' },
      ],
    })
    expect(testo).toContain('10/07/2026 10:12')
    expect(testo).not.toContain('08:12')
  })

  it('la firma invernale dopo le 23 UTC cambia anche il giorno', () => {
    const testo = contenuto({
      ...firBase,
      signatures: [
        { role: 'PRODUTTORE', signerName: 'Mario Rossi', signedAt: '2026-01-10T23:30:00Z' },
      ],
    })
    expect(testo).toContain('11/01/2026 00:30')
  })

  it('la data di emissione subito dopo la mezzanotte italiana è quella italiana', () => {
    const testo = contenuto({ ...firBase, createdAt: new Date('2026-03-28T23:30:00Z') })
    expect(testo).toContain('29/03/2026')
    expect(testo).not.toContain('28/3/2026')
  })

  it('la data di restituzione della 4ª copia subito dopo la mezzanotte italiana è quella italiana', () => {
    const testo = contenuto({
      ...firBase,
      fourthCopyReturnedAt: new Date('2026-10-24T23:30:00Z'),
    })
    expect(testo).toContain('25/10/2026')
    expect(testo).not.toContain('24/10/2026')
  })
})

describe('PDFService: logo del modello non decodificabile (revisione I1)', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService
  const rotto = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.alloc(100, 7),
  ]).toString('base64')
  const fir = {
    status: 'EMESSO',
    firNumber: 'FIR-2026-000001',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producer: { companyName: 'Produttore SRL' },
    carrier: { companyName: 'Trasportatore SRL' },
    receiver: { companyName: 'Destinatario SRL' },
    cerCode: '13 02 05*',
    quantity: 120,
    unitOfMeasure: 'KG',
    signatures: [],
  }

  it('il PDF del FIR esce senza logo invece di fallire, e lo segnala nel log', async () => {
    const service = new PDFService(logger)
    const pdf = await service.generateFIRPDF(fir, undefined, { logoBase64: rotto, copie: 1 } as any)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('anche la serie esce senza logo', async () => {
    const service = new PDFService(logger)
    const pdf = await service.generateFIRSeriePDF([{ fir }], { logoBase64: rotto, copie: 1 } as any)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  })
})

describe('PDFService.generateFIRSeriePDF - filigrana BOZZA per pagina (render reale pdfmake)', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const fir = (numero: string, status: string) => ({
    status,
    firNumber: numero,
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producer: { companyName: 'Produttore SRL' },
    carrier: { companyName: 'Trasportatore SRL' },
    receiver: { companyName: 'Destinatario SRL' },
    cerCode: '13 02 05*',
    quantity: 120,
    unitOfMeasure: 'KG',
    signatures: [],
  })

  /** Esegue la serie e registra, per ogni passata di rendering, quali pagine hanno la filigrana. */
  const rendiERegistra = async (elementi: Array<{ fir: object }>, copie: number) => {
    const service = new PDFService(logger)
    const passate: Array<Map<number, boolean>> = []
    // La misura e il render vero passano entrambi da createPdfKitDocument.
    const stampante = (service as any).printer
    const originale = stampante.createPdfKitDocument.bind(stampante)
    jest.spyOn(stampante, 'createPdfKitDocument').mockImplementation((def: any) => {
      const mappa = new Map<number, boolean>()
      passate.push(mappa)
      if (typeof def.background === 'function') {
        const bg = def.background
        def.background = (p: number, dim: unknown) => {
          const r = bg(p, dim)
          mappa.set(p, r !== null && r !== undefined)
          return r
        }
      }
      return originale(def)
    })
    const pdf = await service.generateFIRSeriePDF(elementi as never, { copie } as never)
    return { pdf, passate }
  }

  it('serie mista: la filigrana e solo sulle pagine della bozza (2 copie = 2 pagine)', async () => {
    const { pdf, passate } = await rendiERegistra(
      [{ fir: fir('A', 'EMESSO') }, { fir: fir('B', 'DRAFT') }, { fir: fir('C', 'EMESSO') }],
      2
    )
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    // passata di misura + passata vera
    expect(passate).toHaveLength(2)
    // A: p1-2, B (bozza): p3-4, C: p5-6
    expect([...passate[1].entries()].sort(([a], [b]) => a - b)).toEqual([
      [1, false],
      [2, false],
      [3, true],
      [4, true],
      [5, false],
      [6, false],
    ])
    // la passata di misura non ha ancora la mappa: nessuna filigrana
    expect([...passate[0].values()].some(Boolean)).toBe(false)
  })

  it("serie mista con logo corrotto: la misura non produce PDF e l'avviso esce una volta sola", async () => {
    const rotto = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.alloc(100, 7),
    ]).toString('base64')
    const service = new PDFService(logger)
    const rendi = jest.spyOn(service as any, 'rendi')
    ;(logger.warn as jest.Mock).mockClear()
    const pdf = await service.generateFIRSeriePDF(
      [{ fir: fir('A', 'EMESSO') }, { fir: fir('B', 'DRAFT') }] as never,
      { copie: 1, logoBase64: rotto } as never
    )
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(rendi).toHaveBeenCalledTimes(1)
  })

  it('serie non mista: una sola passata', async () => {
    const solo = await rendiERegistra([{ fir: fir('A', 'EMESSO') }, { fir: fir('B', 'EMESSO') }], 1)
    expect(solo.passate).toHaveLength(1)
    const bozze = await rendiERegistra([{ fir: fir('A', 'DRAFT') }, { fir: fir('B', 'DRAFT') }], 1)
    expect(bozze.passate).toHaveLength(1)
  })
})
