/**
 * Regola pura (D3) con cui una rettifica decide la sede della controparte della nuova annotazione.
 * Nessuna query: la validazione della sede esplicita sta nel use-case (`sedeControparteEsiste`).
 *
 * - `dati.counterpartSedeId` stringa: si usa.
 * - `null`: azzeramento esplicito, nessuna sede.
 * - `undefined`: si propaga la sede del predecessore SOLO se nome e indirizzo della controparte,
 *   compattati (`trim`, spazi singoli, maiuscole ignorate), sono uguali a quelli del predecessore;
 *   altrimenti `null`. Un nome cambiato con un id vecchio direbbe il falso in silenzio.
 *
 * L'annullamento non passa di qui: copia la sede alla lettera come gli altri campi.
 */

export interface ControparteDelMovimento {
  counterpartSedeId?: string | null
  counterpartName?: string | null
  counterpartAddress?: string | null
}

const compatta = (t: string | null | undefined) =>
  (t ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function sedeControparteRettifica(
  originale: ControparteDelMovimento,
  dati: ControparteDelMovimento
): string | null {
  if (typeof dati.counterpartSedeId === 'string') return dati.counterpartSedeId
  if (dati.counterpartSedeId === null) return null
  if (!originale.counterpartSedeId) return null
  const uguale =
    compatta(originale.counterpartName) === compatta(dati.counterpartName) &&
    compatta(originale.counterpartAddress) === compatta(dati.counterpartAddress)
  return uguale ? originale.counterpartSedeId : null
}
