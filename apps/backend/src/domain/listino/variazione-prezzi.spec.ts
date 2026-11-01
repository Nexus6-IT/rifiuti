import {
  aumentoIstat,
  improntaVariazione,
  nuoviScaglioni,
  nuovoPrezzo,
  validaPercentualiIstat,
} from './variazione-prezzi'

describe('nuovoPrezzo', () => {
  it('aumento percentuale: +10% su 12.5 -> 13.75', () => {
    expect(nuovoPrezzo('12.5', 'AUMENTO_PERCENTUALE', '10')).toEqual({ prezzo: '13.75' })
  })
  it('R4: +10% su 0.0125 -> 0.0138 (precisione dei decimali significativi)', () => {
    expect(nuovoPrezzo('0.0125', 'AUMENTO_PERCENTUALE', '10')).toEqual({ prezzo: '0.0138' })
  })
  it('zeri finali del prezzo non contano per la precisione', () => {
    expect(nuovoPrezzo('0.012500', 'AUMENTO_PERCENTUALE', '10')).toEqual({ prezzo: '0.0138' })
  })
  it('aumento importo: +0.5 su 10 -> 10.50', () => {
    expect(nuovoPrezzo('10', 'AUMENTO_IMPORTO', '0.5')).toEqual({ prezzo: '10.50' })
  })
  it('diminuzione percentuale: -20% su 1 -> 0.80', () => {
    expect(nuovoPrezzo('1', 'DIMINUZIONE_PERCENTUALE', '20')).toEqual({ prezzo: '0.80' })
  })
  it('diminuzione importo che rende negativo -> errore', () => {
    expect(nuovoPrezzo('10', 'DIMINUZIONE_IMPORTO', '15')).toEqual({
      errore: 'Il nuovo prezzo sarebbe negativo.',
    })
  })
  it('diminuzione percentuale oltre 100% -> errore', () => {
    expect(nuovoPrezzo('10', 'DIMINUZIONE_PERCENTUALE', '101')).toEqual({
      errore: 'Il nuovo prezzo sarebbe negativo.',
    })
  })
  it('diminuzione fino a zero e valida', () => {
    expect(nuovoPrezzo('10', 'DIMINUZIONE_IMPORTO', '10')).toEqual({ prezzo: '0.00' })
  })
  it('valore non numerico o non positivo -> errore', () => {
    expect(nuovoPrezzo('10', 'AUMENTO_IMPORTO', 'abc')).toEqual({
      errore: 'Il valore non è un numero.',
    })
    expect(nuovoPrezzo('10', 'AUMENTO_IMPORTO', '0')).toEqual({
      errore: 'Il valore deve essere maggiore di 0.',
    })
    expect(nuovoPrezzo('10', 'AUMENTO_IMPORTO', '-1')).toEqual({
      errore: 'Il valore deve essere maggiore di 0.',
    })
  })
  it('prezzo attuale non numerico -> errore', () => {
    expect(nuovoPrezzo('', 'AUMENTO_IMPORTO', '1')).toEqual({
      errore: 'Il prezzo attuale non è un numero.',
    })
  })
})

describe('nuoviScaglioni', () => {
  const f = (p: string) => nuovoPrezzo(p, 'AUMENTO_PERCENTUALE', '10')
  it('lascia invariati prezzi zero e vuoti', () => {
    const r = nuoviScaglioni(
      [
        { da: 0, prezzo: '10' },
        { da: 5, prezzo: '0' },
        { da: 9, prezzo: '0.00' },
        { da: 12, prezzo: '' },
      ],
      f
    )
    expect(r).toEqual({
      scaglioni: [
        { da: 0, prezzo: '11.00' },
        { da: 5, prezzo: '0' },
        { da: 9, prezzo: '0.00' },
        { da: 12, prezzo: '' },
      ],
    })
  })
  it('un errore su una fascia annulla tutto', () => {
    const r = nuoviScaglioni([{ prezzo: '1' }, { prezzo: '2' }], p =>
      p === '2' ? { errore: 'Il nuovo prezzo sarebbe negativo.' } : { prezzo: p }
    )
    expect(r).toEqual({ errore: 'Il nuovo prezzo sarebbe negativo.' })
  })
})

