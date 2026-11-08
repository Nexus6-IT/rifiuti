// Aiuti di test per `app-campo-data`: scrivono e leggono la data come una persona (`gg/mm/aaaa`),
// con il testid (o l'`id`) sull'host del componente oppure sull'input interno.

/** L'input interno del calendario: `el` puo' essere l'host `app-campo-data` o l'input stesso. */
export function inputDelCampoData(el: Element | null): HTMLInputElement | null {
  if (!el) return null
  if (el instanceof HTMLInputElement) return el
  return el.querySelector<HTMLInputElement>('input.p-inputtext')
}

/** `true` se `el` e' un `app-campo-data` o l'input che ne fa parte. */
export function eCampoData(el: Element | null): boolean {
  return !!el && (el.tagName === 'APP-CAMPO-DATA' || !!el.closest('app-campo-data'))
}

/** `AAAA-MM-GG` → `gg/mm/aaaa` (vuoto resta vuoto). */
export function dataComeSiScrive(iso: string): string {
  return iso ? iso.split('-').reverse().join('/') : ''
}

/**
 * Scrive la data nel campo e ne esce, come fa una persona: il valore arriva al form all'uscita.
 * Niente `focus()`: aprirebbe il pannello del calendario, che resta nel `body` fra un test e l'altro.
 * `PrimeNG` legge l'input solo se prima c'e' stato un tasto premuto, da cui il `keydown`.
 */
export function scriviCampoData(el: Element | null, iso: string): void {
  const input = inputDelCampoData(el)
  if (!input) throw new Error('campo data non trovato')
  input.value = dataComeSiScrive(iso)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

/** Il testo mostrato dal campo, riportato a `AAAA-MM-GG` (vuoto se non c'e' una data). */
export function leggiCampoData(el: Element | null): string {
  const testo = inputDelCampoData(el)?.value ?? ''
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(testo)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
