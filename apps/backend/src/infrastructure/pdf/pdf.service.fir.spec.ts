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
