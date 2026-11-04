/**
 * Ricorda l'elemento che ha il focus adesso (il pulsante che apre una finestra) e restituisce la
 * funzione che glielo riporta alla chiusura. PrimeNG non lo fa da solo: senza, dopo Esc o «Chiudi»
 * il focus finisce su `body` e chi usa la tastiera riparte dall'inizio della pagina.
 *
 * `testidOrigine`: `data-testid` del pulsante che apre, usato se il focus non è su di lui.
 * Se il pulsante nel frattempo è stato ridisegnato (lista riletta) lo si ritrova dal suo
 * `data-testid`, o da quello dell'host (`p-button`) che lo contiene.
 */
export function catturaFocus(testidOrigine?: string): () => void {
  const attivo = document.activeElement as HTMLElement | null
  // Safari e Firefox su Mac non danno il focus al pulsante cliccato: ci si affida al `data-testid`.
  const el = attivo && attivo !== document.body ? attivo : null
  const tid = el?.closest('[data-testid]')?.getAttribute('data-testid') ?? testidOrigine ?? null
  if (!el && !tid) return () => undefined
  let fatto = false
  return () => {
    if (fatto) return
    fatto = true
    setTimeout(() => {
      let t: HTMLElement | null = el?.isConnected ? el : null
      if (!t && tid) {
        const host = document.querySelector<HTMLElement>(`[data-testid="${tid}"]`)
        t = host?.matches('button') ? host : (host?.querySelector<HTMLElement>('button') ?? host)
      }
      t?.focus()
    }, 50)
  }
}
