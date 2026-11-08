/**
 * Colonne di una lista che hanno almeno un dato.
 *
 * Una colonna e' visibile se almeno una riga ha un valore diverso da `null`, `undefined` e dalla
 * stringa vuota (anche dopo `trim`). Lo zero e `false` sono dati: restano visibili. Con zero righe
 * l'insieme e' vuoto (la lista mostra lo stato vuoto, non una tabella di intestazioni).
 *
 * @param righe righe della lista
 * @param colonne per ogni chiave di colonna, la funzione che ne legge il valore da una riga
 * @returns le chiavi delle colonne da mostrare
 */
export function colonneConDati<T>(
  righe: readonly T[],
  colonne: Readonly<Record<string, (r: T) => unknown>>
): Set<string> {
  const visibili = new Set<string>()
  for (const [chiave, leggi] of Object.entries(colonne)) {
    if (righe.some(r => haValore(leggi(r)))) {
      visibili.add(chiave)
    }
  }
  return visibili
}

function haValore(v: unknown): boolean {
  if (v === null || v === undefined) {
    return false
  }
  if (typeof v === 'string') {
    return v.trim() !== ''
  }
  return true
}
