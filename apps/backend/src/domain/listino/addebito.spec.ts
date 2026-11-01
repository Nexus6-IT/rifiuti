import {
  DatiAddebito,
  PrezzoListino,
  normalizzaAddebito,
  normalizzaCodiceAddebito,
  prezzoProposto,
  prossimoCodiceAddebito,
  provvigioneProposta,
  validaAddebito,
} from './addebito'

const vuoti = (): PrezzoListino[] =>
  ([1, 2, 3, 4, 5, 6] as const).map(numero => ({
    numero,
    prezzo: null,
    sconto: null,
    provvigione: null,
  }))

const conPrezzi = (p: Record<number, string>): PrezzoListino[] =>
  vuoti().map(l => ({ ...l, prezzo: p[l.numero] ?? null }))

const base = (): DatiAddebito =>
  normalizzaAddebito({
    codice: '12',
    descrizione: 'Trasporto',
    gruppoId: 'g1',
    unitaMisura: 'kg',
    tipo: 'V',
  })

describe('normalizzaCodiceAddebito', () => {
  it('riempie a cinque cifre', () => {
    expect(normalizzaCodiceAddebito('12')).toBe('00012')
    expect(normalizzaCodiceAddebito(7)).toBe('00007')
  })
  it('vuoto -> null; non numerico invariato', () => {
    expect(normalizzaCodiceAddebito('  ')).toBeNull()
    expect(normalizzaCodiceAddebito(undefined)).toBeNull()
    expect(normalizzaCodiceAddebito('12a')).toBe('12a')
  })
})

describe('normalizzaAddebito', () => {
  it('produce sempre sei listini e porta virgola a punto', () => {
    const d = normalizzaAddebito({
      ...base(),
      listini: [{ numero: 3, prezzo: '1,5', sconto: ' 10 + 5,5', provvigione: '' }],
    })
    expect(d.listini).toHaveLength(6)
    expect(d.listini[2]).toEqual({ numero: 3, prezzo: '1.5', sconto: '10+5.5', provvigione: null })
    expect(d.listini[0]).toEqual({ numero: 1, prezzo: null, sconto: null, provvigione: null })
    expect(d.unitaMisura).toBe('KG')
    expect(d.codice).toBe('00012')
    expect(d.tipo).toBe('V')
    expect(d.tipoProvvigione).toBe('SCONTATO')
    expect(d.attivo).toBe(true)
  })
})

describe('validaAddebito', () => {
  it('valido', () => {
    expect(validaAddebito(base())).toEqual([])
  })
  it('codice 00000 riservato, 123456 rifiutato', () => {
    expect(validaAddebito({ ...base(), codice: '00000' })).toContain('Il codice 00000 è riservato.')
    expect(validaAddebito({ ...base(), codice: '123456' })).toHaveLength(1)
    expect(validaAddebito({ ...base(), codice: '' })).toEqual([])
  })
  it('descrizione e gruppo obbligatori', () => {
    const e = validaAddebito({ ...base(), descrizione: '', gruppoId: null })
    expect(e).toContain("Inserisci la descrizione dell'addebito.")
    expect(e).toContain("Indica il gruppo dell'addebito.")
  })
  it('tipo T: UM KG/TON si, LT no', () => {
    expect(validaAddebito({ ...base(), tipo: 'T123', unitaMisura: 'KG' })).toEqual([])
    expect(validaAddebito({ ...base(), tipo: 'TS', unitaMisura: 'TON' })).toEqual([])
    expect(validaAddebito({ ...base(), tipo: 'TS', unitaMisura: 'LT' })).toContain(
      "Per gli addebiti di tipo T l'unità di misura è KG o TON."
    )
  })
  it('CER non è un tipo d’archivio', () => {
    expect(validaAddebito({ ...base(), tipo: 'CER' }).length).toBeGreaterThan(0)
    expect(validaAddebito({ ...base(), tipo: 'XX' }).length).toBeGreaterThan(0)
  })
  it('unità di misura non valida o vuota', () => {
    expect(validaAddebito({ ...base(), unitaMisura: '' }).length).toBeGreaterThan(0)
    expect(validaAddebito({ ...base(), unitaMisura: 'ABCD' }).length).toBeGreaterThan(0)
  })
  it('cascata non valida con il numero del listino', () => {
    const d = normalizzaAddebito({
      ...base(),
      listini: [{ numero: 3, prezzo: '1', sconto: '10+5+3+1', provvigione: null }],
    })
    expect(validaAddebito(d)).toEqual([expect.stringMatching(/^Listino 3: /)])
  })
  it('provvigione non valida e prezzo non valido', () => {
    const d = normalizzaAddebito({
      ...base(),
      listini: [
        { numero: 2, prezzo: 'abc', sconto: null, provvigione: '1,2,3' },
        { numero: 5, prezzo: '-1', sconto: null, provvigione: null },
      ],
    })
    const e = validaAddebito(d)
    expect(e.filter(m => m.startsWith('Listino 2: '))).toHaveLength(2)
    expect(e.filter(m => m.startsWith('Listino 5: '))).toHaveLength(1)
  })
  it('sette decimali di prezzo rifiutati, sei accettati', () => {
    const ok = normalizzaAddebito({
      ...base(),
      listini: [{ numero: 1, prezzo: '0.012345', sconto: null, provvigione: null }],
    })
    const ko = normalizzaAddebito({
      ...base(),
      listini: [{ numero: 1, prezzo: '0.0123456', sconto: null, provvigione: null }],
    })
    expect(validaAddebito(ok)).toEqual([])
    expect(validaAddebito(ko)).toHaveLength(1)
  })
  it('rifiuta listini diversi da sei o numeri duplicati', () => {
    expect(validaAddebito({ ...base(), listini: vuoti().slice(0, 5) }).length).toBeGreaterThan(0)
  })
})

