/**
 * Codifiche di addebito (4.2a, D4): gruppo, categoria, categorie statistiche e centro di ricavo
 * dell'archivio addebiti, in una sola tabella con il `genere` (E29).
 *
 * Differenza voluta dalle codifiche di contratto della 4.1 (R2): qui il codice e' solo numerico,
 * da 1 a 3 cifre, riempito a tre (`7` -> `007`), perche' 3.8 importa codici numerici. Se manca
 * (creazione in linea) lo assegna il servizio con `primoCodiceLibero`, gia' in
 * `domain/clienti/codifica-contratto.ts` (non si duplica).
 */

export type GenereCodificaAddebito =
  | 'GRUPPO'
  | 'CATEGORIA'
  | 'CATEGORIA_STATISTICA_1'
  | 'CATEGORIA_STATISTICA_2'
  | 'CENTRO_RICAVO'

export const ETICHETTE_GENERE_ADDEBITO: Readonly<Record<GenereCodificaAddebito, string>> = {
  GRUPPO: 'Gruppo',
  CATEGORIA: 'Categoria di addebito',
  CATEGORIA_STATISTICA_1: 'Categoria statistica 1',
  CATEGORIA_STATISTICA_2: 'Categoria statistica 2',
  CENTRO_RICAVO: 'Centro di ricavo',
}

const GENERI = Object.keys(ETICHETTE_GENERE_ADDEBITO) as GenereCodificaAddebito[]

const DESCRIZIONE_MAX = 45

export interface DatiCodificaAddebito {
  /** Vuoto se il genere ricevuto non e' uno dei cinque (lo rifiuta `validaCodificaAddebito`). */
  genere: GenereCodificaAddebito | ''
  codice: string | null
  descrizione: string
}

export function normalizzaCodificaAddebito(
  g: Partial<Record<keyof DatiCodificaAddebito, unknown>>
): DatiCodificaAddebito {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const codice = testo(g.codice)
  const genere = testo(g.genere).toUpperCase()
  return {
    genere: GENERI.find(x => x === genere) ?? '',
    // Un codice numerico si riempie a tre cifre; il resto passa invariato e lo rifiuta valida.
    codice: codice === '' ? null : /^\d{1,3}$/.test(codice) ? codice.padStart(3, '0') : codice,
    descrizione: testo(g.descrizione),
  }
}

export function validaCodificaAddebito(d: DatiCodificaAddebito): string[] {
  const errori: string[] = []

  if (!Object.prototype.hasOwnProperty.call(ETICHETTE_GENERE_ADDEBITO, d.genere)) {
    errori.push('Il genere della codifica non è ammesso.')
  }

  if (d.codice !== null) {
    if (!/^\d{3}$/.test(d.codice)) errori.push('Il codice ha da 1 a 3 cifre.')
    else if (d.codice === '000') errori.push('Il codice deve essere compreso tra 001 e 999.')
  }

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > DESCRIZIONE_MAX) {
    errori.push(`La descrizione può avere al massimo ${DESCRIZIONE_MAX} caratteri.`)
  }

  return errori
}
