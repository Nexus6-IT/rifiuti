import { ElementoLettura, RigaGrezza, StagingAperto } from '../lettore-staging'
import { StagingError } from '../manifest'

/**
 * Infrastruttura comune dei parser per tabella.
 *
 * Un parser legge una tabella dallo staging, decodifica ogni riga e produce:
 *  - `record`: i record decodificati;
 *  - `scarti`: le righe NON importabili (un solo scarto per riga, il primo
 *    trovato), con tabella, `COD` (o chiave naturale), numero di riga, codice
 *    stabile e un dettaglio che nomina colonne e regole, MAI i valori;
 *  - `avvisi`: anomalie non fatali di righe che restano nei record.
 *
 * Regola D8: nessuna correzione silenziosa. Gli scarti non sono un errore di
 * esecuzione: finiscono nel rapporto.
 */
export interface Anomalia {
  readonly codice: string
  readonly dettaglio: string
}

export interface Segnalazione extends Anomalia {
  readonly tabella: string
  /** `COD` o chiave naturale della riga; stringa vuota se non leggibile. */
  readonly cod: string
  readonly riga: number
}

export interface EsitoParser<R> {
  readonly tabella: string
  /** Righe fisiche non vuote lette, scarti di lettura compresi. */
  readonly righeLette: number
  readonly record: R[]
  readonly scarti: Segnalazione[]
  readonly avvisi: Segnalazione[]
}

export interface SorgenteRighe {
  readonly colonne: readonly string[]
  readonly righe: AsyncIterable<ElementoLettura>
}

export function sorgenteDa(staging: StagingAperto, tabella: string): SorgenteRighe {
  return { colonne: staging.colonne(tabella), righe: staging.leggi(tabella) }
}

export interface ContestoParser {
  /** Ditta WinWaste (4 cifre) dal manifest. */
  readonly ditta: string
  /** Anno del database dal manifest. */
  readonly anno: number
}

/** Risultato della decodifica di una riga. */
export interface EsitoRiga<R> {
  readonly cod: string
  readonly record?: R
  readonly scarto?: Anomalia
  readonly avvisi: readonly Anomalia[]
}

/** Lancia se il manifest non dichiara una colonna indispensabile al parser. */
export function richiediColonne(
  tabella: string,
  colonne: readonly string[],
  richieste: readonly string[]
): void {
  const mancanti = richieste.filter(c => !colonne.includes(c))
  if (mancanti.length > 0) {
    throw new StagingError(
      'COLONNA_OBBLIGATORIA_ASSENTE',
      `${tabella}: mancano ${mancanti.join(', ')}`
    )
  }
}

/** Campi non mappati con un valore significativo: non vuoti e non zero. */
export function raccogliGrezzo(
  campi: Readonly<Record<string, string | null>>,
  mappate: ReadonlySet<string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(campi)) {
    if (mappate.has(k) || v === null || v === '') continue
    if (/^-?0+(\.0+)?$/.test(v.trim())) continue
    out[k] = v
  }
  return out
}

function confronta(a: Segnalazione, b: Segnalazione): number {
  return a.riga - b.riga || (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0)
}

export async function parsaTabella<R>(
  tabella: string,
  sorgente: SorgenteRighe,
  richieste: readonly string[],
  decodifica: (riga: RigaGrezza) => EsitoRiga<R>
): Promise<EsitoParser<R>> {
  richiediColonne(tabella, sorgente.colonne, richieste)
  const record: R[] = []
  const scarti: Segnalazione[] = []
  const avvisi: Segnalazione[] = []
  let righeLette = 0
  for await (const el of sorgente.righe) {
    righeLette++
    if (el.tipo === 'scarto') {
      scarti.push({
        tabella,
        cod: '',
        riga: el.scarto.numeroRiga,
        codice: el.scarto.codice,
        dettaglio: 'riga dello staging illeggibile',
      })
      continue
    }
    const esito = decodifica(el.riga)
    for (const a of esito.avvisi) {
      avvisi.push({ ...a, tabella, cod: esito.cod, riga: el.riga.numeroRiga })
    }
    if (esito.scarto) {
      scarti.push({ ...esito.scarto, tabella, cod: esito.cod, riga: el.riga.numeroRiga })
    } else if (esito.record !== undefined) {
      record.push(esito.record)
    }
  }
  scarti.sort(confronta)
  avvisi.sort(confronta)
  return { tabella, righeLette, record, scarti, avvisi }
}
