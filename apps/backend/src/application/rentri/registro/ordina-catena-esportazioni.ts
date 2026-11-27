/**
 * Ordine di catena delle esportazioni di un registro (eREGI E6): dalla «prima» (senza precedente)
 * seguendo `precedente_id`. Funzione pura. Una biforcazione, un anello isolato o piu' di una «prima»
 * sono errori di coerenza: il database li impedisce con gli unici, qui si controlla comunque.
 */
import { CatenaEsportazioniNonCoerenteError } from './errori-esportazioni-registro-rentri'

export interface AnelloCatena {
  id: string
  precedenteId: string | null
}

export function ordinaCatena<T extends AnelloCatena>(anelli: T[]): T[] {
  if (anelli.length === 0) return []
  const prime = anelli.filter(a => a.precedenteId === null)
  if (prime.length !== 1)
    throw new CatenaEsportazioniNonCoerenteError('manca la prima esportazione')
  const perPrecedente = new Map<string, T>()
  for (const a of anelli) {
    if (a.precedenteId === null) continue
    if (perPrecedente.has(a.precedenteId)) {
      throw new CatenaEsportazioniNonCoerenteError('una esportazione ha più di una successiva')
    }
    perPrecedente.set(a.precedenteId, a)
  }
  const ordinata: T[] = [prime[0]]
  for (;;) {
    const successiva = perPrecedente.get(ordinata[ordinata.length - 1].id)
    if (!successiva) break
    ordinata.push(successiva)
  }
  if (ordinata.length !== anelli.length) {
    throw new CatenaEsportazioniNonCoerenteError('ci sono esportazioni fuori dalla catena')
  }
  return ordinata
}
