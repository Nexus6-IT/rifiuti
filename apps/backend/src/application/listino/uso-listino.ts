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
  /**
   * Colonne delle testate dei documenti di fattura (`documenti_fattura`, 4.4b1, M4) che citano la
   * tabella: oggi solo l'elenco (`elencoId`), che una bozza o un definitivo congela.
   */
  documenti: readonly string[]
}

export const COLONNE_CODICE_IVA: ColonneReferentiListino = {
  addebiti: ['codiceIvaId'],
  righe: ['codiceIvaId'],
  righeLegame: ['codiceIvaId'],
  legami: [],
  righeDocumento: ['codiceIvaId'],
  marcatori: [],
  documenti: [],
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
  documenti: [],
}

/** Un addebito dell'archivio e' citato solo dalle righe degli elenchi, con `addebitoId`. */
export const COLONNE_ADDEBITO: ColonneReferentiListino = {
  addebiti: [],
  righe: ['addebitoId'],
  righeLegame: [],
  legami: [],
  righeDocumento: [],
  marcatori: [],
  documenti: [],
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
  documenti: [],
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
  documenti: ['elencoId'],
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
  const dettaglio = await contaUsiListinoPerOrigine(client, tenantId, ids, colonne)
  return new Map([...dettaglio].map(([id, u]) => [id, u.totale]))
}

/** Citazioni di un id: il totale e la parte che viene da documenti di fatturazione (Q37). */
export interface UsiListino {
  totale: number
  /** Righe e testate dei documenti e marcatori: stesse query del totale, nessuna in piu'. */
  daDocumenti: number
}

/**
 * Come `contaUsiListino`, ma distingue le citazioni dei documenti di fatturazione (testate, righe,
 * marcatori) dalle altre, cosi' il messaggio «in uso» puo' dire di scartare le anteprime (Q37)
 * senza una query in piu'.
 */
export async function contaUsiListinoPerOrigine(
  client: ListinoUsi,
  tenantId: string,
  ids: readonly string[],
  colonne: ColonneReferentiListino
): Promise<Map<string, UsiListino>> {
  const usi = new Map<string, UsiListino>(ids.map(id => [id, { totale: 0, daDocumenti: 0 }]))
  if (ids.length === 0) return usi
  const sorgenti: Array<[{ groupBy: GroupBy }, readonly string[], boolean]> = [
    [client.addebito as unknown as { groupBy: GroupBy }, colonne.addebiti, false],
    [client.rigaAddebito as unknown as { groupBy: GroupBy }, colonne.righe, false],
    [client.rigaLegameMovimento as unknown as { groupBy: GroupBy }, colonne.righeLegame, false],
    [client.legameMovimento as unknown as { groupBy: GroupBy }, colonne.legami, false],
    [client.rigaDocumentoFattura as unknown as { groupBy: GroupBy }, colonne.righeDocumento, true],
    [client.marcatoreAddebitoFatturato as unknown as { groupBy: GroupBy }, colonne.marcatori, true],
    [client.documentoFattura as unknown as { groupBy: GroupBy }, colonne.documenti, true],
  ]
  for (const [modello, elenco, eDocumento] of sorgenti) {
    for (const colonna of elenco) {
      const righe = await modello.groupBy({
        by: [colonna],
        where: { tenantId, [colonna]: { in: [...ids] } },
        _count: { _all: true },
      })
      for (const r of righe) {
        const id = r[colonna]
        const u = typeof id === 'string' ? usi.get(id) : undefined
        if (u) {
          u.totale += r._count._all
          if (eDocumento) u.daDocumenti += r._count._all
        }
      }
    }
  }
  return usi
}
