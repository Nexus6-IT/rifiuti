import { hashCanonico } from './hash-rapporto'
import { scegliCampione } from './campione'
import { motivoValido, valutaChiusura } from './chiusura'

describe('campione a mano', () => {
  const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`)
  it('lo stesso seme da lo stesso campione, in qualunque ordine arrivino i candidati', () => {
    const a = scegliCampione('seme-1', ids, 5)
    const b = scegliCampione('seme-1', [...ids].reverse(), 5)
    expect(a).toEqual(b)
    expect(a).toHaveLength(5)
  })
  it('un altro seme cambia la scelta', () => {
    expect(scegliCampione('seme-1', ids, 5)).not.toEqual(scegliCampione('seme-2', ids, 5))
  })
  it('chiede piu di quanti ce ne siano: li prende tutti, senza doppioni', () => {
    expect(scegliCampione('s', ['a', 'a', 'b'], 10).sort()).toEqual(['a', 'b'])
    expect(scegliCampione('s', [], 3)).toEqual([])
  })
  it('una dimensione non valida e rifiutata', () => {
    expect(() => scegliCampione('s', ids, -1)).toThrow(RangeError)
  })
})

describe('impronta del rapporto', () => {
  it('non dipende dall ordine delle chiavi', () => {
    expect(hashCanonico({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      hashCanonico({ b: { d: [1, 2], c: 2 }, a: 1 })
    )
  })
  it('cambia se cambia un valore o l ordine di un array', () => {
    expect(hashCanonico({ a: [1, 2] })).not.toBe(hashCanonico({ a: [2, 1] }))
    expect(hashCanonico({ a: 1 })).not.toBe(hashCanonico({ a: 2 }))
  })
})

describe('chiusura', () => {
  const esiti = {
    confronti: [
      {
        numero: 1 as const,
        titolo: 't',
        esito: 'DIFFERENZE' as const,
        voci: [
          {
            chiave: 'x',
            descrizione: 'd',
            sorgente: 1,
            destinazione: 2,
            esito: 'DIFFERENZA' as const,
          },
          { chiave: 'y', descrizione: 'd', sorgente: 1, destinazione: 1, esito: 'OK' as const },
        ],
      },
    ],
    accettazioni: {},
  }
  const campioniOk = { totale: 2, senzaEsito: 0, nonCorrispondono: 0 }
  it('con una differenza aperta non si chiude', () => {
    const v = valutaChiusura(esiti, campioniOk)
    expect(v.chiudibile).toBe(false)
    expect(v.differenzeAperte).toEqual(['1:x'])
  })
  it('accettata una per una si chiude', () => {
    const v = valutaChiusura(
      { ...esiti, accettazioni: { '1:x': { motivo: 'FIR digitali', da: 'u', il: 'now' } } },
      campioniOk
    )
    expect(v.chiudibile).toBe(true)
  })
  it('un campione senza esito o non corrispondente blocca, anche con differenze accettate', () => {
    const acc = { '1:x': { motivo: 'FIR digitali', da: 'u', il: 'now' } }
    expect(
      valutaChiusura(
        { ...esiti, accettazioni: acc },
        { totale: 2, senzaEsito: 1, nonCorrispondono: 0 }
      ).chiudibile
    ).toBe(false)
    expect(
      valutaChiusura(
        { ...esiti, accettazioni: acc },
        { totale: 2, senzaEsito: 0, nonCorrispondono: 1 }
      ).chiudibile
    ).toBe(false)
  })
  it('il motivo deve essere un testo di lunghezza ragionevole', () => {
    expect(motivoValido('  FIR digitali  ')).toBe('FIR digitali')
    expect(motivoValido('ok')).toBeNull()
    expect(motivoValido('x'.repeat(501))).toBeNull()
    expect(motivoValido(7)).toBeNull()
  })
})
