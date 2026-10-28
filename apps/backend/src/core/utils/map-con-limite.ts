/**
 * Come `Promise.all(items.map(fn))`, ma con al massimo `limite` chiamate in corso
 * insieme. Il risultato mantiene l'ordine degli elementi. Serve dove ogni chiamata
 * occupa una connessione del pool (una transazione per azienda): senza limite un
 * elenco lungo le esaurirebbe tutte.
 *
 * Al primo errore la promise viene rifiutata; le chiamate gia' avviate finiscono,
 * ma non ne partono di nuove.
 */
export async function mapConLimite<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>
): Promise<R[]> {
  const risultati: R[] = new Array(items.length)
  let prossimo = 0
  let fallito = false
  const lavoratore = async (): Promise<void> => {
    while (!fallito && prossimo < items.length) {
      const indice = prossimo++
      try {
        risultati[indice] = await fn(items[indice], indice)
      } catch (errore) {
        fallito = true
        throw errore
      }
    }
  }
  const quanti = Math.min(Math.max(1, Math.floor(limite) || 1), Math.max(1, items.length))
  await Promise.all(Array.from({ length: quanti }, lavoratore))
  return risultati
}
