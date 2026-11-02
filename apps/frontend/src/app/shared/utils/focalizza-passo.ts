/**
 * Sposta il focus sul contenitore del passo appena mostrato (riepilogo, conferma), così il
 * lettore di schermo annuncia il cambio. Il contenitore ha `tabindex="-1"` e un `data-testid`.
 * Il focus parte dopo il ciclo di rilevamento che disegna il passo.
 */
export function focalizzaPasso(testid: string): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
    el?.focus()
  })
}
