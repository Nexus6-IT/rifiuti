/**
 * Confronto 6: campione a mano (piano import 3.6, I8). La scelta e' riproducibile: dato lo stesso seme
 * e gli stessi candidati si ottengono gli stessi elementi, in qualunque ordine arrivino. Niente
 * generatore pseudo-casuale con stato: si ordinano i candidati per l'impronta SHA-256 di
 * `seme|id` e si prendono i primi N.
 */
import { createHash } from 'crypto'

export function scegliCampione(seme: string, candidati: readonly string[], n: number): string[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('la dimensione del campione non e valida')
  const unici = [...new Set(candidati)]
  return unici
    .map(id => ({ id, h: createHash('sha256').update(`${seme}|${id}`).digest('hex') }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.id < b.id ? -1 : 1))
    .slice(0, n)
    .map(x => x.id)
}

/** Seme di default: lo si registra nel rapporto, cosi' la scelta si puo' rifare. */
export function nuovoSeme(adesso: Date = new Date()): string {
  return `seme-${adesso.toISOString()}`
}
