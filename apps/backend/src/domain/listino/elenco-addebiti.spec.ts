import {
  elencoProposto,
  elenchiValidiAl,
  normalizzaElenco,
  prossimoCodiceElenco,
  validaElenco,
  type DatiElenco,
} from './elenco-addebiti'
import {
  normalizzaContratto,
  validaContrattoCliente,
} from '../contratti-cliente/regole-contratto-cliente'

const base = (extra: Partial<Record<keyof DatiElenco, unknown>> = {}): DatiElenco =>
  normalizzaElenco({ codice: '001', descrizione: 'Elenco base', ...extra })

describe('normalizzaElenco', () => {
  it('toglie gli spazi, porta in maiuscolo codice, CIG e CUP, vuoti a null', () => {
    const d = normalizzaElenco({
      codice: ' a1 ',
      descrizione: '  X  ',
      nota1: '  ',
      codiceCig: ' abcdef1234 ',
      codiceCup: '',
      validoDal: new Date('2026-01-05T00:00:00Z'),
      predefinito: 'si',
    })
    expect(d.codice).toBe('A1')
    expect(d.descrizione).toBe('X')
    expect(d.nota1).toBeNull()
    expect(d.codiceCig).toBe('ABCDEF1234')
    expect(d.codiceCup).toBeNull()
    expect(d.validoDal).toBe('2026-01-05')
    expect(d.predefinito).toBe(false)
  })
})

describe('codice numerico', () => {
  it("si riempie a tre cifre: '1' e '001' sono lo stesso codice", () => {
    expect(normalizzaElenco({ codice: '1' }).codice).toBe('001')
    expect(normalizzaElenco({ codice: ' 42 ' }).codice).toBe('042')
    expect(normalizzaElenco({ codice: '001' }).codice).toBe('001')
    expect(normalizzaElenco({ codice: 'a1' }).codice).toBe('A1')
  })
})

describe('validaElenco', () => {
  it('descrizione e note: 45 caratteri ammessi, 46 no', () => {
    expect(
      validaElenco(
        base({ descrizione: 'x'.repeat(45), nota1: 'y'.repeat(45), nota2: 'z'.repeat(45) })
      )
    ).toEqual([])
    expect(validaElenco(base({ descrizione: 'x'.repeat(46) }))).toHaveLength(1)
    expect(validaElenco(base({ nota1: 'y'.repeat(46) }))).toHaveLength(1)
    expect(validaElenco(base({ nota2: 'z'.repeat(46) }))).toHaveLength(1)
  })

  it('dati validi: nessun messaggio', () => {
    expect(validaElenco(base())).toEqual([])
    expect(validaElenco(base({ validoDal: '2026-01-01', validoAl: '2026-12-31' }))).toEqual([])
  })

  it('descrizione vuota o troppo lunga', () => {
    expect(validaElenco(base({ descrizione: '' }))).toEqual([
      'Inserisci una descrizione per questo elenco.',
    ])
    expect(validaElenco(base({ descrizione: 'x'.repeat(46) }))).toEqual([
      'La descrizione non può superare 45 caratteri.',
    ])
  })

  it('note oltre 45 caratteri', () => {
    expect(validaElenco(base({ nota1: 'x'.repeat(46), nota2: 'y'.repeat(46) }))).toEqual([
      'La nota 1 non può superare 45 caratteri.',
      'La nota 2 non può superare 45 caratteri.',
    ])
  })

  it('codice con spazio, vuoto o lungo', () => {
    const msg = 'Il codice ha da 1 a 3 caratteri alfanumerici.'
    expect(validaElenco({ ...base(), codice: 'A B' })).toEqual([msg])
    expect(validaElenco({ ...base(), codice: '' })).toEqual([msg])
    expect(validaElenco({ ...base(), codice: 'ABCD' })).toEqual([msg])
  })

  it('una sola data', () => {
    const msg =
      "Indica sia la data di inizio sia quella di fine dell'elenco, oppure nessuna delle due."
    expect(validaElenco(base({ validoDal: '2026-01-01' }))).toEqual([msg])
    expect(validaElenco(base({ validoAl: '2026-01-01' }))).toEqual([msg])
  })

  it("fine prima dell'inizio; uguale ammessa", () => {
    expect(validaElenco(base({ validoDal: '2026-02-01', validoAl: '2026-01-31' }))).toEqual([
      'La data di fine non può precedere la data di inizio.',
    ])
    expect(validaElenco(base({ validoDal: '2026-02-01', validoAl: '2026-02-01' }))).toEqual([])
  })

  it('data inesistente', () => {
    expect(validaElenco(base({ validoDal: '2026-02-30', validoAl: '2026-03-01' }))).toEqual([
      'La data di inizio non è valida.',
    ])
    expect(validaElenco(base({ validoDal: '2026-02-01', validoAl: 'ieri' }))).toEqual([
      'La data di fine non è valida.',
    ])
  })

  it('CIG di 9 caratteri, CUP di 14', () => {
    expect(validaElenco(base({ codiceCig: 'ABCDEFGH1', idDocumentoPa: 'D1' }))).toEqual([
      'Il CIG deve avere 10 caratteri alfanumerici.',
    ])
    expect(validaElenco(base({ codiceCup: 'ABCDEFGHIJKLMN', idDocumentoPa: 'D1' }))).toEqual([
      'Il CUP deve avere 15 caratteri alfanumerici.',
    ])
  })

  it('documento PA troppo lungo, o assente con CIG/CUP', () => {
    expect(validaElenco(base({ idDocumentoPa: 'x'.repeat(21) }))).toEqual([
      'Il documento della PA non può superare 20 caratteri.',
    ])
    expect(validaElenco(base({ codiceCig: 'ABCDEFGH12' }))).toEqual([
      'Con CIG o CUP indica anche il riferimento del documento della PA (contratto, convenzione o ordine).',
    ])
  })

  it('dataDocumentoPa senza documento', () => {
    expect(validaElenco(base({ dataDocumentoPa: '2026-01-01' }))).toEqual([
      'La data del documento della PA si indica solo con il documento.',
    ])
    expect(validaElenco(base({ idDocumentoPa: 'D1', dataDocumentoPa: '2026-01-01' }))).toEqual([])
    expect(validaElenco(base({ idDocumentoPa: 'D1', dataDocumentoPa: '2026-13-01' }))).toEqual([
      'La data del documento della PA non è valida.',
    ])
  })

  it('i testi di CIG, CUP e documento PA sono quelli di validaContrattoCliente (R33)', () => {
    const casi: Record<string, unknown>[] = [
      { codiceCig: 'ABC', codiceCup: 'XYZ', idDocumentoPa: 'x'.repeat(21) },
      { codiceCig: 'ABCDEFGH12' },
      { codiceCup: 'ABCDEFGHIJKLMNO' },
      { codiceCig: 'ABC', codiceCup: 'XYZ', idDocumentoPa: 'D1' },
    ]
    const pa = (m: string[]) => m.filter(x => /CIG|CUP|documento della PA/.test(x))
    for (const c of casi) {
      const contratto = pa(validaContrattoCliente(normalizzaContratto(c)))
      const elenco = pa(validaElenco(base(c)))
      expect(elenco).toEqual(contratto)
      expect(elenco.length).toBeGreaterThan(0)
    }
  })
})

