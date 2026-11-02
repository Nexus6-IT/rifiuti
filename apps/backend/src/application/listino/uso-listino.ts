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
}

export const COLONNE_CODICE_IVA: ColonneReferentiListino = {
  addebiti: ['codiceIvaId'],
  righe: ['codiceIvaId'],
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
}

/** Un addebito dell'archivio e' citato solo dalle righe degli elenchi, con `addebitoId`. */
export const COLONNE_ADDEBITO: ColonneReferentiListino = {
  addebiti: [],
  righe: ['addebitoId'],
}

type RigaConteggio = Record<string, unknown> & { _count: { _all: number } }
type GroupBy = (args: {
  by: string[]
  where: Record<string, unknown>
  _count: { _all: true }
}) => Promise<RigaConteggio[]>

/**
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
