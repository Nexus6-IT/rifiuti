import {
  causaCobat,
  quantitaCobat,
  soggettoCodazi,
  tipoMovimentoCobat,
  type ParteCobat,
} from './derivazioni'

const noi: ParteCobat = { codiceFiscale: '11111111111', partitaIva: '11111111111', esterno: false }
const esterno = (cf: string | null, piva: string | null = null): ParteCobat => ({
  codiceFiscale: cf,
  partitaIva: piva,
  esterno: true,
})

describe('tipoMovimentoCobat (D10)', () => {
  it('carico di produzione -> 2 (WW 10, 22)', () => {
    expect(
      tipoMovimentoCobat({ verso: 'CARICO', ruolo: 'PRODOTTO', trasportatoreEsterno: false })
    ).toBe(2)
  })
  it('carico da terzi -> 3, oppure 6 con trasportatore esterno (WW 20)', () => {
    const i = { verso: 'CARICO', ruolo: 'RICEVUTO_DA_TERZI' } as const
    expect(tipoMovimentoCobat({ ...i, trasportatoreEsterno: false })).toBe(3)
    expect(tipoMovimentoCobat({ ...i, trasportatoreEsterno: true })).toBe(6)
  })
  it('scarico avviato -> 4, oppure 7 con trasportatore esterno (WW 11-13, 15, 16...)', () => {
    const i = { verso: 'SCARICO', ruolo: 'AVVIATO' } as const
    expect(tipoMovimentoCobat({ ...i, trasportatoreEsterno: false })).toBe(4)
    expect(tipoMovimentoCobat({ ...i, trasportatoreEsterno: true })).toBe(7)
  })
  it('trattamento interno (5) e trasporto conto terzi (1) solo per forzatura', () => {
    const i = { verso: 'SCARICO', ruolo: 'AVVIATO', trasportatoreEsterno: false } as const
    expect(tipoMovimentoCobat({ ...i, forzatura: 5 })).toBe(5)
    expect(tipoMovimentoCobat({ ...i, forzatura: 1 })).toBe(1)
  })
  it('ruolo non determinabile: null', () => {
    expect(
      tipoMovimentoCobat({ verso: 'CARICO', ruolo: 'AVVIATO', trasportatoreEsterno: false })
    ).toBeNull()
    expect(
      tipoMovimentoCobat({ verso: 'SCARICO', ruolo: 'ESCLUSO', trasportatoreEsterno: false })
    ).toBeNull()
  })
})

describe('causaCobat (D10)', () => {
  const base = { verso: 'SCARICO', ruolo: 'AVVIATO', operazione: 'D' } as const
  it('carico di produzione -> 2', () => {
    expect(
      causaCobat({ verso: 'CARICO', ruolo: 'PRODOTTO', operationCode: null, operazione: 'R' })
    ).toBe(2)
  })
  it('operazione R -> 5', () => {
    expect(causaCobat({ ...base, operationCode: 'R13', operazione: 'R' })).toBe(5)
    expect(causaCobat({ ...base, operationCode: null, operazione: 'R' })).toBe(5)
  })
  it.each([1, 3, 4, 5, 6, 7, 12])('D%i -> 3', n => {
    expect(causaCobat({ ...base, operationCode: `D${n}` })).toBe(3)
  })
  it.each([2, 8, 9, 10, 11, 13, 14])('D%i -> 4', n => {
    expect(causaCobat({ ...base, operationCode: `D${n}` })).toBe(4)
  })
  it('D15 -> 1 (anche scritto D 15 o d15)', () => {
    expect(causaCobat({ ...base, operationCode: 'D15' })).toBe(1)
    expect(causaCobat({ ...base, operationCode: 'd 15' })).toBe(1)
  })
  it('D1 non e D10, D12 non e D1', () => {
    expect(causaCobat({ ...base, operationCode: 'D1' })).toBe(3)
    expect(causaCobat({ ...base, operationCode: 'D10' })).toBe(4)
  })
  it('altro: null; la forzatura vince', () => {
    expect(causaCobat({ ...base, operationCode: 'D99' })).toBeNull()
    expect(causaCobat({ ...base, operationCode: null })).toBeNull()
    expect(causaCobat({ ...base, operationCode: 'D99', forzatura: 4 })).toBe(4)
  })
})

describe('soggettoCodazi: precedenza esplicita destinatario > trasportatore > produttore', () => {
  it('vince il destinatario', () => {
    const r = soggettoCodazi({
      produttore: esterno('AAA'),
      trasportatore: esterno('BBB'),
      destinatario: esterno('CCC'),
    })
    expect(r).toEqual({ codice: 'CCC', soggetto: 'DESTINATARIO' })
  })
  it('se il destinatario siamo noi, vince il trasportatore esterno', () => {
    const r = soggettoCodazi({
      produttore: esterno('AAA'),
      trasportatore: esterno('BBB'),
      destinatario: noi,
    })
    expect(r).toEqual({ codice: 'BBB', soggetto: 'TRASPORTATORE' })
  })
  it('altrimenti il produttore', () => {
    const r = soggettoCodazi({ produttore: esterno('AAA'), trasportatore: noi, destinatario: noi })
    expect(r).toEqual({ codice: 'AAA', soggetto: 'PRODUTTORE' })
  })
  it('senza codice fiscale si usa la partita IVA', () => {
    const r = soggettoCodazi({
      produttore: esterno(null, '01234567890'),
      trasportatore: noi,
      destinatario: noi,
    })
    expect(r?.codice).toBe('01234567890')
  })
  it('un soggetto esterno senza codici cede il passo al successivo', () => {
    const r = soggettoCodazi({
      produttore: esterno('AAA'),
      trasportatore: noi,
      destinatario: esterno(' ', ''),
    })
    expect(r?.soggetto).toBe('PRODUTTORE')
  })
  it('tutti noi: null', () => {
    expect(soggettoCodazi({ produttore: noi, trasportatore: noi, destinatario: noi })).toBeNull()
  })
})

describe('quantitaCobat', () => {
  it('kg: quam3 = 0, quaton = kg / 1000', () => {
    expect(quantitaCobat(2500, 2500, 'KG')).toEqual({ quam3: 0, quaton: 2.5 })
  })
  it('litri: quam3 = L / 1000', () => {
    expect(quantitaCobat(900, 1000, 'L')).toEqual({ quam3: 1, quaton: 0.9 })
  })
  it('metri cubi: quam3 = quantita', () => {
    expect(quantitaCobat(900, 2, 'MC')).toEqual({ quam3: 2, quaton: 0.9 })
  })
  it('peso ignoto: null', () => {
    expect(quantitaCobat(null, 3, 'L')).toBeNull()
  })
})
