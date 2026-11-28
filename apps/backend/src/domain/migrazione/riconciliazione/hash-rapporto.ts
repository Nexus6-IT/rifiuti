/** Impronta SHA-256 di un rapporto: JSON canonico (chiavi ordinate), cosi' non dipende dall'ordine di scrittura. */
import { createHash } from 'crypto'

function canonico(valore: unknown): unknown {
  if (Array.isArray(valore)) return valore.map(canonico)
  if (valore !== null && typeof valore === 'object') {
    return Object.fromEntries(
      Object.entries(valore as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonico(v)])
    )
  }
  return valore
}

export function hashCanonico(valore: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonico(valore)))
    .digest('hex')
}
