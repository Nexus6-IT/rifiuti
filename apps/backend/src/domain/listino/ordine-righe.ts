/**
 * Ordine delle righe di un elenco, come la tavola di WinWaste: `riempitavola` legge
 * `SELECT * FROM addebcon WHERE … ORDER BY TIPO, addeb` (`ELENCHIaddeb.cs:2204-2222`; con la
 * regola 11 del cliente WinWaste aggiunge `c3` fra i due, che qui non esiste). Il secondo
 * criterio `addeb` e' il CER per le righe CER e il codice dell'addebito per tutte le altre.
 * A parita' decide il riferimento (WinWaste lascia l'ordine al database; qui e' stabile), poi
 * l'id. Il confronto e' per codice di carattere, come l'ordinamento del database per codici
 * fatti di cifre, lettere maiuscole e `$`.
 */
export interface RigaOrdinabile {
  id: string
  tipo: string
  cerCode: string | null
  addebito: { codice: string } | null
  riferimento: string | null
}

const confronta = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Nuova lista ordinata per tipo di riga, poi CER o codice dell'addebito, riferimento, id. */
export function ordinaRigheListino<T extends RigaOrdinabile>(righe: readonly T[]): T[] {
  return [...righe].sort(
    (a, b) =>
      confronta(a.tipo, b.tipo) ||
      confronta(a.cerCode ?? a.addebito?.codice ?? '', b.cerCode ?? b.addebito?.codice ?? '') ||
      confronta(a.riferimento ?? '', b.riferimento ?? '') ||
      confronta(a.id, b.id)
  )
}
