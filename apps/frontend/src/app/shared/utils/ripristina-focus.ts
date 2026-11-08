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

/**
 * Dopo una voce del menu ⋯ che apre un dialog (modifica, conferma): quando il dialog si chiude il
 * focus torna sul ⋯ della riga. Il menu a quel punto e' gia' chiuso e il focus sarebbe finito su
 * `body`. Se la lista viene riletta e la riga ridisegnata, il ⋯ si ritrova dall'etichetta
 * accessibile («Altre azioni per <nome>»). Se nessun dialog si apre entro un secondo (la voce
 * naviga o fa altro) non fa niente.
 */
export function ripristinaFocusDopoDialog(bottone: HTMLElement, etichetta: string): void {
  const maschere = (): number => document.querySelectorAll('.p-dialog-mask').length
  const prima = maschere()
  let aperto = false
  const osservatore = new MutationObserver(() => {
    const ora = maschere()
    if (!aperto && ora > prima) {
      aperto = true
      window.clearTimeout(rinuncia)
    } else if (aperto && ora <= prima) {
      osservatore.disconnect()
      setTimeout(() => {
        const attivo = document.activeElement
        if (attivo && attivo !== document.body) return
        const t = bottone.isConnected
          ? bottone
          : Array.from(document.querySelectorAll<HTMLElement>('[data-testid="azioni-altre"]')).find(
              b => b.getAttribute('aria-label') === etichetta
            )
        t?.focus()
      }, 50)
    }
  })
  osservatore.observe(document.body, { childList: true, subtree: true })
  const rinuncia = window.setTimeout(() => {
    if (!aperto) osservatore.disconnect()
  }, 1000)
}
