/**
 * Ricorda l'elemento a fuoco prima di aprire un dialog e restituisce la funzione che lo
 * rimette a fuoco alla chiusura (se e' ancora nella pagina): chi usa la tastiera non perde il
 * punto da cui era partito.
 */
export function ricordaFuoco(ev?: unknown): () => void {
  const el =
    ((ev as { target?: EventTarget } | undefined)?.target as HTMLElement | undefined)?.closest?.(
      'button'
    ) ?? (document.activeElement as HTMLElement | null)
  return () => setTimeout(() => el?.isConnected && el.focus())
}
