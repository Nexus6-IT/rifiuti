import { ElementoLettura } from '../application/migrazione/staging/lettore-staging'
import { SorgenteRighe } from '../application/migrazione/staging/parser/scarti'
import { TABELLE_DOCUMENTATE } from '../application/migrazione/staging/colonne-documentate'

/**
 * Sorgente di righe in memoria per i test dei parser: costruisce righe con
 * TUTTE le colonne documentate della tabella (vuote di default), sovrascritte
 * dai valori indicati. Cosi' i test dichiarano solo cio' che conta per il caso.
 */
export function colonneDocumentate(tabella: string): string[] {
  const t = TABELLE_DOCUMENTATE.find(x => x.nome === tabella)
  if (!t) throw new Error(`tabella non documentata: ${tabella}`)
  return t.colonne.map(c => c.nome)
}

export function sorgenteInMemoria(
  tabella: string,
  righe: ReadonlyArray<Record<string, string | null>>,
  colonne: readonly string[] = colonneDocumentate(tabella)
): SorgenteRighe {
  const elementi: ElementoLettura[] = righe.map((valori, i) => {
    const campi: Record<string, string | null> = {}
    for (const c of colonne) campi[c] = c in valori ? valori[c] : ''
    return { tipo: 'riga', riga: { numeroRiga: i + 1, campi } }
  })
  return {
    colonne,
    righe: (async function* () {
      for (const e of elementi) yield e
    })(),
  }
}

export function sorgenteConElementi(
  colonne: readonly string[],
  elementi: ElementoLettura[]
): SorgenteRighe {
  return {
    colonne,
    righe: (async function* () {
      for (const e of elementi) yield e
    })(),
  }
}
