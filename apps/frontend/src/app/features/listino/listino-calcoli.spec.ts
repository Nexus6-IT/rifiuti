import {
  cascataItaliana,
  decimaleItaliano,
  elenchiValidiAl,
  importoItaliano,
  messaggiErrore,
  oggiIso,
  righeInTesto,
  totaleFissiAnnuo,
} from './listino-calcoli'

describe('listino-calcoli', () => {
  it('elenchi validi al: non scaduti, anche quelli che iniziano dopo (come il dominio)', () => {
    const e = [
      { id: 'sempre', validoDal: null, validoAl: null },
      { id: 'in-corso', validoDal: '2026-03-01', validoAl: '2026-03-31' },
      { id: 'ultimo-giorno', validoDal: '2026-01-01', validoAl: '2026-03-15' },
      { id: 'scaduto', validoDal: '2025-01-01', validoAl: '2026-03-14' },
      { id: 'futuro', validoDal: '2026-09-01', validoAl: '2026-12-31' },
    ]
    expect(elenchiValidiAl(e, '2026-03-15').map(x => x.id)).toEqual([
      'sempre',
      'in-corso',
      'ultimo-giorno',
      'futuro',
    ])
  })

  it('oggiIso è la data locale', () => {
    expect(oggiIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  describe('totale fissi: somma esatta, un solo arrotondamento half-up', () => {
    const ogni = { anno: null }
    const una = { anno: 2026 }
    const f = (quantitaFissa: string | null, prezzo: string | null, scadenze = [ogni, una]) => ({
      tipo: 'F',
      quantitaFissa,
      prezzo,
      scadenze,
    })

    it('casi semplici: vuoto, quantità vuota = 1, zero = non fatturare', () => {
      expect(totaleFissiAnnuo([])).toBe('0.00')
      expect(totaleFissiAnnuo([f(null, '100.50')])).toBe('100.50')
      expect(totaleFissiAnnuo([f('2', '10.004')])).toBe('20.01')
      expect(totaleFissiAnnuo([f('0', '100')])).toBe('0.00')
    })

    it('solo le scadenze ogni anno contano, e si moltiplicano', () => {
      expect(totaleFissiAnnuo([f(null, '10', [ogni, { anno: null }])])).toBe('20.00')
      expect(totaleFissiAnnuo([f(null, '10', [una])])).toBe('0.00')
    })

    it('3 x 0,335 su tre scadenze = 3,02 (nessun arrotondamento per riga)', () => {
      const tre = [ogni, ogni, ogni]
      expect(totaleFissiAnnuo([f(null, '0.335', tre)])).toBe('1.01')
      expect(
        totaleFissiAnnuo([
          f(null, '0.335', [ogni]),
          f(null, '0.335', [ogni]),
          f(null, '0.335', [ogni]),
        ])
      ).toBe('1.01')
      expect(totaleFissiAnnuo([f('3', '0.335', tre)])).toBe('3.02')
    })

    it('due fissi da 0,005 = 0,01', () => {
      expect(totaleFissiAnnuo([f(null, '0.005', [ogni]), f(null, '0.005', [ogni])])).toBe('0.01')
    })

    it('nessun troncamento delle cifre oltre il sesto', () => {
      expect(totaleFissiAnnuo([f(null, '0.0049999999', [ogni])])).toBe('0.00')
      expect(totaleFissiAnnuo([f(null, '0.0050000001', [ogni])])).toBe('0.01')
    })

    it('ignora le righe non fisse e quelle senza prezzo', () => {
      expect(
        totaleFissiAnnuo([
          f(null, '10'),
          f(null, '5.25'),
          { ...f(null, '99'), tipo: 'V' },
          f(null, null),
        ])
      ).toBe('15.25')
    })
  })

  it('decimale italiano: virgola, migliaia, zeri finali fino al minimo', () => {
    expect(decimaleItaliano('0.080000', 2)).toBe('0,08')
    expect(decimaleItaliano('12.500000', 2)).toBe('12,50')
    expect(decimaleItaliano('1.000')).toBe('1')
    expect(decimaleItaliano('0.1234567', 2)).toBe('0,1234567')
    expect(decimaleItaliano('1234567.5', 2)).toBe('1.234.567,50')
    expect(decimaleItaliano('10+5', 2)).toBe('10+5')
    expect(decimaleItaliano(null, 2)).toBe('')
  })

  it('importo italiano con due decimali', () => {
    expect(importoItaliano('0.00')).toBe('0,00')
    expect(importoItaliano('1234.50')).toBe('1.234,50')
  })

  it('righe in testo: zero, una, molte', () => {
    expect(righeInTesto(0)).toBe('senza righe')
    expect(righeInTesto(1)).toBe('con la sua riga')
    expect(righeInTesto(7)).toBe('con le sue 7 righe')
  })

  it('messaggi del backend: array, stringa, ripiego', () => {
    expect(messaggiErrore({ error: { message: ['a', ' ', 'b'] } }, 'x')).toEqual(['a', 'b'])
    expect(messaggiErrore({ error: { message: 'solo' } }, 'x')).toEqual(['solo'])
    expect(messaggiErrore({}, 'x')).toEqual(['x'])
  })
})

describe('cascataItaliana', () => {
  it('sconti e provvigioni con la virgola decimale', () => {
    expect(cascataItaliana('12.5+5')).toBe('12,5+5')
    expect(cascataItaliana('10')).toBe('10')
    expect(cascataItaliana('0.5+0.25+10')).toBe('0,5+0,25+10')
  })

  it('vuoto e null restano vuoti', () => {
    expect(cascataItaliana(null)).toBe('')
    expect(cascataItaliana(undefined)).toBe('')
    expect(cascataItaliana('')).toBe('')
  })
})
