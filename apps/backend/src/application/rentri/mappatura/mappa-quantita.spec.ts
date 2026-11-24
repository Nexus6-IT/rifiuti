import { traduciQuantita, normalizzaCaratteristichePericolo } from './mappa-quantita'
import { ValoreNonTraducibilePerRentriError } from './mappa-rifiuto'

describe('traduciQuantita (conversioni verso kg e litri del contratto)', () => {
  const casi: Array<[number, string, { valore: number; unita_misura: 'kg' | 'l' }]> = [
    [120, 'kg', { valore: 120, unita_misura: 'kg' }],
    [120.5, 'KG', { valore: 120.5, unita_misura: 'kg' }],
    [2, 't', { valore: 2000, unita_misura: 'kg' }],
    [0.0125, 't', { valore: 12.5, unita_misura: 'kg' }],
    [1.15, 't', { valore: 1150, unita_misura: 'kg' }],
    [3, 'tonnellate', { valore: 3000, unita_misura: 'kg' }],
    [500, 'litri', { valore: 500, unita_misura: 'l' }],
    [500, 'l', { valore: 500, unita_misura: 'l' }],
    [2.5, 'm3', { valore: 2500, unita_misura: 'l' }],
    [2.5, 'm³', { valore: 2500, unita_misura: 'l' }],
    [0.001, 'mc', { valore: 1, unita_misura: 'l' }],
  ]

  it.each(casi)('%s %s', (valore, unita, atteso) => {
    expect(traduciQuantita(valore, unita)).toEqual(atteso)
  })

  it("arrotonda a 4 decimali in modo esplicito (meta' verso l'alto)", () => {
    expect(traduciQuantita(1.23456, 'kg').valore).toBe(1.2346)
    expect(traduciQuantita(1.23454, 'kg').valore).toBe(1.2345)
    expect(traduciQuantita(0.00005, 'kg').valore).toBe(0.0001)
  })

  it('non lascia residui binari dopo la moltiplicazione', () => {
    // 0.1 + 0.2 = 0.30000000000000004: kg -> nessun residuo oltre il quarto decimale.
    expect(traduciQuantita(0.1 + 0.2, 'kg').valore).toBe(0.3)
    expect(traduciQuantita(4.35, 't').valore).toBe(4350)
  })

  it("rifiuta quantita' non positive, non finite o che diventano zero dopo l'arrotondamento", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.00001]) {
      expect(() => traduciQuantita(v, 'kg')).toThrow(ValoreNonTraducibilePerRentriError)
    }
  })

  it("rifiuta le quantita' oltre il massimo del contratto (9999999999.9999)", () => {
    expect(traduciQuantita(9999999999.9999, 'kg').valore).toBe(9999999999.9999)
    expect(() => traduciQuantita(10000000000, 'kg')).toThrow(ValoreNonTraducibilePerRentriError)
    // 10 milioni di tonnellate = 1e10 kg: fuori limite dopo la conversione
    expect(() => traduciQuantita(10000000, 't')).toThrow(ValoreNonTraducibilePerRentriError)
  })

  it("rifiuta un'unita' sconosciuta invece di indovinarla", () => {
    expect(() => traduciQuantita(1, 'barili')).toThrow(/unita_misura/)
  })
})

describe('normalizzaCaratteristichePericolo', () => {
  it("porta HP4,HP14 al formato HPnn del contratto, senza duplicati e nell'ordine dato", () => {
    expect(normalizzaCaratteristichePericolo('HP4,HP14')).toEqual(['HP04', 'HP14'])
    expect(normalizzaCaratteristichePericolo(' hp 4 ; HP04 , hp15 ')).toEqual(['HP04', 'HP15'])
  })

  it("restituisce undefined se non c'e' nessuna classe", () => {
    expect(normalizzaCaratteristichePericolo(undefined)).toBeUndefined()
    expect(normalizzaCaratteristichePericolo('  ')).toBeUndefined()
    expect(normalizzaCaratteristichePericolo(null)).toBeUndefined()
  })

  it('rifiuta una classe fuori da HP01-HP15', () => {
    expect(() => normalizzaCaratteristichePericolo('HP4,HP16')).toThrow(
      ValoreNonTraducibilePerRentriError
    )
    expect(() => normalizzaCaratteristichePericolo('pericoloso')).toThrow(
      ValoreNonTraducibilePerRentriError
    )
    expect(() => normalizzaCaratteristichePericolo('HP0')).toThrow(
      ValoreNonTraducibilePerRentriError
    )
  })
})
