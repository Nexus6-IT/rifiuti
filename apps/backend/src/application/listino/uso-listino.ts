// Quanti addebiti citano le righe di una tabella del listino (R8): stessa forma batch di
// `contaUsi` della 4.1 (un `groupBy` per colonna referente, una chiamata per `list`/`getById`),
// ma con le sorgenti del listino: gli `addebiti` dell'archivio e le `righe_addebito` degli elenchi
// dei contratti (R44).
import { Prisma, PrismaClient } from '@prisma/client'

export type ListinoUsi = PrismaClient | Prisma.TransactionClient

/** Colonne che citano la tabella, per ciascuna sorgente. */
export interface ColonneReferentiListino {
  addebiti: readonly string[]
  /** Colonne delle righe degli elenchi di addebito (`righe_addebito`). */
  righe: readonly string[]
  /**
   * Colonne delle righe dei legami dei movimenti (`righe_legame_movimento`, 4.3) che citano la
   * tabella: riga di listino, elenco e codice IVA congelati alla conferma. Decisione 8: cio' che un
   * legame cita non si elimina, si disattiva o se ne chiude la validita'.
   */
  righeLegame: readonly string[]
  /** Colonne delle testate dei legami (`legami_movimento`, 4.3): citano elenco, cliente, ecc. */
  legami: readonly string[]
  /**
   * Colonne delle righe dei documenti di fattura (`righe_documento_fattura`, 4.4a) che citano la
   * tabella: riga di listino e codice IVA emessi. Un documento emesso e' un dato fiscale: cio' che
   * cita non si elimina.
   */
  righeDocumento: readonly string[]
  /** Colonne dei marcatori degli addebiti gia' fatturati (`marcatori_addebiti_fatturati`, 4.4a). */
  marcatori: readonly string[]
}

export const COLONNE_CODICE_IVA: ColonneReferentiListino = {
  addebiti: ['codiceIvaId'],
  righe: ['codiceIvaId'],
  righeLegame: ['codiceIvaId'],
  legami: [],
  righeDocumento: ['codiceIvaId'],
  marcatori: [],
}

export const COLONNE_CODIFICA_ADDEBITO: ColonneReferentiListino = {
  addebiti: [
    'gruppoId',
    'categoriaId',
    'centroRicavoId',
    'categoriaStatistica1Id',
    'categoriaStatistica2Id',
  ],
  // Le righe citano solo la categoria e il centro di ricavo (non gruppo e statistiche).
  righe: ['categoriaId', 'centroRicavoId'],
  righeLegame: [],
  legami: [],
  righeDocumento: [],
  marcatori: [],
}

/** Un addebito dell'archivio e' citato solo dalle righe degli elenchi, con `addebitoId`. */
export const COLONNE_ADDEBITO: ColonneReferentiListino = {
  addebiti: [],
  righe: ['addebitoId'],
  righeLegame: [],
  legami: [],
  righeDocumento: [],
  marcatori: [],
}

/**
 * Una riga di listino e' citata dalle righe dei legami, dalle righe dei documenti di fattura e dai
 * marcatori degli addebiti gia' fatturati (tutte con `riga_addebito_id`).
 */
export const COLONNE_RIGA_LISTINO: ColonneReferentiListino = {
  addebiti: [],
  righe: [],
  righeLegame: ['rigaAddebitoId'],
  legami: [],
  righeDocumento: ['rigaAddebitoId'],
  marcatori: ['rigaAddebitoId'],
}

/**
 * Un elenco e' "usato" quando lo cita la testata di un legame (`legami_movimento.elenco_id`,
 * indicizzata): comprende anche i legami senza righe, e quelli con righe perche' la FK composta
 * obbliga ogni riga ad avere l'elenco della sua testata.
 */
export const COLONNE_ELENCO: ColonneReferentiListino = {
  addebiti: [],
  righe: [],
  righeLegame: [],
  legami: ['elencoId'],
  righeDocumento: [],
  marcatori: [],
}

type RigaConteggio = Record<string, unknown> & { _count: { _all: number } }
type GroupBy = (args: {
  by: string[]
  where: Record<string, unknown>
  _count: { _all: true }
}) => Promise<RigaConteggio[]>

/**
 * Una `groupBy` con `IN` per colonna referente, su UNA tabella e senza join: lineare anche con
 * migliaia di id (il vincolo `JOIN unnest` + `joinLineari` serve contro i nested loop dei join e qui
 * non ce ne sono).
 *
 * Numero di citazioni per id (0 se nessuna). `ids` vuoto: nessuna query. Va chiamata nel contesto
 * dell'azienda (RLS) o dentro la transazione che poi scrive.
 */
export async function contaUsiListino(
  client: ListinoUsi,
  tenantId: string,
  ids: readonly string[],
  colonne: ColonneReferentiListino
): Promise<Map<string, number>> {
  const usi = new Map<string, number>(ids.map(id => [id, 0]))
  if (ids.length === 0) return usi
  const sorgenti: Array<[{ groupBy: GroupBy }, readonly string[]]> = [
    [client.addebito as unknown as { groupBy: GroupBy }, colonne.addebiti],
    [client.rigaAddebito as unknown as { groupBy: GroupBy }, colonne.righe],
    [client.rigaLegameMovimento as unknown as { groupBy: GroupBy }, colonne.righeLegame],
    [client.legameMovimento as unknown as { groupBy: GroupBy }, colonne.legami],
    [client.rigaDocumentoFattura as unknown as { groupBy: GroupBy }, colonne.righeDocumento],
    [client.marcatoreAddebitoFatturato as unknown as { groupBy: GroupBy }, colonne.marcatori],
  ]
  for (const [modello, elenco] of sorgenti) {
    for (const colonna of elenco) {
      const righe = await modello.groupBy({
        by: [colonna],
        where: { tenantId, [colonna]: { in: [...ids] } },
        _count: { _all: true },
      })
      for (const r of righe) {
        const id = r[colonna]
        if (typeof id === 'string') usi.set(id, (usi.get(id) ?? 0) + r._count._all)
      }
    }
  }
  return usi
}
