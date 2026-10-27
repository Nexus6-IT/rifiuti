import type { Prisma } from '@prisma/client'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'

/** Apertura di registro (giacenza iniziale) nella forma che serve ai calcoli di saldo. */
export interface ApertureRegistroRiga {
  registroId: string
  cerCode: string
  /** Quantità nell'unità salvata (kg/t convertibili, altrimenti unità non di massa). */
  quantita: number
  unita: string
  /** Giorno italiano `YYYY-MM-DD` dal quale la quantità è in deposito. */
  dataRiferimento: string
}

export interface FiltroApertureRegistro {
  /** Solo le aperture di questo registro; senza, tutti i registri dell'azienda. */
  registroId?: string
  /** Solo le aperture con `data_riferimento` <= questo giorno (`YYYY-MM-DD`). */
  finoAl?: string
}

/** Quello che serve del client Prisma: vale sia per il client base sia per una transazione. */
export interface ClientApertureRegistro {
  giacenzaIniziale: Pick<Prisma.TransactionClient['giacenzaIniziale'], 'findMany'>
}

/**
 * Legge le aperture di registro di un'azienda per i calcoli di saldo (giacenze, MUD al 31/12,
 * anomalie). Funzione pura senza injection: `tenantId` esplicito nel `where` oltre alla RLS.
 * `data_riferimento` è una colonna DATE, quindi è già il giorno italiano: la si legge come
 * stringa `YYYY-MM-DD` senza passare da fusi orari.
 */
export async function leggiApertureRegistro(
  client: ClientApertureRegistro,
  tenantId: string,
  filtro: FiltroApertureRegistro = {}
): Promise<ApertureRegistroRiga[]> {
  const righe = await client.giacenzaIniziale.findMany({
    where: {
      tenantId,
      ...(filtro.registroId ? { registroId: filtro.registroId } : {}),
      ...(filtro.finoAl
        ? { dataRiferimento: { lte: new Date(`${filtro.finoAl}T00:00:00Z`) } }
        : {}),
    },
    select: {
      registroId: true,
      cerCode: true,
      quantita: true,
      unita: true,
      dataRiferimento: true,
    },
  })
  return righe.map(r => ({
    registroId: r.registroId,
    cerCode: r.cerCode,
    quantita: Number(r.quantita),
    unita: r.unita,
    dataRiferimento: r.dataRiferimento.toISOString().slice(0, 10),
  }))
}

/** Quantità di un'apertura in kg se l'unità è di massa, altrimenti `null`. */
export function apertureInKg(
  riga: Pick<ApertureRegistroRiga, 'quantita' | 'unita'>
): number | null {
  const u = normalizzaUnitaRegistro(riga.unita)
  return u.massa ? riga.quantita * (u.fattoreKg as number) : null
}
