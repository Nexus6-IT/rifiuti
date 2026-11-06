import { FIRStato } from './fir.model'

/**
 * Stati dei FIR come li mostra il frontend (D4, D10, P2).
 *
 * `GET /dashboard` restituisce le chiavi dell'enum Prisma `FIRStatus` (7 valori). Qui si
 * raggruppano nei 5 `FIRStato` con la STESSA mappa di `DB_TO_STATO` del backend
 * (`fir-prisma.repository.ts`): cosi' i conteggi della Dashboard coincidono con lo stato
 * che la lista FIR mostra su ogni riga. Cambiare questa mappa e' una decisione, non un
 * ritocco: il test la fissa coppia per coppia.
 */
export const STATO_FIR_DA_DB: Readonly<Record<string, FIRStato>> = {
  DRAFT: FIRStato.BOZZA,
  AWAITING_PRODUCER: FIRStato.BOZZA,
  AWAITING_CARRIER: FIRStato.EMESSO,
  AWAITING_RECEIVER: FIRStato.IN_TRANSITO,
  COMPLETED: FIRStato.CONSEGNATO,
  SYNCED_TO_RENTRI: FIRStato.CONSEGNATO,
  CANCELLED: FIRStato.ANNULLATO,
}

export const ETICHETTE_STATO_FIR: Readonly<Record<FIRStato, string>> = {
  [FIRStato.BOZZA]: 'Bozza',
  [FIRStato.EMESSO]: 'Emesso',
  [FIRStato.IN_TRANSITO]: 'In transito',
  [FIRStato.CONSEGNATO]: 'Consegnato',
  [FIRStato.ANNULLATO]: 'Annullato',
}

/** Tono della pillola e del pallino: coppie sfondo/inchiostro `--stato-<tono>-*` del tema. */
export type TonoStato = 'ok' | 'warn' | 'err' | 'none' | 'todo'

export const TONO_STATO_FIR: Readonly<Record<FIRStato, TonoStato>> = {
  [FIRStato.BOZZA]: 'none',
  [FIRStato.EMESSO]: 'todo',
  [FIRStato.IN_TRANSITO]: 'warn',
  [FIRStato.CONSEGNATO]: 'ok',
  [FIRStato.ANNULLATO]: 'none',
}

/**
 * Somma i conteggi del database negli stati del frontend. Una chiave sconosciuta (un valore
 * nuovo dell'enum) non entra in nessuna cella; un conteggio non numerico vale zero.
 */
export function contaPerStatoFir(
  breakdown: Readonly<Record<string, number>> | null | undefined
): Record<FIRStato, number> {
  const conteggi: Record<FIRStato, number> = {
    [FIRStato.BOZZA]: 0,
    [FIRStato.EMESSO]: 0,
    [FIRStato.IN_TRANSITO]: 0,
    [FIRStato.CONSEGNATO]: 0,
    [FIRStato.ANNULLATO]: 0,
  }
  if (!breakdown) return conteggi
  for (const [chiave, valore] of Object.entries(breakdown)) {
    const stato = Object.prototype.hasOwnProperty.call(STATO_FIR_DA_DB, chiave)
      ? STATO_FIR_DA_DB[chiave]
      : undefined
    if (stato && Number.isFinite(valore)) conteggi[stato] += valore
  }
  return conteggi
}
