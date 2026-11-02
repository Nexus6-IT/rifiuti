import { chiaveRiga } from './riga-addebito'

/**
 * Scelta delle righe da copiare in un elenco (4.2b, D18, R45): regole pure, senza database.
 * `sostituisci-da` e `aggiungi-righe` passano di qui, cosi' le esclusioni sono le stesse.
 *
 * Una copia salta, nell'ordine: i minimi (`M…`), gli acconti, le detrazioni e gli anticipi (`$…`),
 * le righe `N…` con conguaglio, progressivo da data o giorno (come `nocop` di WinWaste), i duplicati (stessa chiave di D11) e le
 * righe che nell'elenco di arrivo violerebbero le regole delle condizioni (D11): una cifra delle
 * condizioni riferite e' gia' sommata da un'altra riga (I1 della review 21), oppure manca un
 * addebito condizionato con quella cifra e la stessa unita' di misura. Ogni riga e' contata una
 * volta sola, nella prima causa che la esclude.
 */

export interface RigaCopiabile {
  tipo: string
  cerCode: string | null
  addebitoId: string | null
  riferimento: string | null
  unitaMisura: string
  condizione: number | null
  condizioniRiferite: string | null
  applicaA: string | null
}

/** R45: `EsitoCopia.escluse`. */
export interface EscluseCopia {
  minimi: number
  acconti: number
  conguagli: number
  duplicate: number
  condizioni: number
}

/** Le cifre delle condizioni sommate da una riga: `condizioniRiferite` senza l'ultimo carattere. */
export function cifreCondizioni(condizioniRiferite: string | null): number[] {
  if (condizioniRiferite === null || condizioniRiferite === '') return []
  return [...new Set(condizioniRiferite.slice(0, -1).split('').map(Number))]
}

/**
 * Come WinWaste (`nocop`, ELENCHIaddeb.cs:4338-4355, e `possibile`, :4309): si salta SOLO una riga
 * di tipo `N…` con `INTEND > "2"`, cioe' "progressivo da data" (C), "conguaglio 365" (D) e "giorno"
 * (E); C e D portano una data di riferimento propria del cliente. Le righe di altri tipi con un
 * conguaglio si copiano. Le regole 6 e 7 di `INTEND` non esistono in `applicaA`.
 */
function eConguaglio(r: RigaCopiabile): boolean {
  return (
    r.tipo.startsWith('N') &&
    (r.applicaA === 'PROGRESSIVO_DA_DATA' ||
      r.applicaA === 'CONGUAGLIO_365' ||
      r.applicaA === 'GIORNO')
  )
}

export function scegliRigheDaCopiare<T extends RigaCopiabile>(
  candidate: readonly T[],
  esistenti: readonly RigaCopiabile[]
): { scelte: T[]; escluse: EscluseCopia } {
  const escluse: EscluseCopia = { minimi: 0, acconti: 0, conguagli: 0, duplicate: 0, condizioni: 0 }
  const chiavi = new Set(esistenti.map(chiaveRiga))
  const ammesse: T[] = []

  for (const r of candidate) {
    if (r.tipo.startsWith('M')) escluse.minimi++
    else if (r.tipo.startsWith('$')) escluse.acconti++
    else if (eConguaglio(r)) escluse.conguagli++
    else if (chiavi.has(chiaveRiga(r))) escluse.duplicate++
    else {
      chiavi.add(chiaveRiga(r))
      ammesse.push(r)
    }
  }

  // Le righe senza condizioni riferite entrano subito: sono i possibili condizionati.
  const scelte: T[] = ammesse.filter(r => r.condizioniRiferite === null)
  let inSospeso = ammesse.filter(r => r.condizioniRiferite !== null)

  // Le altre entrano quando le loro cifre sono libere e hanno i condizionati; si ripete finche'
  // qualcuna entra, perche' una somma puo' essere condizionata di un'altra.
  let entrata = true
  while (entrata && inSospeso.length > 0) {
    entrata = false
    const resto: T[] = []
    for (const r of inSospeso) {
      const insieme: RigaCopiabile[] = [...esistenti, ...scelte]
      const sommate = new Set(insieme.flatMap(x => cifreCondizioni(x.condizioniRiferite)))
      const cifre = cifreCondizioni(r.condizioniRiferite)
      const libere = cifre.every(n => !sommate.has(n))
      const trovate = libere
        ? cifre.every(n => insieme.some(x => x.condizione === n && x.unitaMisura === r.unitaMisura))
        : false
      if (libere && trovate) {
        scelte.push(r)
        entrata = true
      } else {
        resto.push(r)
      }
    }
    inSospeso = resto
  }
  escluse.condizioni = inSospeso.length

  // L'ordine delle scelte e' quello di arrivo.
  const ordine = new Map(candidate.map((r, i) => [r, i]))
  scelte.sort((a, b) => (ordine.get(a) as number) - (ordine.get(b) as number))
  return { scelte, escluse }
}
