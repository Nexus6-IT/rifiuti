import { PDFService } from './pdf.service'
import {
  definizioneFir,
  definizioneFirInSerie,
  ModelloStampaNonValidoError,
  type ModelloStampaFir,
} from './definizione-fir'
import { LoggerService } from '../../core/logger/logger.service'

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// Estensione .png, contenuto di testo: i magic bytes non tornano.
const FALSO_PNG = `data:image/png;base64,${Buffer.from('questo non e un png').toString('base64')}`

const fir = (numero: string) => ({
  status: 'EMESSO',
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

const testo = (d: object) => JSON.stringify(d)

describe('definizioneFir', () => {
  it('senza modello e senza QR: titolo standard, nessuna immagine, nessuna dicitura copia', () => {
    const t = testo(definizioneFir(fir('FIR-2026-000001')))
    expect(t).toContain('FORMULARIO IDENTIFICAZIONE RIFIUTI (FIR)')
    expect(t).not.toContain('"image"')
    expect(t).not.toContain('Copia 1 di')
  })

  it('con il QR lo include; senza no', () => {
    const con = testo(definizioneFir(fir('FIR-2026-000001'), 'data:image/png;base64,AAAA'))
    expect(con).toContain('CODICE QR VERIFICA')
    expect(testo(definizioneFir(fir('FIR-2026-000001')))).not.toContain('CODICE QR VERIFICA')
  })

  it('il modello applica intestazione, piè di pagina, colori e logo', () => {
    const modello: ModelloStampaFir = {
      headerText: 'Ditta Rossi',
      footerText: 'Rossi SRL - P.IVA 1',
      primaryColor: '#112233',
      secondaryColor: '#445566',
      logoBase64: PNG_1X1,
    }
    const d = definizioneFir(fir('FIR-2026-000001'), undefined, modello)
    const t = testo(d)
    expect(t).toContain('Ditta Rossi')
    expect(t).toContain(PNG_1X1)
    expect(t).not.toContain('FORMULARIO IDENTIFICAZIONE RIFIUTI (FIR)"')
    expect(d.styles?.['header']).toMatchObject({ color: '#112233' })
    expect(d.styles?.['sectionHeader']).toMatchObject({ color: '#445566' })
    const piede = (d.footer as (a: number, b: number) => { text: string })(2, 5)
    expect(piede.text).toContain('Rossi SRL - P.IVA 1')
    expect(piede.text).toContain('Pagina 2 di 5')
  })

  it('copie = 3 dà tre blocchi "Copia n di 3" con salto pagina', () => {
    const d = definizioneFir(fir('FIR-2026-000001'), undefined, { copie: 3 })
    const t = testo(d)
    expect(t).toContain('Copia 1 di 3')
    expect(t).toContain('Copia 2 di 3')
    expect(t).toContain('Copia 3 di 3')
    expect(t.match(/"pageBreak":"before"/g)).toHaveLength(2)
  })

  it.each([0, 5, 1.5])('copie %p è rifiutato', copie => {
    expect(() => definizioneFir(fir('X'), undefined, { copie })).toThrow(
      ModelloStampaNonValidoError
    )
  })

  it('logo con magic bytes sbagliati è rifiutato', () => {
    expect(() => definizioneFir(fir('X'), undefined, { logoBase64: FALSO_PNG })).toThrow(
      /non corrisponde/
    )
  })

  it('logo che non è PNG/JPEG è rifiutato', () => {
    expect(() =>
      definizioneFir(fir('X'), undefined, { logoBase64: 'data:image/svg+xml;base64,PHN2Zz4=' })
    ).toThrow(ModelloStampaNonValidoError)
  })

  it('colore non esadecimale è rifiutato', () => {
    expect(() => definizioneFir(fir('X'), undefined, { primaryColor: 'rosso' })).toThrow(
      ModelloStampaNonValidoError
    )
  })
})

describe('definizioneFirInSerie', () => {
  it('serie di 2 FIR con 2 copie: 4 blocchi, 3 salti pagina, ordine rispettato', () => {
    const d = definizioneFirInSerie(
      [{ fir: fir('FIR-2026-000001') }, { fir: fir('FIR-2026-000002') }],
      { copie: 2 }
    )
    const t = testo(d)
    expect(t.match(/"pageBreak":"before"/g)).toHaveLength(3)
    expect(t.indexOf('FIR-2026-000001')).toBeLessThan(t.indexOf('FIR-2026-000002'))
  })

  it('il QR è per singolo FIR: solo il vidimato lo ha', () => {
    const d = definizioneFirInSerie([
      { fir: fir('FIR-2026-000001'), qrCodeDataUrl: 'data:image/png;base64,AAAA' },
      { fir: fir('FIR-2026-000002') },
    ])
    expect(testo(d).match(/CODICE QR VERIFICA/g)).toHaveLength(1)
  })

  it('serie vuota o oltre 100 è rifiutata', () => {
    expect(() => definizioneFirInSerie([])).toThrow(ModelloStampaNonValidoError)
    const troppi = Array.from({ length: 101 }, (_, i) => ({ fir: fir(`F${i}`) }))
    expect(() => definizioneFirInSerie(troppi)).toThrow(ModelloStampaNonValidoError)
  })
})

describe('PDFService - PDF reale', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService
  const pagine = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

  it('copie = 3 produce un PDF di 3 pagine', async () => {
    const pdf = await new PDFService(logger).generateFIRPDF(fir('FIR-2026-000001'), undefined, {
      copie: 3,
      logoBase64: PNG_1X1,
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pagine(pdf)).toBe(3)
  })

  it('serie di 2 FIR senza modello: 2 pagine in un solo PDF', async () => {
    const pdf = await new PDFService(logger).generateFIRSeriePDF([
      { fir: fir('FIR-2026-000001') },
      { fir: fir('FIR-2026-000002') },
    ])
    expect(pagine(pdf)).toBe(2)
  })
})
