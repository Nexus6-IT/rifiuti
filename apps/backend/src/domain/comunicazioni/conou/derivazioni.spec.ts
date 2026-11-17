import {
  atecoConou,
  causaleConou,
  percentualeConou,
  percentualeOlioEffettiva,
  prodottoConou,
  quantitaConou,
} from './derivazioni'

describe('causaleConou (D11)', () => {
  it('carico -> E, scarico -> U', () => {
    expect(causaleConou('CARICO')).toBe('E')
    expect(causaleConou('SCARICO')).toBe('U')
  })
  it('B, M, L, D solo per forzatura', () => {
    for (const c of ['B', 'M', 'L', 'D'] as const) {
      expect(causaleConou('CARICO', c)).toBe(c)
      expect(causaleConou('SCARICO', c)).toBe(c)
    }
    expect(causaleConou('CARICO', null)).toBe('E')
  })
})

describe('quantitaConou', () => {
  it('intera, positiva', () => {
    expect(quantitaConou(1500.4, false)).toBe(1500)
    expect(quantitaConou(1500.5, false)).toBe(1501)
  })
  it('scarico interno: negativa (D11)', () => {
    expect(quantitaConou(300, true)).toBe(-300)
  })
  it('peso ignoto, zero o non finito: null', () => {
    expect(quantitaConou(null, false)).toBeNull()
    expect(quantitaConou(0, false)).toBeNull()
    expect(quantitaConou(0.3, true)).toBeNull()
    expect(quantitaConou(Number.NaN, false)).toBeNull()
  })
})

describe('prodottoConou: dati > predefinito della sede > unico ammesso', () => {
  const conf = { predefinitiPerCer: { '130205': { prodotto: 'C' as const, percentualeOlio: 80 } } }
  it('vince il dato del movimento', () => {
    const e = prodottoConou('13 02 05*', { prodotto: 'A' }, conf)
    expect(e).toEqual({ prodotto: 'A', fonte: 'MOVIMENTO', fuoriTabella: false })
  })
  it('poi il predefinito della sede (segnalato fuori tabella se non ammesso)', () => {
    const e = prodottoConou('130205*', {}, conf)
    expect(e).toEqual({ prodotto: 'C', fonte: 'PREDEFINITO_SEDE', fuoriTabella: true })
  })
  it('poi l unico ammesso dalla tabella CER', () => {
    const e = prodottoConou('130205*', undefined, { predefinitiPerCer: {} })
    expect(e).toEqual({ prodotto: 'A', fonte: 'UNICO_AMMESSO', fuoriTabella: false })
  })
  it('CER con piu prodotti e nessun dato: assente', () => {
    expect(prodottoConou('130101*', {}, { predefinitiPerCer: {} })).toEqual({
      prodotto: null,
      fonte: null,
      fuoriTabella: false,
    })
  })
  it('CER non in tabella: il prodotto scelto non e fuori tabella', () => {
    expect(prodottoConou('999999', { prodotto: 'B' }, null).fuoriTabella).toBe(false)
  })
})

describe('percentuale di olio', () => {
  it('dati del movimento > predefinito della sede > assente', () => {
    const conf = {
      predefinitiPerCer: { '130205': { prodotto: 'A' as const, percentualeOlio: 84.5 } },
    }
    expect(percentualeOlioEffettiva('130205*', { percentualeOlio: 70 }, conf)).toBe(70)
    expect(percentualeOlioEffettiva('13 02 05*', {}, conf)).toBe(84.5)
    expect(percentualeOlioEffettiva('130206*', {}, conf)).toBeNull()
  })
  it('x100 intera, senza errori di virgola mobile', () => {
    expect(percentualeConou(84.99)).toBe(8499)
    expect(percentualeConou(0.29)).toBe(29)
    expect(percentualeConou(1.15)).toBe(115)
    expect(percentualeConou(99.99)).toBe(9999)
  })
  it('fuori da 0,01-99,99: null', () => {
    expect(percentualeConou(0)).toBeNull()
    expect(percentualeConou(100)).toBeNull()
    expect(percentualeConou(null)).toBeNull()
  })
})

describe('atecoConou', () => {
  it('NN.NN.NN o 6 cifre -> NN.NN.NN', () => {
    expect(atecoConou('38.12.00', false)).toBe('38.12.00')
    expect(atecoConou('381200', false)).toBe('38.12.00')
  })
  it('privato: 0000 (tipaz P)', () => {
    expect(atecoConou(null, true)).toBe('0000')
  })
  it('mancante o malformato: null (bloccante)', () => {
    expect(atecoConou(null, false)).toBeNull()
    expect(atecoConou('', false)).toBeNull()
    expect(atecoConou('38.12', false)).toBeNull()
  })
})
