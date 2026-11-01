// Quanti clienti e contratti citano le righe di una tabella di fatturazione (R23, resto di R5).
// Un `groupBy` per colonna referente, una sola chiamata per `list`/`getById`. Conta anche i
// contratti ELIMINATI (eliminazione logica, D13): la FK li vede, quindi la riga citata non si puo'
// cancellare e "Elimina" non deve comparire per poi rispondere 409.
import { Prisma, PrismaClient } from '@prisma/client'

export type ClientUsi = PrismaClient | Prisma.TransactionClient

/** Colonne che citano la tabella, per `clienti` e per `contratti_cliente`. */
export interface ColonneReferenti {
  clienti: readonly string[]
  contratti: readonly string[]
}

export const COLONNE_CONDIZIONE: ColonneReferenti = {
  clienti: ['condizionePagamentoId'],
  contratti: ['condizionePagamentoId'],
}
export const COLONNE_CONTO: ColonneReferenti = {
  clienti: ['contoCorrenteId'],
  contratti: ['contoCorrenteId'],
}
export const COLONNE_SPESA: ColonneReferenti = {
  clienti: ['speseIncassoId', 'bolloId'],
  contratti: ['speseIncassoId', 'bolloId'],
}
export const COLONNE_REGISTRO: ColonneReferenti = {
  clienti: ['registroIvaId'],
  contratti: ['registroIvaId'],
}
export const COLONNE_TESTO: ColonneReferenti = {
  clienti: [],
  contratti: ['testoFatturazioneId'],
}
export const COLONNE_CODIFICA: ColonneReferenti = {
  clienti: [],
  contratti: ['categoriaId', 'tipoId', 'motivoAnnulloId'],
}

type RigaConteggio = Record<string, unknown> & { _count: { _all: number } }
type GroupBy = (args: {
  by: string[]
  where: Record<string, unknown>
  _count: { _all: true }
}) => Promise<RigaConteggio[]>

/**
 * Numero di citazioni per id (0 se nessuna). `ids` vuoto: nessuna query. Va chiamata nel contesto
 * dell'azienda (RLS) o dentro la transazione che poi scrive, per i blocchi del 12b.
 */
export async function contaUsi(
  client: ClientUsi,
  tenantId: string,
  ids: readonly string[],
  colonne: ColonneReferenti
): Promise<Map<string, number>> {
  const usi = new Map<string, number>(ids.map(id => [id, 0]))
  if (ids.length === 0) return usi
  const sorgenti: Array<[{ groupBy: GroupBy }, readonly string[]]> = [
    [client.cliente as unknown as { groupBy: GroupBy }, colonne.clienti],
    [client.contrattoCliente as unknown as { groupBy: GroupBy }, colonne.contratti],
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
