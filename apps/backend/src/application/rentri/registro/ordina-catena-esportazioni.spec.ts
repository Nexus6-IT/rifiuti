import { CatenaEsportazioniNonCoerenteError } from './errori-esportazioni-registro-rentri'
import { ordinaCatena } from './ordina-catena-esportazioni'

const a = (id: string, precedenteId: string | null) => ({ id, precedenteId })

describe('ordinaCatena', () => {
  it('vuota resta vuota', () => {
    expect(ordinaCatena([])).toEqual([])
  })

  it('ordina dalla prima, qualunque sia l ordine di ingresso', () => {
    const risultato = ordinaCatena([a('c', 'b'), a('a', null), a('b', 'a')])
    expect(risultato.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('piu prime, biforcazioni o anelli isolati sono incoerenze', () => {
    expect(() => ordinaCatena([a('a', null), a('b', null)])).toThrow(
      CatenaEsportazioniNonCoerenteError
    )
    expect(() => ordinaCatena([a('a', null), a('b', 'a'), a('c', 'a')])).toThrow(
      CatenaEsportazioniNonCoerenteError
    )
    expect(() => ordinaCatena([a('a', null), a('b', 'x')])).toThrow(
      CatenaEsportazioniNonCoerenteError
    )
    expect(() => ordinaCatena([a('b', 'a')])).toThrow(CatenaEsportazioniNonCoerenteError)
  })
})