describe('prossimoCodiceElenco', () => {
  it('primo numero libero, 001-999', () => {
    expect(prossimoCodiceElenco([])).toBe('001')
    expect(prossimoCodiceElenco(['001', '002', 'A1'])).toBe('003')
    expect(prossimoCodiceElenco(['002'])).toBe('001')
    expect(prossimoCodiceElenco(['1'])).toBe('002')
  })
  it('null se sono tutti occupati', () => {
    const tutti = Array.from({ length: 999 }, (_, i) => String(i + 1).padStart(3, '0'))
    expect(prossimoCodiceElenco(tutti)).toBeNull()
  })
})

describe('elenchiValidiAl', () => {
  const e = [
    { id: 'a', validoAl: null },
    { id: 'b', validoAl: '2026-05-10' },
    { id: 'c', validoAl: '2026-05-09' },
  ]
  it('fine vuota e fine = data inclusi, fine ieri escluso', () => {
    expect(elenchiValidiAl(e, '2026-05-10').map(x => x.id)).toEqual(['a', 'b'])
  })
})

describe('elencoProposto', () => {
  const el = (id: string, predefinito = false, validoAl: string | null = null) => ({
    id,
    predefinito,
    validoAl,
  })
  it('uno solo valido: quello', () => {
    expect(elencoProposto([el('a')], '2026-05-10')?.id).toBe('a')
    expect(elencoProposto([el('a', false, '2026-01-01'), el('b')], '2026-05-10')?.id).toBe('b')
  })
  it('due con un predefinito: il predefinito', () => {
    expect(elencoProposto([el('a'), el('b', true)], '2026-05-10')?.id).toBe('b')
  })
  it('due senza predefinito: null', () => {
    expect(elencoProposto([el('a'), el('b')], '2026-05-10')).toBeNull()
  })
  it('predefinito scaduto: null', () => {
    expect(
      elencoProposto([el('a', true, '2026-01-01'), el('b', false, '2026-02-01')], '2026-05-10')
    ).toBeNull()
  })
  it('predefinito scaduto con due elenchi validi senza predefinito: null', () => {
    expect(elencoProposto([el('a', true, '2026-01-01'), el('b'), el('c')], '2026-05-10')).toBeNull()
  })
  it('nessun elenco: null', () => {
    expect(elencoProposto([], '2026-05-10')).toBeNull()
  })
})
