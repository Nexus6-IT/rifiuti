// Quanti clienti, contratti e (4.4a) documenti, numerazioni, cedente e spese citano le righe di una tabella di fatturazione (R23, resto di R5).
// Un `groupBy` per colonna referente, una sola chiamata per `list`/`getById`. Conta anche i
// contratti ELIMINATI (eliminazione logica, D13): la FK li vede, quindi la riga citata non si puo'
// cancellare e "Elimina" non deve comparire per poi rispondere 409.
import { Prisma, PrismaClient } from '@prisma/client'

export type ClientUsi = PrismaClient | Prisma.TransactionClient

/** Colonne che citano la tabella, per `clienti` e per `contratti_cliente`. */
export interface ColonneReferenti {
  clienti: readonly string[]
  contratti: readonly string[]
  /** Documenti di fattura (4.4a): colonne della testata che citano la tabella. */
  documenti?: readonly string[]
  /** Contatori della numerazione (`numerazioni_fattura`, 4.4a). */
  numerazioni?: readonly string[]
  /** Cedente della fatturazione (`cedente_fatturazione`, 4.4a): registro IVA predefinito. */
  cedente?: readonly string[]
  /** Spese accessorie (4.4a): codice IVA della spesa. */
  spese?: readonly string[]
}

/** Spese accessorie che citano un codice IVA (la lista dei codici IVA le somma agli altri usi). */
export const COLONNE_SPESE_DI_CODICE_IVA: ColonneReferenti = {
  clienti: [],
  contratti: [],
  spese: ['codiceIvaId'],
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
/**
 * Un registro IVA e' citato anche dai documenti, dai contatori della numerazione e dal cedente
 * (registro predefinito): le FK `NoAction` impediscono di cancellarlo.
 */
export const COLONNE_REGISTRO: ColonneReferenti = {
  clienti: ['registroIvaId'],
  contratti: ['registroIvaId'],
  documenti: ['registroIvaId'],
  numerazioni: ['registroIvaId'],
  cedente: ['registroIvaPredefinitoId'],
}
export const COLONNE_TESTO: ColonneReferenti = {
  clienti: [],
  contratti: ['testoFatturazioneId'],
}
export const COLONNE_CODIFICA: ColonneReferenti = {
  clienti: [],
  contratti: ['categoriaId', 'tipoId', 'motivoAnnulloId'],
}

/**
 * Numerazione scritta (spec §4.6, M3): `ultimo_numero > numero_partenza` (un numero e' stato
 * riservato) oppure `data_partenza` non nulla. Una riga vuota, o con la sola partenza numerica, e'
 * un'assenza: il registro si elimina e la partenza si puo' ancora impostare. Il confronto fra due
 * colonne usa il riferimento di campo di Prisma.
 */
function numerazioneScritta(client: ClientUsi): Filtro {
  return {
    OR: [
      { ultimoNumero: { gt: client.numerazioneFattura.fields.numeroPartenza } },
      { dataPartenza: { not: null } },
    ],
  }
}

type Filtro = Record<string, unknown>

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
  // Terzo elemento: filtro esplicito della sorgente. Una riga di numerazione vuota nasce solo per
  // il lock del suffisso (o da una riserva annullata): non e' un uso.
  const sorgenti: Array<[{ groupBy: GroupBy }, readonly string[], Filtro]> = [
    [client.cliente as unknown as { groupBy: GroupBy }, colonne.clienti, {}],
    [client.contrattoCliente as unknown as { groupBy: GroupBy }, colonne.contratti, {}],
    [client.documentoFattura as unknown as { groupBy: GroupBy }, colonne.documenti ?? [], {}],
    [
      client.numerazioneFattura as unknown as { groupBy: GroupBy },
      colonne.numerazioni ?? [],
      (colonne.numerazioni ?? []).length > 0 ? numerazioneScritta(client) : {},
    ],
    [client.cedenteFatturazione as unknown as { groupBy: GroupBy }, colonne.cedente ?? [], {}],
    [client.spesaAccessoria as unknown as { groupBy: GroupBy }, colonne.spese ?? [], {}],
  ]
  for (const [modello, elenco, filtro] of sorgenti) {
    for (const colonna of elenco) {
      const righe = await modello.groupBy({
        by: [colonna],
        where: {
          tenantId,
          [colonna]: { in: [...ids] },
          ...filtro,
        },
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
