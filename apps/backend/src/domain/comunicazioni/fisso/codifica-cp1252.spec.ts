import {
  cercaCampiNonRappresentabili,
  codificaCp1252,
  nonRappresentabili,
  rappresentabile,
} from './codifica-cp1252'

describe('codifica Windows-1252', () => {
  it('ASCII e Latin-1 (0xA0-0xFF) restano un byte uguale al code point', () => {
    expect([...codificaCp1252('Aa09 ~')]).toEqual([0x41, 0x61, 0x30, 0x39, 0x20, 0x7e])
    expect([...codificaCp1252('àèéìòù°')]).toEqual([0xe0, 0xe8, 0xe9, 0xec, 0xf2, 0xf9, 0xb0])
  })

  it('€ è 0x80 e ’ è 0x92: con latin1 non sarebbero rappresentabili (diverso da Latin-1)', () => {
    expect([...codificaCp1252('€')]).toEqual([0x80])
    expect([...codificaCp1252('’')]).toEqual([0x92])
    // latin1 scarterebbe il byte alto: la prova che non usiamo latin1
    expect([...Buffer.from('€’', 'latin1')]).not.toEqual([0x80, 0x92])
  })

  it('mappa tutti i 27 caratteri assegnati di 0x80-0x9F', () => {
    const alti = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
    expect(Array.from(alti)).toHaveLength(27)
    const byte = [...codificaCp1252(alti)]
    expect(byte).toEqual([
      0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92,
      0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
    ])
  })

  it('i controlli C1 (0x80-0x9F come code point) e i non assegnati non sono rappresentabili', () => {
    for (const cp of [0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x85]) {
      expect(rappresentabile(String.fromCodePoint(cp))).toBe(false)
    }
  })

  it('nonRappresentabili elenca i caratteri distinti nell’ordine di comparsa', () => {
    expect(nonRappresentabili('a→b→c✓')).toEqual(['→', '✓'])
    expect(nonRappresentabili('città €')).toEqual([])
    expect(nonRappresentabili('😀')).toEqual(['😀'])
  })

  it('codifica lancia su un carattere non rappresentabile', () => {
    expect(() => codificaCp1252('a→')).toThrow(/U\+2192/)
    expect(() => codificaCp1252('😀')).toThrow(/U\+1F600/)
  })

  it('stringa vuota → buffer vuoto', () => {
    expect(codificaCp1252('')).toHaveLength(0)
  })

  it('cercaCampiNonRappresentabili: percorso del campo e movimento piu’ vicino', () => {
    const dati = {
      deposito: 'ok €',
      testa: { ragione: 'A → B' },
      righe: [
        { movimentoId: 'm1', prodotto: 'va bene', note: 'x😀' },
        { movimentoIds: ['m2', 'm3'], dettaglio: { nome: '∑' } },
        { prodotto: 'fine' },
      ],
    }
    expect(cercaCampiNonRappresentabili(dati)).toEqual([
      { campo: 'testa.ragione', caratteri: ['→'], movimentoIds: [] },
      { campo: 'righe[0].note', caratteri: ['😀'], movimentoIds: ['m1'] },
      { campo: 'righe[1].dettaglio.nome', caratteri: ['∑'], movimentoIds: ['m2', 'm3'] },
    ])
    expect(cercaCampiNonRappresentabili({ a: 'è € ñ', n: 3, v: null })).toEqual([])
  })
})