describe('validaPercentualiIstat', () => {
  it('valide e decrescenti dal mese piu vecchio', () => {
    expect(
      validaPercentualiIstat([
        { anno: 2024, mese: 1, percentuale: '3.0' },
        { anno: 2024, mese: 5, percentuale: '2.5' },
      ])
    ).toEqual([])
  })
  it('indipendente dall ordine di ingresso', () => {
    expect(
      validaPercentualiIstat([
        { anno: 2024, mese: 5, percentuale: '2.5' },
        { anno: 2024, mese: 1, percentuale: '3.0' },
      ])
    ).toEqual([])
  })
  it('crescenti rifiutate', () => {
    expect(
      validaPercentualiIstat([
        { anno: 2024, mese: 1, percentuale: '2' },
        { anno: 2024, mese: 2, percentuale: '3' },
      ])
    ).toEqual(['Le percentuali devono essere decrescenti dai mesi più vecchi ai più recenti.'])
  })
  it('uguali ammesse (non crescenti)', () => {
    expect(
      validaPercentualiIstat([
        { anno: 2023, mese: 12, percentuale: '2' },
        { anno: 2024, mese: 1, percentuale: '2' },
      ])
    ).toEqual([])
  })
  it('100, 0, negativa e non numerica rifiutate', () => {
    const msg = 'La percentuale deve essere maggiore di 0 e minore di 100.'
    for (const p of ['100', '0', '-1', 'x', '']) {
      expect(validaPercentualiIstat([{ anno: 2024, mese: 1, percentuale: p }])).toEqual([msg])
    }
  })
  it('mese duplicato e mese fuori intervallo', () => {
    expect(
      validaPercentualiIstat([
        { anno: 2024, mese: 1, percentuale: '2' },
        { anno: 2024, mese: 1, percentuale: '1' },
      ])
    ).toEqual(['Il mese è indicato più volte.'])
    expect(validaPercentualiIstat([{ anno: 2024, mese: 13, percentuale: '2' }])).toEqual([
      'Il mese indicato non è valido.',
    ])
  })
  it('elenco vuoto rifiutato', () => {
    expect(validaPercentualiIstat([])).toEqual(['Indica almeno una percentuale.'])
  })
})

describe('aumentoIstat', () => {
  it('applica la percentuale', () => {
    expect(aumentoIstat('100', '3')).toEqual({ prezzo: '103.00' })
    expect(aumentoIstat('0.0125', '10')).toEqual({ prezzo: '0.0138' })
  })
  it('percentuale <= 0 -> errore', () => {
    expect(aumentoIstat('100', '0')).toEqual({ errore: 'Il valore deve essere maggiore di 0.' })
    expect(aumentoIstat('100', '-2')).toEqual({ errore: 'Il valore deve essere maggiore di 0.' })
  })
})

describe('improntaVariazione', () => {
  const a = { id: 'a', versione: 1 }
  const b = { id: 'b', versione: 3 }
  it('stabile per ordine diverso', () => {
    expect(improntaVariazione([a, b])).toBe(improntaVariazione([b, a]))
    expect(improntaVariazione([a, b])).toMatch(/^[0-9a-f]{64}$/)
  })
  it('cambia con una versione diversa', () => {
    expect(improntaVariazione([a, b])).not.toBe(improntaVariazione([a, { ...b, versione: 4 }]))
  })
  it('R12: i duplicati (stesso id e versione) non cambiano l impronta', () => {
    expect(improntaVariazione([a, b, { ...a }])).toBe(improntaVariazione([a, b]))
  })
  it('non confonde id e versione concatenati', () => {
    expect(improntaVariazione([{ id: 'a1', versione: 1 }])).not.toBe(
      improntaVariazione([{ id: 'a', versione: 11 }])
    )
  })
})
