import {
  FAMIGLIE_CALCOLATE,
  famigliaCalcolata,
  importoBolloAl,
  NATURE_NON_AMMESSE,
  NATURE_SOGGETTE_BOLLO,
  REGIMI_FISCALI,
  SOGLIA_BOLLO,
  TOLLERANZE_SDI,
} from './costanti-fiscali'

describe('bollo', () => {
  it('soglia e importo', () => {
    expect(SOGLIA_BOLLO).toBe('77.47')
    expect(importoBolloAl('2026-11-05')).toBe('2.00')
    expect(importoBolloAl('2013-06-26')).toBe('2.00')
  })
  it('prima del 2013-06-26 e un errore', () => {
    expect(() => importoBolloAl('2013-06-25')).toThrow()
  })
  it('data malformata e un errore', () => {
    expect(() => importoBolloAl('05/11/2026')).toThrow()
    expect(() => importoBolloAl('')).toThrow()
  })
  it('nature soggette a bollo (guardia: ampliarla e un cambio esplicito)', () => {
    expect([...NATURE_SOGGETTE_BOLLO]).toEqual(['N1', 'N2.1', 'N2.2', 'N3.5', 'N3.6', 'N4'])
  })
  it('nature non ammesse', () => {
    expect([...NATURE_NON_AMMESSE]).toEqual(['N2', 'N3', 'N6'])
  })
})

describe('REGIMI_FISCALI', () => {
  it('19 valori, RF01 e RF20 si, RF03 no', () => {
    expect(REGIMI_FISCALI).toHaveLength(19)
    expect(REGIMI_FISCALI).toContain('RF01')
    expect(REGIMI_FISCALI).toContain('RF20')
    expect(REGIMI_FISCALI).not.toContain('RF03')
    expect(new Set(REGIMI_FISCALI).size).toBe(19)
  })
})

describe('TOLLERANZE_SDI', () => {
  it('valori', () => {
    expect(TOLLERANZE_SDI).toEqual({ prezzoTotale: '0.01', imposta: '0.01', imponibile: '1.00' })
  })
})

describe('famigliaCalcolata', () => {
  const r = (o: Partial<Parameters<typeof famigliaCalcolata>[0]> & { tipo: string }) => ({
    prezzoSpeciale: false,
    applicaA: null,
    condizione: null,
    condizioniRiferite: null,
    ...o,
  })

  it.each(['CER', 'V', 'F', 'MW', 'MF', 'M001', 'TT', 'TF'])(
    '%s a prezzo singolo e calcolata',
    tipo => {
      expect(famigliaCalcolata(r({ tipo }))).toBe(true)
    }
  )

  it.each(['DOCUMENTO', 'PERIODO'])('prezzo speciale %s su CER e V e calcolato', applicaA => {
    expect(famigliaCalcolata(r({ tipo: 'CER', prezzoSpeciale: true, applicaA }))).toBe(true)
    expect(famigliaCalcolata(r({ tipo: 'V', prezzoSpeciale: true, applicaA }))).toBe(true)
  })

  it.each([
    'TS',
    'TP',
    'TQ',
    'TR',
    'T001',
    'NM',
    'NR',
    '$A',
    '$D',
    '$R',
    'PROGRESSIVO_DA_DATA',
    'CONGUAGLIO_365',
    'GIORNO',
  ])('%s non e calcolata', tipo => {
    expect(famigliaCalcolata(r({ tipo }))).toBe(false)
  })

  it('TT e TF a prezzo speciale no', () => {
    expect(famigliaCalcolata(r({ tipo: 'TT', prezzoSpeciale: true, applicaA: 'DOCUMENTO' }))).toBe(
      false
    )
    expect(famigliaCalcolata(r({ tipo: 'TF', prezzoSpeciale: true, applicaA: 'PERIODO' }))).toBe(
      false
    )
  })

  it('prezzo speciale su altre famiglie o con applicaA diverso no', () => {
    expect(famigliaCalcolata(r({ tipo: 'F', prezzoSpeciale: true, applicaA: 'DOCUMENTO' }))).toBe(
      false
    )
    expect(famigliaCalcolata(r({ tipo: 'CER', prezzoSpeciale: true, applicaA: null }))).toBe(false)
    expect(famigliaCalcolata(r({ tipo: 'CER', prezzoSpeciale: true, applicaA: 'MOVIMENTO' }))).toBe(
      false
    )
  })

  it('righe condizionate no', () => {
    expect(famigliaCalcolata(r({ tipo: 'CER', condizione: 1 }))).toBe(false)
    expect(famigliaCalcolata(r({ tipo: 'CER', condizioniRiferite: '1,2' }))).toBe(false)
  })

  it('FAMIGLIE_CALCOLATE elenca i tipi riga', () => {
    expect([...FAMIGLIE_CALCOLATE]).toEqual(['CER', 'V', 'F', 'MW', 'MF', 'M<cat>', 'TT', 'TF'])
  })
})
