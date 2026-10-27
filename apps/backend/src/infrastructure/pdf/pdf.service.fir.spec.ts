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

describe('PDFService.buildFIRContent - peso a destino nell unita del FIR', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const firBase = {
    status: 'CONSEGNATO',
    firNumber: 'FIR-2026-000007',
    createdAt: new Date('2026-03-05T10:00:00Z'),
    producer: { companyName: 'Produttore SRL' },
    carrier: { companyName: 'Trasportatore SRL' },
    receiver: { companyName: 'Destinatario SRL' },
    cerCode: '13 02 05*',
    quantity: 2,
    signatures: [],
  }

  const contenuto = (fir: object) =>
    JSON.stringify((new PDFService(logger) as any).buildFIRContent(fir))

  it('il peso effettivo esce con l unita del FIR, non con kg fisso', () => {
    const testo = contenuto({ ...firBase, unitOfMeasure: 'T', pesoEffettivo: 2.5 })
    expect(testo).toContain('2.5 T')
    expect(testo).not.toContain('2.5 kg')
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