describe('prezzoProposto (E7, R6)', () => {
  it('listino del cliente se pieno', () => {
    const l = conPrezzi({ 1: '1', 4: '4' })
    expect(prezzoProposto(l, 4)?.numero).toBe(4)
  })
  it('listino del cliente senza prezzo -> null, nessun ripiego sul 1', () => {
    expect(prezzoProposto(conPrezzi({ 1: '1' }), 4)).toBeNull()
  })
  it('senza listino e solo il 1 pieno -> 1', () => {
    expect(prezzoProposto(conPrezzi({ 1: '1' }), null)?.numero).toBe(1)
  })
  it('senza listino e il 2 pieno -> null', () => {
    expect(prezzoProposto(conPrezzi({ 1: '1', 2: '2' }), null)).toBeNull()
    expect(prezzoProposto(conPrezzi({ 2: '2' }), null)).toBeNull()
  })
  it('listino 1 vuoto -> null', () => {
    expect(prezzoProposto(vuoti(), null)).toBeNull()
  })
})

describe('provvigioneProposta (E7, R6)', () => {
  const daListino = { provvigione: '5', tipo: 'LORDO' as const }
  it('vince quella del cliente con il suo tipo', () => {
    expect(provvigioneProposta(daListino, { provvigione: '3', tipo: 'SCONTATO' })).toEqual({
      provvigione: '3',
      tipo: 'SCONTATO',
    })
  })
  it('cliente con tipo assente usa il tipo del listino', () => {
    expect(provvigioneProposta(daListino, { provvigione: '3', tipo: null })).toEqual({
      provvigione: '3',
      tipo: 'LORDO',
    })
  })
  it.each(['0', '0+0', '0.00', '', null])('cliente %p non sostituisce', v => {
    expect(provvigioneProposta(daListino, { provvigione: v, tipo: 'SCONTATO' })).toEqual({
      provvigione: '5',
      tipo: 'LORDO',
    })
  })
  it('listino senza provvigione e cliente senza -> null', () => {
    expect(
      provvigioneProposta(
        { provvigione: null, tipo: 'SCONTATO' },
        { provvigione: null, tipo: null }
      )
    ).toEqual({ provvigione: null, tipo: 'SCONTATO' })
  })
})

describe('prossimoCodiceAddebito (R7)', () => {
  it('primo libero da 00001', () => {
    expect(prossimoCodiceAddebito([])).toBe('00001')
    expect(prossimoCodiceAddebito(['00001', '00002', '00004'])).toBe('00003')
  })
  it('00000 mai assegnato', () => {
    expect(prossimoCodiceAddebito(['00000'])).toBe('00001')
  })
  it('esaurito -> null', () => {
    const tutti = Array.from({ length: 99999 }, (_, i) => String(i + 1).padStart(5, '0'))
    expect(prossimoCodiceAddebito(tutti)).toBeNull()
    expect(prossimoCodiceAddebito(tutti.slice(0, -1))).toBe('99999')
  })
})
