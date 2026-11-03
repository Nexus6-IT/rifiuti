// Quanti addebiti citano le righe di una tabella del listino (R8): stessa forma batch di
// `contaUsi` della 4.1 (un `groupBy` per colonna referente, una chiamata per `list`/`getById`),
// ma con le sorgenti del listino: gli `addebiti` dell'archivio e le `righe_addebito` degli elenchi
// dei contratti (R44).
import { Prisma, PrismaClient } from '@prisma/client'
import { joinLineari } from './lock-listino'

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
}

/** Colonne del modello Prisma di `righe_legame_movimento` che si possono contare (lista chiusa). */
const COLONNE_SQL_LEGAME: Readonly<Record<string, string>> = {
  rigaAddebitoId: 'riga_addebito_id',
  elencoId: 'elenco_id',
  codiceIvaId: 'codice_iva_id',
}

export const COLONNE_CODICE_IVA: ColonneReferentiListino = {
  addebiti: ['codiceIvaId'],
  righe: ['codiceIvaId'],
  righeLegame: ['codiceIvaId'],
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
}

/** Un addebito dell'archivio e' citato solo dalle righe degli elenchi, con `addebitoId`. */
export const COLONNE_ADDEBITO: ColonneReferentiListino = {
  addebiti: [],
  righe: ['addebitoId'],
  righeLegame: [],
}

/** Una riga di listino e' citata solo dalle righe dei legami (`riga_addebito_id`). */
export const COLONNE_RIGA_LISTINO: ColonneReferentiListino = {
  addebiti: [],
  righe: [],
  righeLegame: ['rigaAddebitoId'],
}

/** Un elenco e' "usato" quando una sua riga e' citata da un legame (`elenco_id` della riga). */
export const COLONNE_ELENCO: ColonneReferentiListino = {
  addebiti: [],
  righe: [],
  righeLegame: ['elencoId'],
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
  if (colonne.righeLegame.length > 0) {
    if (ids.length > SOGLIA_UNNEST) {
      await contaRigheLegame(client, tenantId, ids, colonne.righeLegame, usi)
    } else {
      for (const colonna of colonne.righeLegame) {
        const righe = await (client.rigaLegameMovimento as unknown as { groupBy: GroupBy }).groupBy(
          {
            by: [colonna],
            where: { tenantId, [colonna]: { in: [...ids] } },
            _count: { _all: true },
          }
        )
        for (const r of righe) {
          const id = r[colonna]
          if (typeof id === 'string') usi.set(id, (usi.get(id) ?? 0) + r._count._all)
        }
      }
    }
  }
  return usi
}

/** Oltre questa lunghezza la lista va in `JOIN unnest` con join lineari; sotto basta un `IN`. */
const SOGLIA_UNNEST = 100

type ConteggioLegame = { id: string; n: bigint | number }

/**
 * Citazioni dalle righe dei legami: UNA query per colonna, con la lista intera come un solo
 * parametro `uuid[]` in `JOIN unnest` (mai `= ANY` ne' cicli) e join lineari: con liste di migliaia
 * di id e statistiche vuote il planner sceglierebbe un nested loop quadratico (vedi `joinLineari`).
 * `SET LOCAL` vale solo dentro una transazione: col client "intero" se ne apre una (con il tenant
 * del contesto, come ogni `$transaction` del servizio); dentro `tx` si usa quella in corso.
 */
async function contaRigheLegame(
  client: ListinoUsi,
  tenantId: string,
  ids: readonly string[],
  colonne: readonly string[],
  usi: Map<string, number>
): Promise<void> {
  const esegui = async (tx: Prisma.TransactionClient) => {
    await joinLineari(tx)
    for (const colonna of colonne) {
      const sql = COLONNE_SQL_LEGAME[colonna]
      if (sql === undefined) throw new Error(`Colonna dei legami non ammessa: ${colonna}`)
      const righe = await tx.$queryRaw<ConteggioLegame[]>(Prisma.sql`
        SELECT r.${Prisma.raw(sql)}::text AS id, count(*) AS n
        FROM righe_legame_movimento r
        JOIN unnest(${[...ids]}::uuid[]) AS u(id) ON r.${Prisma.raw(sql)} = u.id
        WHERE r.tenant_id = ${tenantId}::uuid
        GROUP BY r.${Prisma.raw(sql)}`)
      for (const r of righe) usi.set(r.id, (usi.get(r.id) ?? 0) + Number(r.n))
    }
  }
  if ('$transaction' in client) {
    await (client as PrismaClient).$transaction(esegui)
  } else {
    await esegui(client)
  }
}
