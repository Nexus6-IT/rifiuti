// Quanti addebiti citano le righe di una tabella del listino (R8): stessa forma batch di
// `contaUsi` della 4.1 (un `groupBy` per colonna referente, una chiamata per `list`/`getById`),
// ma con le sorgenti del listino. Oggi la sola sorgente e' `addebiti`; le `righe_addebito`
// (elenchi di addebito) si aggiungono nel Task 22 come seconda voce di `ColonneReferentiListino`.
import { Prisma, PrismaClient } from '@prisma/client'

export type ListinoUsi = PrismaClient | Prisma.TransactionClient

/** Colonne che citano la tabella, per ciascuna sorgente. */
export interface ColonneReferentiListino {
  addebiti: readonly string[]
}

export const COLONNE_CODICE_IVA: ColonneReferentiListino = {
  addebiti: ['codiceIvaId'],
}

export const COLONNE_CODIFICA_ADDEBITO: ColonneReferentiListino = {
  addebiti: [
    'gruppoId',
    'categoriaId',
    'centroRicavoId',
    'categoriaStatistica1Id',
    'categoriaStatistica2Id',
  ],
}

/**
 * Un addebito e' citato dalle righe degli elenchi (Task 22: `rigaAddebito`); finche' il modello
 * non esiste non ha sorgenti e `contaUsiListino` risponde 0 senza query.
 */
export const COLONNE_ADDEBITO: ColonneReferentiListino = {
  addebiti: [],
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
