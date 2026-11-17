import { PROGRESSIVO_COBAT_MASSIMO } from './costanti'

/**
 * Progressivo COBAT (`progdta`, 6 cifre), D9 / decisione Q1 di Graziano (14/11).
 *
 * Difetto di WinWaste NON copiato: la formula `base + movimenti.cod` e' definita solo fino al 2025
 * («ERRORE 245» dopo) e non e' unica oltre 100 000 movimenti. Qui il progressivo e' il numero
 * progressivo del movimento nel registro, unico per anno e registro.
 *
 * INFERENZA (WinWaste, 14/11): la numerazione attesa dal COBAT non e' documentata; questa funzione e'
 * l'unico punto da cambiare quando arrivera' un file reale.
 */
export function progressivoCobat(progressivoRegistro: number, anno: number): string {
  if (!Number.isInteger(anno) || anno < 2010) {
    throw new RangeError(`Anno non valido per il COBAT: ${anno}`)
  }
  if (!Number.isInteger(progressivoRegistro) || progressivoRegistro < 1) {
    throw new RangeError(`Progressivo del registro non valido: ${progressivoRegistro}`)
  }
  if (progressivoRegistro > PROGRESSIVO_COBAT_MASSIMO) {
    throw new RangeError(
      `Progressivo ${progressivoRegistro} oltre ${PROGRESSIVO_COBAT_MASSIMO}: non entra in 6 cifre`
    )
  }
  return String(progressivoRegistro).padStart(6, '0')
}

export interface ProgressivoMovimento {
  registroId: string
  /** Numero progressivo del movimento nel suo registro. */
  progressivoRegistro: number
  anno: number
}

/**
 * Progressivi di un file: uno per movimento, nell'ordine dato. Se tutti i movimenti sono dello stesso
 * registro e anno si usa il progressivo del registro; se nel file entrano piu' registri (o anni)
 * della stessa sede la numerazione diventa 1..n nell'ordine del file, per restare unica (D9).
 */
export function assegnaProgressiviCobat(movimenti: readonly ProgressivoMovimento[]): string[] {
  const unico = new Set(movimenti.map(m => `${m.registroId}|${m.anno}`)).size <= 1
  if (unico) return movimenti.map(m => progressivoCobat(m.progressivoRegistro, m.anno))
  return movimenti.map((m, i) => progressivoCobat(i + 1, m.anno))
}
